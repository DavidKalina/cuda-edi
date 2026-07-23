import type { ArtifactRef } from "../domain/edi-job.js";
import type { ArtifactStore, StoreArtifactInput } from "./artifact-store.js";

export interface InMemoryArtifactStoreOptions {
  bucket?: string;
}

export interface StoredArtifact {
  ref: ArtifactRef;
  content: Uint8Array;
  contentType?: string;
  jobId: string;
  ediConfigId: string;
}

/** Test/dev artifact store — retains bytes in memory and returns object-storage refs. */
export class InMemoryArtifactStore implements ArtifactStore {
  readonly bucket: string;
  readonly artifacts = new Map<string, StoredArtifact>();

  constructor(options: InMemoryArtifactStoreOptions = {}) {
    this.bucket = options.bucket ?? "edi-artifacts";
  }

  async put(input: StoreArtifactInput): Promise<ArtifactRef> {
    const key = `${input.ediConfigId}/${input.jobId}/${input.kind}`;
    const content =
      typeof input.content === "string"
        ? new TextEncoder().encode(input.content)
        : input.content;
    const ref: ArtifactRef = {
      bucket: this.bucket,
      key,
      kind: input.kind,
    };

    this.artifacts.set(key, {
      ref,
      content,
      contentType: input.contentType,
      jobId: input.jobId,
      ediConfigId: input.ediConfigId,
    });

    return ref;
  }

  getByKey(key: string): StoredArtifact | undefined {
    return this.artifacts.get(key);
  }

  async get(ref: ArtifactRef): Promise<Uint8Array | undefined> {
    return this.artifacts.get(ref.key)?.content;
  }
}
