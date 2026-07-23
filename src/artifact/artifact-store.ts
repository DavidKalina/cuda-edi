import type { ArtifactRef } from "../domain/edi-job.js";

export interface StoreArtifactInput {
  jobId: string;
  ediConfigId: string;
  /** Artifact bytes (e.g. generated X12). */
  content: string | Uint8Array;
  /** Artifact kind stored on the job ref (e.g. "x12"). */
  kind: string;
  contentType?: string;
}

export interface ArtifactStore {
  put(input: StoreArtifactInput): Promise<ArtifactRef>;
  get(ref: ArtifactRef): Promise<Uint8Array | undefined>;
}
