import { describe, expect, it } from "vitest";
import { InMemoryArtifactStore } from "../artifact/in-memory-artifact-store.js";
import { InMemoryControlNumberAllocator } from "../control-number/in-memory-control-number-allocator.js";
import {
  isAutoRedrivable,
  isRedrivable,
  SHIPMENT_BUSINESS_KEY,
} from "../domain/edi-job.js";
import { enqueue } from "../enqueue/enqueue-service.js";
import { InMemoryOutboundQueue } from "../enqueue/in-memory-outbound-queue.js";
import { InMemoryPartnerMailboxClient } from "../mailbox/in-memory-partner-mailbox-client.js";
import { JsonataMapExecutor } from "../map/jsonata-map-executor.js";
import { processOutboundJob } from "../outbound/outbound-processor.js";
import { OUTBOUND_214_DELIVER_STEP } from "../outbound/workflows/outbound-214.js";
import { InMemoryEdiConfigStore } from "../store/in-memory-edi-config-store.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import {
  partnerAControlNumberSeeds,
  partnerAEdiConfig,
} from "../test-fixtures/partner-a-edi-config.js";
import { RedriveNotAllowedError, redrive } from "./redrive-service.js";

const FIXED_TIME = "2026-07-23T12:00:00.000Z";
const DURABLE_EXECUTION_ID = "durable-exec-abc123";

function redriveDeps() {
  const store = new InMemoryEdiJobStore();
  const outboundQueue = new InMemoryOutboundQueue();
  return {
    store,
    outboundQueue,
    enqueueDeps: {
      store,
      outboundQueue,
      now: () => FIXED_TIME,
      newId: () => "job-new-1",
    },
    redriveDeps: {
      store,
      outboundQueue,
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

describe("isRedrivable / isAutoRedrivable", () => {
  it("allows only failed jobs", () => {
    expect(isRedrivable("failed")).toBe(true);
    expect(isRedrivable("dead")).toBe(false);
    expect(isRedrivable("queued")).toBe(false);
    expect(isRedrivable("running")).toBe(false);
    expect(isRedrivable("succeeded")).toBe(false);
  });

  it("excludes dead jobs from auto-redrive", () => {
    expect(isAutoRedrivable("failed")).toBe(true);
    expect(isAutoRedrivable("dead")).toBe(false);
  });
});

describe("redrive", () => {
  it("requeues a failed job under the same identity with a new attempt", async () => {
    const { enqueueDeps, redriveDeps: deps, outboundQueue } = redriveDeps();
    await enqueue(enqueueDeps, outbound214Input());
    const failed = await deps.store.put({
      ...(await deps.store.getById("job-new-1"))!,
      status: "failed",
      step: OUTBOUND_214_DELIVER_STEP,
      durableExecutionId: DURABLE_EXECUTION_ID,
      handedOff: true,
      attempt: 1,
      updatedAt: FIXED_TIME,
    });

    const redriven = await redrive(deps, { jobId: failed.id });

    expect(redriven).toMatchObject({
      id: "job-new-1",
      status: "queued",
      attempt: 2,
      handedOff: true,
    });
    expect(redriven.step).toBeUndefined();
    expect(redriven.durableExecutionId).toBeUndefined();
    expect(outboundQueue.messages).toHaveLength(2);
    expect(outboundQueue.messages[1]).toEqual({
      messageGroupId: "cfg-partner-a#SHP-1001",
      message: {
        jobId: "job-new-1",
        jobType: "OUTBOUND_214",
        ediConfigId: "cfg-partner-a",
        businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
        idempotencyKey: "milestone:SHP-1001:214",
        orderingGroup: "cfg-partner-a#SHP-1001",
      },
    });
  });

  it("rejects dead jobs", async () => {
    const { redriveDeps: deps } = redriveDeps();
    await deps.store.put({
      id: "job-dead-1",
      status: "dead",
      jobType: "OUTBOUND_214",
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
      orderingGroup: "cfg-partner-a#SHP-1001",
      artifactRefs: [],
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    });

    await expect(redrive(deps, { jobId: "job-dead-1" })).rejects.toBeInstanceOf(
      RedriveNotAllowedError,
    );
  });

  it("rejects non-failed statuses", async () => {
    const { enqueueDeps, redriveDeps: deps } = redriveDeps();
    const queued = await enqueue(enqueueDeps, outbound214Input());

    await expect(redrive(deps, { jobId: queued.id })).rejects.toBeInstanceOf(
      RedriveNotAllowedError,
    );
  });

  it("does not substitute enqueue idempotent replay for redrive", async () => {
    const { enqueueDeps, redriveDeps: deps, outboundQueue } = redriveDeps();
    await enqueue(enqueueDeps, outbound214Input());
    await deps.store.put({
      ...(await deps.store.getById("job-new-1"))!,
      status: "failed",
      step: OUTBOUND_214_DELIVER_STEP,
      handedOff: true,
      updatedAt: FIXED_TIME,
    });

    const replayed = await enqueue(enqueueDeps, outbound214Input());

    expect(replayed.status).toBe("failed");
    expect(outboundQueue.messages).toHaveLength(1);
  });

  it("redriven failed job can reach succeeded when the fault is cleared", async () => {
    const store = new InMemoryEdiJobStore();
    const outboundQueue = new InMemoryOutboundQueue();
    const ediConfigStore = new InMemoryEdiConfigStore([partnerAEdiConfig()]);
    const controlNumberAllocator = new InMemoryControlNumberAllocator(
      partnerAControlNumberSeeds(),
    );
    const mapExecutor = new JsonataMapExecutor();
    const artifactStore = new InMemoryArtifactStore();
    let uploadFails = true;
    const partnerMailboxClient = new InMemoryPartnerMailboxClient();
    const enqueueDeps = {
      store,
      outboundQueue,
      now: () => FIXED_TIME,
      newId: () => "job-new-1",
    };
    const processorDeps = {
      store,
      ediConfigStore,
      controlNumberAllocator,
      mapExecutor,
      artifactStore,
      partnerMailboxClient: {
        exists: async (path: string) => partnerMailboxClient.exists(path),
        putFile: async (path: string, content: Buffer) => {
          if (uploadFails) {
            throw new Error("SFTP upload failed");
          }
          return partnerMailboxClient.putFile(path, content);
        },
      },
      now: () => FIXED_TIME,
    };
    const redriveDeps = {
      store,
      outboundQueue,
      now: () => FIXED_TIME,
    };

    await enqueue(enqueueDeps, outbound214Input());
    await expect(
      processOutboundJob(processorDeps, {
        message: outboundQueue.messages[0]!.message,
        durableExecutionId: DURABLE_EXECUTION_ID,
      }),
    ).rejects.toThrow("SFTP upload failed");

    uploadFails = false;
    const redriven = await redrive(redriveDeps, { jobId: "job-new-1" });
    expect(redriven.status).toBe("queued");
    expect(redriven.attempt).toBe(2);

    const result = await processOutboundJob(processorDeps, {
      message: outboundQueue.messages[1]!.message,
      durableExecutionId: "durable-exec-redrive",
    });

    expect(result).toMatchObject({
      id: "job-new-1",
      status: "succeeded",
      attempt: 2,
      durableExecutionId: "durable-exec-redrive",
    });
  });
});
