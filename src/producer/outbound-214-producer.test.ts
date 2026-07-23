import { describe, expect, it, vi } from "vitest";
import { InMemoryCutoverStore } from "../cutover/in-memory-cutover-store.js";
import {
  SHIPMENT_BUSINESS_KEY,
  type CreateEdiJobInput,
} from "../domain/edi-job.js";
import { enqueue } from "../enqueue/enqueue-service.js";
import { InMemoryOutboundQueue } from "../enqueue/in-memory-outbound-queue.js";
import type { EnqueueFn } from "../sdk/enqueue-client.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import { InMemoryLegacyOutboundClient } from "./legacy-outbound-client.js";
import { produceOutbound214 } from "./outbound-214-producer.js";

const FIXED_TIME = "2026-07-23T12:00:00.000Z";

function outbound214Input(): CreateEdiJobInput {
  return {
    jobType: "OUTBOUND_214",
    ediConfigId: "cfg-partner-a",
    businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
    idempotencyKey: "milestone:SHP-1001:214",
  };
}

function producerDeps(
  cutoverSeed: { ediConfigId: string; jobType: "OUTBOUND_214" }[] = [],
) {
  const store = new InMemoryEdiJobStore();
  const outboundQueue = new InMemoryOutboundQueue();
  const legacy = new InMemoryLegacyOutboundClient();
  const cutoverStore = new InMemoryCutoverStore(cutoverSeed);
  const enqueueFn: EnqueueFn = (input) =>
    enqueue(
      {
        store,
        outboundQueue,
        now: () => FIXED_TIME,
        newId: () => "job-new-1",
      },
      input,
    );

  return {
    store,
    outboundQueue,
    legacy,
    cutoverStore,
    deps: {
      cutoverStore,
      enqueue: enqueueFn,
      legacy,
    },
  };
}

describe("produceOutbound214", () => {
  it("routes to cuda-edi Enqueue when cutover is enabled for that config", async () => {
    const { deps, outboundQueue, legacy } = producerDeps([
      { ediConfigId: "cfg-partner-a", jobType: "OUTBOUND_214" },
    ]);

    const result = await produceOutbound214(deps, outbound214Input());

    expect(result).toMatchObject({
      runtime: "cuda-edi",
      job: {
        id: "job-new-1",
        jobType: "OUTBOUND_214",
        ediConfigId: "cfg-partner-a",
      },
    });
    expect(outboundQueue.messages).toHaveLength(1);
    expect(legacy.requests).toHaveLength(0);
  });

  it("routes to Legacy only when cutover is off (default)", async () => {
    const { deps, store, outboundQueue, legacy } = producerDeps();

    const result = await produceOutbound214(deps, outbound214Input());

    expect(result).toEqual({ runtime: "legacy" });
    expect(legacy.requests).toEqual([outbound214Input()]);
    expect(outboundQueue.messages).toHaveLength(0);
    expect(await store.getById("job-new-1")).toBeNull();
  });

  it("never dual-enqueues cuda-edi and Legacy for the same intent", async () => {
    const { deps, outboundQueue, legacy } = producerDeps([
      { ediConfigId: "cfg-partner-a", jobType: "OUTBOUND_214" },
    ]);
    const input = outbound214Input();
    const enqueueSpy = vi.fn(deps.enqueue);
    const legacySpy = vi.spyOn(legacy, "sendOutbound214");

    await produceOutbound214({ ...deps, enqueue: enqueueSpy }, input);

    expect(enqueueSpy).toHaveBeenCalledOnce();
    expect(enqueueSpy).toHaveBeenCalledWith(input);
    expect(legacySpy).not.toHaveBeenCalled();
    expect(outboundQueue.messages).toHaveLength(1);

    legacySpy.mockClear();
    enqueueSpy.mockClear();
    outboundQueue.messages.length = 0;

    const offDeps = producerDeps();
    const offEnqueueSpy = vi.fn(offDeps.deps.enqueue);
    const offLegacySpy = vi.spyOn(offDeps.legacy, "sendOutbound214");

    await produceOutbound214(
      { ...offDeps.deps, enqueue: offEnqueueSpy },
      input,
    );

    expect(offLegacySpy).toHaveBeenCalledOnce();
    expect(offLegacySpy).toHaveBeenCalledWith(input);
    expect(offEnqueueSpy).not.toHaveBeenCalled();
    expect(offDeps.outboundQueue.messages).toHaveLength(0);
  });

  it("rejects non-OUTBOUND_214 job types", async () => {
    const { deps } = producerDeps();

    await expect(
      produceOutbound214(deps, {
        ...outbound214Input(),
        jobType: "INBOUND_204",
      }),
    ).rejects.toThrow("expected OUTBOUND_214");
  });
});
