import { describe, expect, it } from "vitest";
import { InMemoryArtifactStore } from "../artifact/in-memory-artifact-store.js";
import { InMemoryControlNumberAllocator } from "../control-number/in-memory-control-number-allocator.js";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { enqueue } from "../enqueue/enqueue-service.js";
import { InMemoryOutboundQueue } from "../enqueue/in-memory-outbound-queue.js";
import { InMemoryPartnerMailboxClient } from "../mailbox/in-memory-partner-mailbox-client.js";
import { resolveOutbound214MailboxPath } from "../mailbox/resolve-outbound-214-path.js";
import { JsonataMapExecutor } from "../map/jsonata-map-executor.js";
import { InMemoryEdiConfigStore } from "../store/in-memory-edi-config-store.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import {
  partnerAControlNumberSeeds,
  partnerAEdiConfig,
} from "../test-fixtures/partner-a-edi-config.js";
import {
  OUTBOUND_214_DELIVER_STEP,
  OUTBOUND_214_GENERATE_STEP,
  OUTBOUND_214_VERIFY_STEP,
} from "./workflows/outbound-214.js";
import { processOutboundJob } from "./outbound-processor.js";

const FIXED_TIME = "2026-07-23T12:00:00.000Z";
const DURABLE_EXECUTION_ID = "durable-exec-abc123";

function outboundDeps() {
  const store = new InMemoryEdiJobStore();
  const outboundQueue = new InMemoryOutboundQueue();
  const ediConfigStore = new InMemoryEdiConfigStore([partnerAEdiConfig()]);
  const controlNumberAllocator = new InMemoryControlNumberAllocator(
    partnerAControlNumberSeeds(),
  );
  const mapExecutor = new JsonataMapExecutor();
  const artifactStore = new InMemoryArtifactStore();
  const partnerMailboxClient = new InMemoryPartnerMailboxClient();
  return {
    store,
    outboundQueue,
    ediConfigStore,
    controlNumberAllocator,
    mapExecutor,
    artifactStore,
    partnerMailboxClient,
    enqueueDeps: {
      store,
      outboundQueue,
      now: () => FIXED_TIME,
      newId: () => "job-new-1",
    },
    processorDeps: {
      store,
      ediConfigStore,
      controlNumberAllocator,
      mapExecutor,
      artifactStore,
      partnerMailboxClient,
      now: () => FIXED_TIME,
    },
  };
}

function outbound214Input() {
  return {
    jobType: "OUTBOUND_214" as const,
    ediConfigId: "cfg-partner-a",
    businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
    idempotencyKey: "milestone:SHP-1001:214",
  };
}

describe("processOutboundJob", () => {
  it("runs OUTBOUND_214 through succeeded with X12 artifact refs", async () => {
    const {
      enqueueDeps,
      processorDeps,
      outboundQueue,
      artifactStore,
      controlNumberAllocator,
      partnerMailboxClient,
    } = outboundDeps();
    const queued = await enqueue(enqueueDeps, outbound214Input());

    expect(queued.status).toBe("queued");
    expect(outboundQueue.messages).toHaveLength(1);

    const result = await processOutboundJob(processorDeps, {
      message: outboundQueue.messages[0]!.message,
      durableExecutionId: DURABLE_EXECUTION_ID,
    });

    expect(result).toMatchObject({
      id: "job-new-1",
      status: "succeeded",
      jobType: "OUTBOUND_214",
      durableExecutionId: DURABLE_EXECUTION_ID,
    });
    expect(result.step).toBeUndefined();
    expect(result.artifactRefs).toHaveLength(2);
    expect(result.artifactRefs[0]).toMatchObject({
      bucket: "edi-artifacts",
      key: "cfg-partner-a/job-new-1/verify",
      kind: "verify",
    });
    expect(result.artifactRefs[1]).toMatchObject({
      bucket: "edi-artifacts",
      key: "cfg-partner-a/job-new-1/x12",
      kind: "x12",
    });

    const stored = artifactStore.getByKey("cfg-partner-a/job-new-1/x12");
    expect(stored).toBeDefined();
    const x12 = new TextDecoder().decode(stored!.content);
    expect(x12).toContain("B10*SHP-1001~");
    expect(x12).toContain("AT7*AF~");
    expect(x12).toContain("*001000001*");
    expect(x12).toContain("GS*QM*CUDACORP*PARTNERA*20260723*1200*500001*");
    expect(x12).toContain("ST*214*43~");

    const mailboxPath = resolveOutbound214MailboxPath(
      partnerAEdiConfig(),
      result,
    );
    expect(partnerMailboxClient.files.size).toBe(1);
    expect(partnerMailboxClient.getFile(mailboxPath)?.content).toEqual(
      stored!.content,
    );

    await expect(
      controlNumberAllocator.allocate("cfg-partner-a", "isa"),
    ).resolves.toBe("1000002");

    const persisted = await processorDeps.store.getById("job-new-1");
    expect(persisted).toEqual(result);
  });

  it("records generate and deliver steps while running", async () => {
    const steps: string[] = [];
    const store = new InMemoryEdiJobStore();
    const outboundQueue = new InMemoryOutboundQueue();
    const ediConfigStore = new InMemoryEdiConfigStore([partnerAEdiConfig()]);
    const controlNumberAllocator = new InMemoryControlNumberAllocator(
      partnerAControlNumberSeeds(),
    );
    const mapExecutor = new JsonataMapExecutor();
    const artifactStore = new InMemoryArtifactStore();
    const partnerMailboxClient = new InMemoryPartnerMailboxClient();
    const enqueueDeps = {
      store,
      outboundQueue,
      now: () => FIXED_TIME,
      newId: () => "job-new-1",
    };
    const processorDeps = {
      store: {
        findByIdempotencyKey: (...args: Parameters<typeof store.findByIdempotencyKey>) =>
          store.findByIdempotencyKey(...args),
        claimIdempotencyKey: (...args: Parameters<typeof store.claimIdempotencyKey>) =>
          store.claimIdempotencyKey(...args),
        getById: (...args: Parameters<typeof store.getById>) => store.getById(...args),
        put: async (job: Parameters<typeof store.put>[0]) => {
          if (job.step && job.step !== steps.at(-1)) {
            steps.push(job.step);
          }
          return store.put(job);
        },
      },
      ediConfigStore,
      controlNumberAllocator,
      mapExecutor,
      artifactStore,
      partnerMailboxClient,
      now: () => FIXED_TIME,
    };

    await enqueue(enqueueDeps, outbound214Input());
    await processOutboundJob(processorDeps, {
      message: outboundQueue.messages[0]!.message,
      durableExecutionId: DURABLE_EXECUTION_ID,
    });

    expect(steps).toEqual([
      OUTBOUND_214_GENERATE_STEP,
      OUTBOUND_214_VERIFY_STEP,
      OUTBOUND_214_DELIVER_STEP,
    ]);
  });

  it("skips generate when an x12 artifact ref already exists on replay", async () => {
    const {
      enqueueDeps,
      processorDeps,
      outboundQueue,
      controlNumberAllocator,
      partnerMailboxClient,
    } = outboundDeps();
    await enqueue(enqueueDeps, outbound214Input());
    const message = outboundQueue.messages[0]!.message;

    const first = await processOutboundJob(processorDeps, {
      message,
      durableExecutionId: DURABLE_EXECUTION_ID,
    });
    const second = await processOutboundJob(processorDeps, {
      message,
      durableExecutionId: "durable-exec-replay",
    });

    expect(second).toEqual(first);
    expect(partnerMailboxClient.files.size).toBe(1);
    await expect(
      controlNumberAllocator.allocate("cfg-partner-a", "isa"),
    ).resolves.toBe("1000002");
  });

  it("is idempotent when the job already succeeded", async () => {
    const { enqueueDeps, processorDeps, outboundQueue } = outboundDeps();
    await enqueue(enqueueDeps, outbound214Input());
    const message = outboundQueue.messages[0]!.message;

    const first = await processOutboundJob(processorDeps, {
      message,
      durableExecutionId: DURABLE_EXECUTION_ID,
    });
    const second = await processOutboundJob(processorDeps, {
      message,
      durableExecutionId: "durable-exec-other",
    });

    expect(second).toEqual(first);
  });

  it("rejects unsupported outbound job types", async () => {
    const store = new InMemoryEdiJobStore();
    const ediConfigStore = new InMemoryEdiConfigStore([partnerAEdiConfig()]);
    const controlNumberAllocator = new InMemoryControlNumberAllocator(
      partnerAControlNumberSeeds(),
    );
    const mapExecutor = new JsonataMapExecutor();
    const artifactStore = new InMemoryArtifactStore();
    const partnerMailboxClient = new InMemoryPartnerMailboxClient();
    const now = FIXED_TIME;
    await store.put({
      id: "job-997",
      status: "queued",
      jobType: "OUTBOUND_997",
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "ack:SHP-1001:997",
      orderingGroup: "cfg-partner-a#SHP-1001",
      artifactRefs: [],
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      processOutboundJob(
        {
          store,
          ediConfigStore,
          controlNumberAllocator,
          mapExecutor,
          artifactStore,
          partnerMailboxClient,
          now: () => FIXED_TIME,
        },
        {
          message: {
            jobId: "job-997",
            jobType: "OUTBOUND_997",
            ediConfigId: "cfg-partner-a",
            businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
            idempotencyKey: "ack:SHP-1001:997",
            orderingGroup: "cfg-partner-a#SHP-1001",
          },
          durableExecutionId: DURABLE_EXECUTION_ID,
        },
      ),
    ).rejects.toThrow("unsupported outbound job type: OUTBOUND_997");
  });

  it("fails when EDI Config is missing during generate", async () => {
    const { enqueueDeps, outboundQueue } = outboundDeps();
    const processorDeps = {
      store: enqueueDeps.store,
      ediConfigStore: new InMemoryEdiConfigStore(),
      controlNumberAllocator: new InMemoryControlNumberAllocator(
        partnerAControlNumberSeeds(),
      ),
      mapExecutor: new JsonataMapExecutor(),
      artifactStore: new InMemoryArtifactStore(),
      partnerMailboxClient: new InMemoryPartnerMailboxClient(),
      now: () => FIXED_TIME,
    };

    await enqueue(enqueueDeps, outbound214Input());

    await expect(
      processOutboundJob(processorDeps, {
        message: outboundQueue.messages[0]!.message,
        durableExecutionId: DURABLE_EXECUTION_ID,
      }),
    ).rejects.toThrow("EDI Config not found: cfg-partner-a");

    const failed = await processorDeps.store.getById("job-new-1");
    expect(failed).toMatchObject({
      status: "failed",
      step: OUTBOUND_214_GENERATE_STEP,
    });
  });

  it("fails with deliver step when Partner Mailbox upload fails", async () => {
    const { enqueueDeps, outboundQueue } = outboundDeps();
    const processorDeps = {
      store: enqueueDeps.store,
      ediConfigStore: new InMemoryEdiConfigStore([partnerAEdiConfig()]),
      controlNumberAllocator: new InMemoryControlNumberAllocator(
        partnerAControlNumberSeeds(),
      ),
      mapExecutor: new JsonataMapExecutor(),
      artifactStore: new InMemoryArtifactStore(),
      partnerMailboxClient: {
        exists: async () => false,
        putFile: async () => {
          throw new Error("SFTP upload failed");
        },
      },
      now: () => FIXED_TIME,
    };

    await enqueue(enqueueDeps, outbound214Input());

    await expect(
      processOutboundJob(processorDeps, {
        message: outboundQueue.messages[0]!.message,
        durableExecutionId: DURABLE_EXECUTION_ID,
      }),
    ).rejects.toThrow("SFTP upload failed");

    const failed = await processorDeps.store.getById("job-new-1");
    expect(failed).toMatchObject({
      status: "failed",
      step: OUTBOUND_214_DELIVER_STEP,
    });
    expect(failed?.artifactRefs.some((ref) => ref.kind === "x12")).toBe(true);
  });
});
