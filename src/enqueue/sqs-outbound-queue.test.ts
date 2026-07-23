import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { describe, expect, it, beforeEach } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { SqsOutboundQueue } from "./sqs-outbound-queue.js";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/edi-outbound.fifo";

describe("SqsOutboundQueue", () => {
  const sqsMock = mockClient(SQSClient);
  let queue: SqsOutboundQueue;

  beforeEach(() => {
    sqsMock.reset();
    queue = new SqsOutboundQueue(new SQSClient({}), QUEUE_URL);
  });

  it("sends a refs-only message with FIFO ordering group", async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: "msg-1" });

    const message = {
      jobId: "job-1",
      jobType: "OUTBOUND_214" as const,
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
      orderingGroup: "cfg-partner-a#SHP-1001",
    };

    await queue.send(message, { messageGroupId: "cfg-partner-a#SHP-1001" });

    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
    const input = sqsMock.commandCalls(SendMessageCommand)[0]!.args[0].input;
    expect(input.QueueUrl).toBe(QUEUE_URL);
    expect(input.MessageGroupId).toBe("cfg-partner-a#SHP-1001");
    expect(input.MessageDeduplicationId).toBe("job-1");
    expect(JSON.parse(input.MessageBody!)).toEqual(message);
    expect(input.MessageBody).not.toMatch(/ISA\*|GS\*|ST\*/);
  });
});
