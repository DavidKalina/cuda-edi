import {
  isRedrivable,
  jobAttempt,
  type EdiJob,
} from "../domain/edi-job.js";
import { jobToOutboundMessage } from "../enqueue/outbound-queue.js";
import type { OutboundQueue } from "../enqueue/outbound-queue.js";
import type { EdiJobStore } from "../store/edi-job-store.js";

export interface RedriveInput {
  jobId: string;
}

export interface RedriveDeps {
  store: EdiJobStore;
  outboundQueue: OutboundQueue;
  now?: () => string;
}

export class RedriveNotAllowedError extends Error {
  constructor(jobId: string, status: string) {
    super(`EDI Job ${jobId} cannot be redriven from status ${status}`);
    this.name = "RedriveNotAllowedError";
  }
}

export async function redrive(
  deps: RedriveDeps,
  input: RedriveInput,
): Promise<EdiJob> {
  const job = await deps.store.getById(input.jobId);
  if (!job) {
    throw new Error(`EDI Job not found: ${input.jobId}`);
  }

  if (!isRedrivable(job.status)) {
    throw new RedriveNotAllowedError(job.id, job.status);
  }

  const timestamp = deps.now?.() ?? new Date().toISOString();
  const redriven: EdiJob = {
    ...job,
    status: "queued",
    step: undefined,
    durableExecutionId: undefined,
    attempt: jobAttempt(job) + 1,
    handedOff: false,
    updatedAt: timestamp,
  };

  await deps.store.put(redriven);
  try {
    await deps.outboundQueue.send(jobToOutboundMessage(redriven), {
      messageGroupId: redriven.orderingGroup,
    });
  } catch (error) {
    await deps.store.put(job);
    throw error;
  }

  return deps.store.put({
    ...redriven,
    handedOff: true,
    updatedAt: deps.now?.() ?? new Date().toISOString(),
  });
}
