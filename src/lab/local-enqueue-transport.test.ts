import { describe, expect, it } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import {
  createLabEnqueueTransport,
  createLocalEnqueueTransport,
} from "./local-enqueue-transport.js";

const FIXED_TIME = "2026-07-23T12:00:00.000Z";

function outbound214Input() {
  return {
    jobType: "OUTBOUND_214" as const,
    ediConfigId: "cfg-landa-5oq",
    businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-LAB-1" },
    idempotencyKey: "milestone:SHP-LAB-1:214",
  };
}

describe("createLocalEnqueueTransport", () => {
  it("calls the real enqueue module and hands off to the outbound queue", async () => {
    const { enqueue, outboundQueue } = createLabEnqueueTransport({
      now: () => FIXED_TIME,
      newId: () => "job-local-1",
    });

    const job = await enqueue(outbound214Input());

    expect(job).toMatchObject({
      id: "job-local-1",
      status: "queued",
      jobType: "OUTBOUND_214",
      ediConfigId: "cfg-landa-5oq",
      orderingGroup: "cfg-landa-5oq#SHP-LAB-1",
      handedOff: true,
    });

    const [received] = await outboundQueue.receive();
    expect(received!.message).toMatchObject({
      jobId: "job-local-1",
      jobType: "OUTBOUND_214",
      orderingGroup: "cfg-landa-5oq#SHP-LAB-1",
    });
    expect(received!.messageGroupId).toBe("cfg-landa-5oq#SHP-LAB-1");
  });

  it("returns the same job on idempotent replay without double queue delivery", async () => {
    const { enqueue, outboundQueue, store } = createLabEnqueueTransport({
      now: () => FIXED_TIME,
      newId: () => "job-local-2",
    });
    const input = outbound214Input();

    const first = await enqueue(input);
    const second = await enqueue(input);

    expect(second).toEqual(first);
    expect(await store.findByIdempotencyKey(input.jobType, input.idempotencyKey))
      .toEqual(first);

    const [onlyMessage] = await outboundQueue.receive();
    expect(onlyMessage!.message.jobId).toBe("job-local-2");
    expect(await outboundQueue.receive()).toHaveLength(0);
  });

  it("shares injectable deps when constructed directly", async () => {
    const lab = createLabEnqueueTransport({
      now: () => FIXED_TIME,
      newId: () => "job-shared-deps",
    });
    const transport = createLocalEnqueueTransport(lab.deps);

    const job = await transport(outbound214Input());

    expect(job.id).toBe("job-shared-deps");
    const [received] = await lab.outboundQueue.receive();
    expect(received!.message.jobId).toBe("job-shared-deps");
  });
});
