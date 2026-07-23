import { describe, expect, it } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { enqueue } from "../enqueue/enqueue-service.js";
import { InMemoryOutboundQueue } from "../enqueue/in-memory-outbound-queue.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import {
  createOutboundDurableHandler,
  createOutboundHandlerDeps,
  parseOutboundQueueMessage,
  processOutboundSqsEvent,
  readDurableExecutionId,
  readOutboundHandlerEnv,
  resetOutboundHandlerDepsCacheForTests,
  resolveDefaultOutboundHandlerDepsForTests,
  type OutboundSqsEvent,
} from "./outbound-handler.js";

const FIXED_TIME = "2026-07-23T12:00:00.000Z";
const DURABLE_EXECUTION_ID =
  "arn:aws:lambda:us-east-1:123456789012:function:edi-outbound:live/durable-execution/job-new-1/abc123";

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
      newId: () => "job-new-1",
    },
    processorDeps: {
      store,
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

function sqsEventFromQueueMessage(
  message: ReturnType<typeof parseOutboundQueueMessage>,
): OutboundSqsEvent {
  return {
    Records: [{ body: JSON.stringify(message) }],
  };
}

describe("readOutboundHandlerEnv", () => {
  it("requires EDI_JOB_TABLE_NAME", () => {
    expect(() => readOutboundHandlerEnv({})).toThrow(
      "EDI_JOB_TABLE_NAME must be set",
    );
  });

  it("reads configured env vars", () => {
    expect(
      readOutboundHandlerEnv({
        EDI_JOB_TABLE_NAME: "edi-jobs",
      }),
    ).toEqual({
      ediJobTableName: "edi-jobs",
    });
  });
});

describe("createOutboundHandlerDeps", () => {
  it("wires DynamoDB store", () => {
    const deps = createOutboundHandlerDeps({
      ediJobTableName: "edi-jobs",
    });
    expect(deps.store).toBeDefined();
  });
});

describe("readDurableExecutionId", () => {
  it("reads durableExecutionArn from durable context", () => {
    expect(
      readDurableExecutionId({
        executionContext: { durableExecutionArn: DURABLE_EXECUTION_ID },
      }),
    ).toBe(DURABLE_EXECUTION_ID);
  });
});

describe("outbound durable Lambda handler", () => {
  it("consumes an SQS FIFO message and runs OUTBOUND_214 through succeeded", async () => {
    const { enqueueDeps, processorDeps, outboundQueue } = handlerDeps();
    await enqueue(enqueueDeps, outbound214Input());
    const event = sqsEventFromQueueMessage(outboundQueue.messages[0]!.message);

    const results = await processOutboundSqsEvent(
      processorDeps,
      event,
      DURABLE_EXECUTION_ID,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "job-new-1",
      status: "succeeded",
      jobType: "OUTBOUND_214",
      durableExecutionId: DURABLE_EXECUTION_ID,
    });

    const persisted = await processorDeps.store.getById("job-new-1");
    expect(persisted).toEqual(results[0]);
  });

  it("delegates through createOutboundDurableHandler with injected deps", async () => {
    const { enqueueDeps, processorDeps, outboundQueue } = handlerDeps();
    await enqueue(enqueueDeps, outbound214Input());
    const invoke = createOutboundDurableHandler(() => processorDeps);

    const results = await invoke(sqsEventFromQueueMessage(outboundQueue.messages[0]!.message), {
      executionContext: { durableExecutionArn: DURABLE_EXECUTION_ID },
    } as Parameters<typeof invoke>[1]);

    expect(results[0]).toMatchObject({
      status: "succeeded",
      durableExecutionId: DURABLE_EXECUTION_ID,
    });
  });

  it("parses refs-only queue bodies", () => {
    const message = {
      jobId: "job-1",
      jobType: "OUTBOUND_214" as const,
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
      orderingGroup: "cfg-partner-a#SHP-1001",
    };

    expect(parseOutboundQueueMessage(JSON.stringify(message))).toEqual(message);
  });

  it("reuses module-scope deps when using the default resolver", () => {
    resetOutboundHandlerDepsCacheForTests();
    process.env.EDI_JOB_TABLE_NAME = "edi-jobs";

    const first = resolveDefaultOutboundHandlerDepsForTests();
    const second = resolveDefaultOutboundHandlerDepsForTests();

    expect(first).toBe(second);
    expect(first.store).toBe(second.store);
  });
});
