import { randomUUID } from "node:crypto";
import {
  computeOrderingGroup,
  type CreateEdiJobInput,
  type EdiJob,
} from "../domain/edi-job.js";
import { findReplayableJob, type EdiJobStore } from "../store/edi-job-store.js";
import type { OutboundQueue } from "./outbound-queue.js";

export interface EnqueueDeps {
  store: EdiJobStore;
  outboundQueue: OutboundQueue;
  now?: () => string;
  newId?: () => string;
}

export async function enqueue(
  deps: EnqueueDeps,
  input: CreateEdiJobInput,
): Promise<EdiJob> {
  const existing = await findReplayableJob(
    deps.store,
    input.jobType,
    input.idempotencyKey,
  );
  if (existing) {
    return existing;
  }

  const orderingGroup = computeOrderingGroup(
    input.ediConfigId,
    input.businessKeys,
  );
  const timestamp = deps.now?.() ?? new Date().toISOString();
  const job: EdiJob = {
    id: deps.newId?.() ?? randomUUID(),
    status: "queued",
    jobType: input.jobType,
    ediConfigId: input.ediConfigId,
    businessKeys: input.businessKeys,
    idempotencyKey: input.idempotencyKey,
    orderingGroup,
    payloadRef: input.payloadRef,
    artifactRefs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await deps.store.put(job);
  await deps.outboundQueue.send(
    {
      jobId: job.id,
      jobType: job.jobType,
      ediConfigId: job.ediConfigId,
      businessKeys: job.businessKeys,
      idempotencyKey: job.idempotencyKey,
      orderingGroup: job.orderingGroup,
      ...(job.payloadRef ? { payloadRef: job.payloadRef } : {}),
    },
    { messageGroupId: orderingGroup },
  );

  return job;
}
