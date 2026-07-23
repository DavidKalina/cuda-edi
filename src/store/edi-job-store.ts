import type { EdiJob, JobType } from "../domain/edi-job.js";
import { isIdempotencyReplayable } from "../domain/edi-job.js";

export type IdempotencyClaimResult =
  | { outcome: "claimed" }
  | { outcome: "conflict"; jobId: string };

export interface EdiJobStore {
  /** Returns an existing non-dead job for the idempotency key, if any. */
  findByIdempotencyKey(
    jobType: JobType,
    idempotencyKey: string,
  ): Promise<EdiJob | null>;

  /**
   * Atomically claims an idempotency key for a new job. On conflict the
   * existing claimant job id is returned so the caller can replay it.
   */
  claimIdempotencyKey(
    jobType: JobType,
    idempotencyKey: string,
    jobId: string,
  ): Promise<IdempotencyClaimResult>;

  getById(id: string): Promise<EdiJob | null>;

  put(job: EdiJob): Promise<EdiJob>;
}

export async function findReplayableJob(
  store: EdiJobStore,
  jobType: JobType,
  idempotencyKey: string,
): Promise<EdiJob | null> {
  const existing = await store.findByIdempotencyKey(jobType, idempotencyKey);
  if (existing && isIdempotencyReplayable(existing.status)) {
    return existing;
  }
  return null;
}
