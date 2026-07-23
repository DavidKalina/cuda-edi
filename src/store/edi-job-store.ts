import type { EdiJob, JobType } from "../domain/edi-job.js";
import { isIdempotencyReplayable } from "../domain/edi-job.js";

export interface EdiJobStore {
  /** Returns an existing non-dead job for the idempotency key, if any. */
  findByIdempotencyKey(
    jobType: JobType,
    idempotencyKey: string,
  ): Promise<EdiJob | null>;

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
