import { describe, expect, it } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { enqueue } from "../enqueue/enqueue-service.js";
import { InMemoryOutboundQueue } from "../enqueue/in-memory-outbound-queue.js";
import { OUTBOUND_214_DELIVER_STEP } from "../outbound/workflows/outbound-214.js";
import { RedriveNotAllowedError, redrive } from "../redrive/redrive-service.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import {
  createRedriveHandler,
  createRedriveHandlerDeps,
  readRedriveHandlerEnv,
  resetRedriveHandlerDepsCacheForTests,
  resolveDefaultRedriveHandlerDepsForTests,
} from "./redrive-handler.js";

const FIXED_TIME = "2026-07-23T12:00:00.000Z";
const DURABLE_EXECUTION_ID = "durable-exec-abc123";

function handlerDeps() {
  const store = new InMemoryEdiJobStore();
  const outboundQueue = new InMemoryOutboundQueue();
  return {
    store,
    outboundQueue,
    enqueueDeps: {
      store,
      outboundQueue,
      now: () => FIXED_TIME,
      newId: () => "job-lambda-1",
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

describe("readRedriveHandlerEnv", () => {
  it("requires table and queue env vars", () => {
    expect(() => readRedriveHandlerEnv({})).toThrow(
      "EDI_JOB_TABLE_NAME and EDI_OUTBOUND_QUEUE_URL must be set",
    );
  });

  it("reads configured env vars", () => {
    expect(
      readRedriveHandlerEnv({
        EDI_JOB_TABLE_NAME: "edi-jobs",
        EDI_OUTBOUND_QUEUE_URL: "https://sqs.example/edi-outbound.fifo",
      }),
    ).toEqual({
      ediJobTableName: "edi-jobs",
      ediOutboundQueueUrl: "https://sqs.example/edi-outbound.fifo",
    });
  });
});

describe("createRedriveHandlerDeps", () => {
  it("wires DynamoDB store and SQS outbound queue", () => {
    const deps = createRedriveHandlerDeps({
      ediJobTableName: "edi-jobs",
      ediOutboundQueueUrl: "https://sqs.example/edi-outbound.fifo",
    });
    expect(deps.store).toBeDefined();
    expect(deps.outboundQueue).toBeDefined();
  });
});

describe("redrive Lambda handler", () => {
  it("redrives a failed OUTBOUND_214 job and publishes to outbound FIFO", async () => {
    const { enqueueDeps, redriveDeps, outboundQueue } = handlerDeps();
    const invoke = createRedriveHandler(() => redriveDeps);

    await enqueue(enqueueDeps, outbound214Input());
    await enqueueDeps.store.put({
      ...(await enqueueDeps.store.getById("job-lambda-1"))!,
      status: "failed",
      step: OUTBOUND_214_DELIVER_STEP,
      durableExecutionId: DURABLE_EXECUTION_ID,
      handedOff: true,
      attempt: 1,
      updatedAt: FIXED_TIME,
    });

    const response = await invoke({ jobId: "job-lambda-1" });

    expect(response.job).toMatchObject({
      id: "job-lambda-1",
      status: "queued",
      attempt: 2,
      orderingGroup: "cfg-partner-a#SHP-1001",
    });
    expect(response.job.step).toBeUndefined();
    expect(response.job.durableExecutionId).toBeUndefined();
    expect(outboundQueue.messages).toHaveLength(2);
    expect(outboundQueue.messages[1]!.messageGroupId).toBe(
      "cfg-partner-a#SHP-1001",
    );
  });

  it("rejects dead jobs at the handler boundary", async () => {
    const { redriveDeps } = handlerDeps();
    const invoke = createRedriveHandler(() => redriveDeps);

    await redriveDeps.store.put({
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

    await expect(invoke({ jobId: "job-dead-1" })).rejects.toBeInstanceOf(
      RedriveNotAllowedError,
    );
  });

  it("delegates to redrive service with injected deps", async () => {
    const { enqueueDeps, redriveDeps } = handlerDeps();
    await enqueue(enqueueDeps, outbound214Input());
    await enqueueDeps.store.put({
      ...(await enqueueDeps.store.getById("job-lambda-1"))!,
      status: "failed",
      step: OUTBOUND_214_DELIVER_STEP,
      handedOff: true,
      updatedAt: FIXED_TIME,
    });

    const job = await redrive(redriveDeps, { jobId: "job-lambda-1" });
    expect(job.status).toBe("queued");
    expect(job.attempt).toBe(2);
  });

  it("reuses module-scope deps when using the default resolver", () => {
    resetRedriveHandlerDepsCacheForTests();
    process.env.EDI_JOB_TABLE_NAME = "edi-jobs";
    process.env.EDI_OUTBOUND_QUEUE_URL = "https://sqs.example/edi-outbound.fifo";

    const first = resolveDefaultRedriveHandlerDepsForTests();
    const second = resolveDefaultRedriveHandlerDepsForTests();

    expect(first).toBe(second);
    expect(first.store).toBe(second.store);
    expect(first.outboundQueue).toBe(second.outboundQueue);
  });
});
