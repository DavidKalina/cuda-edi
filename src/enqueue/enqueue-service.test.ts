import { describe, expect, it } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import { enqueue } from "./enqueue-service.js";
import { InMemoryOutboundQueue } from "./in-memory-outbound-queue.js";

const FIXED_TIME = "2026-07-23T12:00:00.000Z";

function enqueueDeps() {
  const store = new InMemoryEdiJobStore();
  const outboundQueue = new InMemoryOutboundQueue();
  return {
    store,
    outboundQueue,
    deps: {
      store,
      outboundQueue,
      now: () => FIXED_TIME,
      newId: () => "job-new-1",
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

describe("enqueue", () => {
  it("creates an OUTBOUND_214 job in queued status and publishes to the outbound FIFO", async () => {
    const { deps, outboundQueue } = enqueueDeps();

    const job = await enqueue(deps, outbound214Input());

    expect(job).toMatchObject({
      id: "job-new-1",
      status: "queued",
      jobType: "OUTBOUND_214",
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
      orderingGroup: "cfg-partner-a#SHP-1001",
      artifactRefs: [],
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    });
    expect(outboundQueue.messages).toHaveLength(1);
    expect(outboundQueue.messages[0]).toEqual({
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

  it("queue message body carries refs and keys only, not document bytes", async () => {
    const { deps, outboundQueue } = enqueueDeps();

    await enqueue(deps, {
      ...outbound214Input(),
      payloadRef: { bucket: "edi-payloads", key: "inbound/foo.x12" },
    });

    const body = outboundQueue.messages[0]!.message;
    expect(body).toEqual({
      jobId: "job-new-1",
      jobType: "OUTBOUND_214",
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
      orderingGroup: "cfg-partner-a#SHP-1001",
      payloadRef: { bucket: "edi-payloads", key: "inbound/foo.x12" },
    });
    expect(JSON.stringify(body)).not.toMatch(/ISA\*|GS\*|ST\*/);
  });

  it("returns the existing job on duplicate enqueue without a second queue message", async () => {
    const { deps, outboundQueue } = enqueueDeps();
    const input = outbound214Input();

    const first = await enqueue(deps, input);
    const second = await enqueue(deps, input);

    expect(second).toBe(first);
    expect(outboundQueue.messages).toHaveLength(1);
  });

  it("creates a new job when the prior job with the same idempotency key is dead", async () => {
    const { store, deps, outboundQueue } = enqueueDeps();
    const input = outbound214Input();

    const dead = await enqueue(deps, input);
    await store.put({ ...dead, status: "dead" });

    const replay = await enqueue(
      {
        ...deps,
        newId: () => "job-new-2",
      },
      input,
    );

    expect(replay.id).toBe("job-new-2");
    expect(replay.status).toBe("queued");
    expect(replay.handedOff).toBe(true);
    expect(outboundQueue.messages).toHaveLength(2);
  });

  it("re-sends to the outbound queue on replay when persist succeeded but handoff failed", async () => {
    const store = new InMemoryEdiJobStore();
    const outboundQueue = new InMemoryOutboundQueue();
    const failingQueue = {
      send: async () => {
        throw new Error("sqs unavailable");
      },
    };
    const input = outbound214Input();
    const baseDeps = {
      store,
      now: () => FIXED_TIME,
      newId: () => "job-new-1",
    };

    await expect(
      enqueue({ ...baseDeps, outboundQueue: failingQueue }, input),
    ).rejects.toThrow("sqs unavailable");

    const replay = await enqueue(
      { ...baseDeps, outboundQueue },
      input,
    );

    expect(replay.id).toBe("job-new-1");
    expect(replay.handedOff).toBe(true);
    expect(outboundQueue.messages).toHaveLength(1);
  });
});
