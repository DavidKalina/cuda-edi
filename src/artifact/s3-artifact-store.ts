import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NoSuchKey } from "@aws-sdk/client-s3";
import type { ArtifactRef } from "../domain/edi-job.js";
import type { ArtifactStore, StoreArtifactInput } from "./artifact-store.js";

export class S3ArtifactStore implements ArtifactStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(input: StoreArtifactInput): Promise<ArtifactRef> {
    const key = `${input.ediConfigId}/${input.jobId}/${input.kind}`;
    const body =
      typeof input.content === "string"
        ? new TextEncoder().encode(input.content)
        : input.content;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ...(input.contentType ? { ContentType: input.contentType } : {}),
      }),
    );

    return {
      bucket: this.bucket,
      key,
      kind: input.kind,
    };
  }

  async get(ref: ArtifactRef): Promise<Uint8Array | undefined> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: ref.bucket,
          Key: ref.key,
        }),
      );
      const bytes = await response.Body?.transformToByteArray();
      return bytes;
    } catch (error) {
      if (error instanceof NoSuchKey) {
        return undefined;
      }
      throw error;
    }
  }
}
