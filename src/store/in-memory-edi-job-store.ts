import type { EdiJob, JobType } from "../domain/edi-job.js";
import { isIdempotencyReplayable } from "../domain/edi-job.js";
import type { EdiJobStore } from "./edi-job-store.js";

function idempotencyIndexKey(jobType: JobType, idempotencyKey: string): string {
  return `${jobType}#${idempotencyKey}`;
}

export class InMemoryEdiJobStore implements EdiJobStore {
  private readonly byId = new Map<string, EdiJob>();
  private readonly byIdempotencyKey = new Map<string, string>();

  async findByIdempotencyKey(
    jobType: JobType,
    idempotencyKey: string,
  ): Promise<EdiJob | null> {
    const jobId = this.byIdempotencyKey.get(
      idempotencyIndexKey(jobType, idempotencyKey),
    );
    if (!jobId) {
      return null;
    }
    const job = this.byId.get(jobId);
    if (!job || !isIdempotencyReplayable(job.status)) {
      return null;
    }
    return job;
  }

  async getById(id: string): Promise<EdiJob | null> {
    return this.byId.get(id) ?? null;
  }

  async put(job: EdiJob): Promise<EdiJob> {
    this.byId.set(job.id, job);
    this.byIdempotencyKey.set(
      idempotencyIndexKey(job.jobType, job.idempotencyKey),
      job.id,
    );
    return job;
  }
}
