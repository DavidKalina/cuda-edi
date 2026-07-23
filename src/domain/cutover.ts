import type { JobType } from "./edi-job.js";

/** Composite key for a job type × EDI Config cutover switch. */
export function cutoverKey(ediConfigId: string, jobType: JobType): string {
  return `${ediConfigId}#${jobType}`;
}

/**
 * Per job type × EDI Config routing switch.
 * When cudaEdiEnabled is false (default), producers route to Legacy EDI.
 */
export interface CutoverEntry {
  ediConfigId: string;
  jobType: JobType;
  cudaEdiEnabled: boolean;
}
