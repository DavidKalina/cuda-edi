import type { JobType } from "../domain/edi-job.js";

/**
 * Read-only cutover routing per job type × EDI Config.
 * Defaults to Legacy (cuda-edi off) when no explicit entry exists.
 */
export interface CutoverStore {
  isCudaEdiEnabled(ediConfigId: string, jobType: JobType): Promise<boolean>;
}
