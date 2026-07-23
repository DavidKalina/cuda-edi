import type { EdiJob, JobType, PayloadRef } from "../domain/edi-job.js";

/** Refs and keys only — no EDI document bytes in the queue body. */
export function jobToOutboundMessage(job: EdiJob): OutboundQueueMessage {
  return {
    jobId: job.id,
    jobType: job.jobType,
    ediConfigId: job.ediConfigId,
    businessKeys: job.businessKeys,
    idempotencyKey: job.idempotencyKey,
    orderingGroup: job.orderingGroup,
    ...(job.payloadRef ? { payloadRef: job.payloadRef } : {}),
  };
}

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
