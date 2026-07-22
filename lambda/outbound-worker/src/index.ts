/**
 * Outbound worker stub.
 * Ticket #4: durable workflow shell + job-type switch.
 * Ticket #5: real OUTBOUND_214 (Map → CN → Artifact → mailbox).
 */
import type { SQSEvent, SQSHandler } from "aws-lambda";
import type { QueueJobMessage } from "@cuda-edi/edi-core";

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.body) as QueueJobMessage;
    switch (message.jobType) {
      case "OUTBOUND_214":
        // Durable steps land in #4/#5.
        console.log(
          JSON.stringify({
            msg: "outbound stub received",
            jobId: message.jobId,
            jobType: message.jobType,
            orderingGroup: message.orderingGroup,
          })
        );
        break;
      default:
        throw new Error(`Unsupported outbound job type: ${message.jobType}`);
    }
  }
};
