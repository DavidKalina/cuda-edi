import { describe, expect, it } from "vitest";
import { InMemoryArtifactStore } from "../artifact/in-memory-artifact-store.js";
import { InMemoryControlNumberAllocator } from "../control-number/in-memory-control-number-allocator.js";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { enqueue } from "../enqueue/enqueue-service.js";
import { InMemoryOutboundQueue } from "../enqueue/in-memory-outbound-queue.js";
import { JsonataMapExecutor } from "../map/jsonata-map-executor.js";
import { InMemoryEdiConfigStore } from "../store/in-memory-edi-config-store.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import {
  partnerAControlNumberSeeds,
  partnerAEdiConfig,
} from "../test-fixtures/partner-a-edi-config.js";
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
  const ediConfigStore = new InMemoryEdiConfigStore([partnerAEdiConfig()]);
  const controlNumberAllocator = new InMemoryControlNumberAllocator(
    partnerAControlNumberSeeds(),
  );
  const mapExecutor = new JsonataMapExecutor();
  const artifactStore = new InMemoryArtifactStore();
  return {
    store,
    outboundQueue,
    artifactStore,
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
  it("requires outbound handler env vars", () => {
    expect(() => readOutboundHandlerEnv({})).toThrow(
      "EDI_JOB_TABLE_NAME, EDI_CONFIG_TABLE_NAME, EDI_CONTROL_NUMBER_TABLE_NAME, and EDI_ARTIFACTS_BUCKET must be set",
    );
  });

  it("reads configured env vars", () => {
    expect(
      readOutboundHandlerEnv({
        EDI_JOB_TABLE_NAME: "edi-jobs",
        EDI_CONFIG_TABLE_NAME: "edi-configs",
        EDI_CONTROL_NUMBER_TABLE_NAME: "edi-control-numbers",
        EDI_ARTIFACTS_BUCKET: "edi-artifacts",
      }),
    ).toEqual({
      ediJobTableName: "edi-jobs",
      ediConfigTableName: "edi-configs",
      controlNumberTableName: "edi-control-numbers",
      artifactsBucket: "edi-artifacts",
    });
  });
});

describe("createOutboundHandlerDeps", () => {
  it("wires DynamoDB store and outbound processor deps", () => {
    const deps = createOutboundHandlerDeps({
      ediJobTableName: "edi-jobs",
      ediConfigTableName: "edi-configs",
      controlNumberTableName: "edi-control-numbers",
      artifactsBucket: "edi-artifacts",
    });
    expect(deps.store).toBeDefined();
    expect(deps.ediConfigStore).toBeDefined();
    expect(deps.controlNumberAllocator).toBeDefined();
    expect(deps.mapExecutor).toBeDefined();
    expect(deps.artifactStore).toBeDefined();
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
    const { enqueueDeps, processorDeps, outboundQueue, artifactStore } =
      handlerDeps();
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
    expect(results[0]!.artifactRefs).toHaveLength(2);

    const stored = artifactStore.getByKey("cfg-partner-a/job-new-1/x12");
    expect(stored).toBeDefined();
    const x12 = new TextDecoder().decode(stored!.content);
    expect(x12).toContain("B10*SHP-1001~");

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
    process.env.EDI_CONFIG_TABLE_NAME = "edi-configs";
    process.env.EDI_CONTROL_NUMBER_TABLE_NAME = "edi-control-numbers";
    process.env.EDI_ARTIFACTS_BUCKET = "edi-artifacts";

    const first = resolveDefaultOutboundHandlerDepsForTests();
    const second = resolveDefaultOutboundHandlerDepsForTests();

    expect(first).toBe(second);
    expect(first.store).toBe(second.store);
  });
});
