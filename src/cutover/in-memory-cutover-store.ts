import { cutoverKey } from "../domain/cutover.js";
import type { JobType } from "../domain/edi-job.js";
import type { CutoverStore } from "./cutover-store.js";

export interface CutoverSeed {
  ediConfigId: string;
  jobType: JobType;
}

/** In-memory cutover store for tests; unseeded keys default to Legacy (off). */
export class InMemoryCutoverStore implements CutoverStore {
  private readonly cudaEdiEnabled = new Set<string>();

  constructor(seed: CutoverSeed[] = []) {
    for (const entry of seed) {
      this.cudaEdiEnabled.add(cutoverKey(entry.ediConfigId, entry.jobType));
    }
  }

  async isCudaEdiEnabled(
    ediConfigId: string,
    jobType: JobType,
  ): Promise<boolean> {
    return this.cudaEdiEnabled.has(cutoverKey(ediConfigId, jobType));
  }
}
