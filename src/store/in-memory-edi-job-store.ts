import type { EdiJob, JobType } from "../domain/edi-job.js";
import { isIdempotencyReplayable } from "../domain/edi-job.js";
import type { EdiJobStore, IdempotencyClaimResult } from "./edi-job-store.js";

function idempotencyIndexKey(jobType: JobType, idempotencyKey: string): string {
  return `${jobType}#${idempotencyKey}`;
}

export class InMemoryEdiJobStore implements EdiJobStore {
  private readonly byId = new Map<string, EdiJob>();
  private readonly claims = new Map<string, string>();

  async findByIdempotencyKey(
    jobType: JobType,
    idempotencyKey: string,
  ): Promise<EdiJob | null> {
    for (const job of this.byId.values()) {
      if (
        job.jobType === jobType &&
        job.idempotencyKey === idempotencyKey &&
        isIdempotencyReplayable(job.status)
      ) {
        return job;
      }
    }
    return null;
  }

  async claimIdempotencyKey(
    jobType: JobType,
    idempotencyKey: string,
    jobId: string,
  ): Promise<IdempotencyClaimResult> {
    const key = idempotencyIndexKey(jobType, idempotencyKey);
    const existingJobId = this.claims.get(key);
    if (existingJobId) {
      const existingJob = this.byId.get(existingJobId);
      if (existingJob && isIdempotencyReplayable(existingJob.status)) {
        return { outcome: "conflict", jobId: existingJobId };
      }
    }

    this.claims.set(key, jobId);
    return { outcome: "claimed" };
  }

  async getById(id: string): Promise<EdiJob | null> {
    return this.byId.get(id) ?? null;
  }

  async put(job: EdiJob): Promise<EdiJob> {
    this.byId.set(job.id, job);
    return job;
  }
}
