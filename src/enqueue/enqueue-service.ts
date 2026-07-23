import { randomUUID } from "node:crypto";
import {
  computeOrderingGroup,
  isIdempotencyReplayable,
  type CreateEdiJobInput,
  type EdiJob,
} from "../domain/edi-job.js";
import { findReplayableJob, type EdiJobStore } from "../store/edi-job-store.js";
import type { OutboundQueue } from "./outbound-queue.js";
import { jobToOutboundMessage } from "./outbound-queue.js";

export interface EnqueueDeps {
  store: EdiJobStore;
  outboundQueue: OutboundQueue;
  now?: () => string;
  newId?: () => string;
}

async function sendOutboundMessage(
  deps: EnqueueDeps,
  job: EdiJob,
): Promise<void> {
  await deps.outboundQueue.send(jobToOutboundMessage(job), {
    messageGroupId: job.orderingGroup,
  });
}

async function ensureOutboundHandoff(
  deps: EnqueueDeps,
  job: EdiJob,
): Promise<EdiJob> {
  if (job.status === "queued" && !job.handedOff) {
    await sendOutboundMessage(deps, job);
    const timestamp = deps.now?.() ?? new Date().toISOString();
    return deps.store.put({ ...job, handedOff: true, updatedAt: timestamp });
  }
  return job;
}

async function resolveIdempotentJob(
  deps: EnqueueDeps,
  job: EdiJob,
): Promise<EdiJob> {
  if (!isIdempotencyReplayable(job.status)) {
    throw new Error(`job ${job.id} is not replayable`);
  }
  return ensureOutboundHandoff(deps, job);
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
    return resolveIdempotentJob(deps, existing);
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
    attempt: 1,
    handedOff: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const claim = await deps.store.claimIdempotencyKey(
    input.jobType,
    input.idempotencyKey,
    job.id,
  );
  if (claim.outcome === "conflict") {
    const replayable =
      (await findReplayableJob(
        deps.store,
        input.jobType,
        input.idempotencyKey,
      )) ?? (await deps.store.getById(claim.jobId));
    if (replayable) {
      return resolveIdempotentJob(deps, replayable);
    }
    throw new Error(
      `idempotency claim conflict for ${input.jobType}#${input.idempotencyKey}`,
    );
  }

  await deps.store.put(job);
  try {
    await sendOutboundMessage(deps, job);
  } catch (error) {
    // Persisted without handoff; a retry will re-send via ensureOutboundHandoff.
    throw error;
  }

  return deps.store.put({
    ...job,
    handedOff: true,
    updatedAt: deps.now?.() ?? new Date().toISOString(),
  });
}
