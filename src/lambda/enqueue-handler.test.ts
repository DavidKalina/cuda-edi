import { describe, expect, it } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { enqueue } from "../enqueue/enqueue-service.js";
import { InMemoryOutboundQueue } from "../enqueue/in-memory-outbound-queue.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import {
  createEnqueueHandler,
  createEnqueueHandlerDeps,
  readEnqueueHandlerEnv,
  resetEnqueueHandlerDepsCacheForTests,
  resolveDefaultEnqueueHandlerDepsForTests,
} from "./enqueue-handler.js";

const FIXED_TIME = "2026-07-23T12:00:00.000Z";

function handlerDeps() {
  const store = new InMemoryEdiJobStore();
  const outboundQueue = new InMemoryOutboundQueue();
  return {
    store,
    outboundQueue,
    deps: {
      store,
      outboundQueue,
      now: () => FIXED_TIME,
      newId: () => "job-lambda-1",
    },
  };
}

describe("readEnqueueHandlerEnv", () => {
  it("requires table and queue env vars", () => {
    expect(() => readEnqueueHandlerEnv({})).toThrow(
      "EDI_JOB_TABLE_NAME and EDI_OUTBOUND_QUEUE_URL must be set",
    );
  });

  it("reads configured env vars", () => {
    expect(
      readEnqueueHandlerEnv({
        EDI_JOB_TABLE_NAME: "edi-jobs",
        EDI_OUTBOUND_QUEUE_URL: "https://sqs.example/edi-outbound.fifo",
      }),
    ).toEqual({
      ediJobTableName: "edi-jobs",
      ediOutboundQueueUrl: "https://sqs.example/edi-outbound.fifo",
    });
  });
});

describe("createEnqueueHandlerDeps", () => {
  it("wires DynamoDB store and SQS outbound queue", () => {
    const deps = createEnqueueHandlerDeps({
      ediJobTableName: "edi-jobs",
      ediOutboundQueueUrl: "https://sqs.example/edi-outbound.fifo",
    });
    expect(deps.store).toBeDefined();
    expect(deps.outboundQueue).toBeDefined();
  });
});

describe("enqueue Lambda handler", () => {
  it("creates an OUTBOUND_214 job and publishes to outbound FIFO", async () => {
    const { deps, outboundQueue } = handlerDeps();
    const invoke = createEnqueueHandler(() => deps);

    const response = await invoke({
      jobType: "OUTBOUND_214",
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
    });

    expect(response.job).toMatchObject({
      id: "job-lambda-1",
      status: "queued",
      jobType: "OUTBOUND_214",
      orderingGroup: "cfg-partner-a#SHP-1001",
    });
    expect(outboundQueue.messages).toHaveLength(1);
    expect(outboundQueue.messages[0]!.messageGroupId).toBe(
      "cfg-partner-a#SHP-1001",
    );
  });

  it("returns the existing job on idempotent replay without a second queue send", async () => {
    const { deps, outboundQueue } = handlerDeps();
    const invoke = createEnqueueHandler(() => deps);
    const input = {
      jobType: "OUTBOUND_214" as const,
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
    };

    const first = await invoke(input);
    const second = await invoke(input);

    expect(second.job).toBe(first.job);
    expect(outboundQueue.messages).toHaveLength(1);
  });

  it("delegates to enqueue service with injected deps", async () => {
    const { deps } = handlerDeps();
    const job = await enqueue(deps, {
      jobType: "OUTBOUND_214",
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
    });
    expect(job.id).toBe("job-lambda-1");
  });

  it("reuses module-scope deps when using the default resolver", () => {
    resetEnqueueHandlerDepsCacheForTests();
    process.env.EDI_JOB_TABLE_NAME = "edi-jobs";
    process.env.EDI_OUTBOUND_QUEUE_URL = "https://sqs.example/edi-outbound.fifo";

    const first = resolveDefaultEnqueueHandlerDepsForTests();
    const second = resolveDefaultEnqueueHandlerDepsForTests();

    expect(first).toBe(second);
    expect(first.store).toBe(second.store);
    expect(first.outboundQueue).toBe(second.outboundQueue);
  });
});
