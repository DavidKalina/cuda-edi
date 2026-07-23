import type { JobType, PayloadRef } from "../domain/edi-job.js";

/** Refs and keys only — no EDI document bytes in the queue body. */
export interface OutboundQueueMessage {
  jobId: string;
  jobType: JobType;
  ediConfigId: string;
  businessKeys: Record<string, string>;
  idempotencyKey: string;
  orderingGroup: string;
  payloadRef?: PayloadRef;
}

export interface SendOutboundMessageOptions {
  messageGroupId: string;
}

export interface OutboundQueue {
  send(
    message: OutboundQueueMessage,
    options: SendOutboundMessageOptions,
  ): Promise<void>;
}
