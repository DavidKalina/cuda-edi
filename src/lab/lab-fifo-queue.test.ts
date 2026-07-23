import { describe, expect, it } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { enqueue } from "../enqueue/enqueue-service.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import { LabFifoQueue } from "./lab-fifo-queue.js";

function outboundMessage(
  jobId: string,
  orderingGroup: string,
): Parameters<LabFifoQueue["send"]>[0] {
  return {
    jobId,
    jobType: "OUTBOUND_214",
    ediConfigId: orderingGroup.split("#")[0]!,
    businessKeys: { [SHIPMENT_BUSINESS_KEY]: orderingGroup.split("#")[1]! },
    idempotencyKey: `key:${jobId}`,
    orderingGroup,
  };
}

describe("LabFifoQueue", () => {
  it("delivers messages in FIFO order within a message group", async () => {
    const queue = new LabFifoQueue();
    const group = "cfg-a#SHP-1";

    await queue.send(outboundMessage("job-1", group), { messageGroupId: group });
    await queue.send(outboundMessage("job-2", group), { messageGroupId: group });

    const first = await queue.receive();
    expect(first).toHaveLength(1);
    expect(first[0]!.message.jobId).toBe("job-1");

    const blocked = await queue.receive();
    expect(blocked).toHaveLength(0);

    await queue.deleteMessage(first[0]!.receiptHandle);

    const second = await queue.receive();
    expect(second).toHaveLength(1);
    expect(second[0]!.message.jobId).toBe("job-2");
  });

  it("returns one ready message per group when maxMessages allows", async () => {
    const queue = new LabFifoQueue();

    await queue.send(outboundMessage("job-a1", "cfg-a#SHP-1"), {
      messageGroupId: "cfg-a#SHP-1",
    });
    await queue.send(outboundMessage("job-b1", "cfg-b#SHP-2"), {
      messageGroupId: "cfg-b#SHP-2",
    });

    const batch = await queue.receive({ maxMessages: 10 });
    expect(batch.map((m) => m.message.jobId).sort()).toEqual([
      "job-a1",
      "job-b1",
    ]);
  });

  it("works as the OutboundQueue dependency for enqueue", async () => {
    const store = new InMemoryEdiJobStore();
    const outboundQueue = new LabFifoQueue();
    const job = await enqueue(
      {
        store,
        outboundQueue,
        now: () => "2026-07-23T12:00:00.000Z",
        newId: () => "job-lab-1",
      },
      {
        jobType: "OUTBOUND_214",
        ediConfigId: "cfg-landa-5oq",
        businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-LAB-1" },
        idempotencyKey: "milestone:SHP-LAB-1:214",
      },
    );

    const [received] = await outboundQueue.receive();
    expect(received!.message).toMatchObject({
      jobId: job.id,
      jobType: "OUTBOUND_214",
      ediConfigId: "cfg-landa-5oq",
      orderingGroup: "cfg-landa-5oq#SHP-LAB-1",
    });
    expect(received!.messageGroupId).toBe("cfg-landa-5oq#SHP-LAB-1");
  });
});
