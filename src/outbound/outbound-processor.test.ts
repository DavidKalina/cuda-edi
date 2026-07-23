import { describe, expect, it } from "vitest";
import { InMemoryControlNumberAllocator } from "../control-number/in-memory-control-number-allocator.js";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { enqueue } from "../enqueue/enqueue-service.js";
import { InMemoryOutboundQueue } from "../enqueue/in-memory-outbound-queue.js";
import { InMemoryEdiConfigStore } from "../store/in-memory-edi-config-store.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import {
  partnerAControlNumberSeeds,
  partnerAEdiConfig,
} from "../test-fixtures/partner-a-edi-config.js";
import {
  OUTBOUND_214_DELIVER_STEP,
  OUTBOUND_214_GENERATE_STEP,
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
  return {
    store,
    outboundQueue,
    ediConfigStore,
    controlNumberAllocator,
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
  it("runs the OUTBOUND_214 stub workflow through succeeded", async () => {
    const { enqueueDeps, processorDeps, outboundQueue } = outboundDeps();
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
          if (job.step) {
            steps.push(job.step);
          }
          return store.put(job);
        },
      },
      ediConfigStore,
      controlNumberAllocator,
      now: () => FIXED_TIME,
    };

    await enqueue(enqueueDeps, outbound214Input());
    await processOutboundJob(processorDeps, {
      message: outboundQueue.messages[0]!.message,
      durableExecutionId: DURABLE_EXECUTION_ID,
    });

    expect(steps).toEqual([
      OUTBOUND_214_GENERATE_STEP,
      OUTBOUND_214_DELIVER_STEP,
    ]);
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
        { store, ediConfigStore, controlNumberAllocator, now: () => FIXED_TIME },
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
      now: () => FIXED_TIME,
    };

    await enqueue(enqueueDeps, outbound214Input());

    await expect(
      processOutboundJob(processorDeps, {
        message: outboundQueue.messages[0]!.message,
        durableExecutionId: DURABLE_EXECUTION_ID,
      }),
    ).rejects.toThrow("EDI Config not found: cfg-partner-a");
  });
});
