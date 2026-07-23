import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { EdiJob, JobType } from "../domain/edi-job.js";
import { isIdempotencyReplayable } from "../domain/edi-job.js";
import type { EdiJobStore, IdempotencyClaimResult } from "./edi-job-store.js";

export const IDEMPOTENCY_INDEX_NAME = "idempotency-index";

export function idempotencyPk(jobType: JobType, idempotencyKey: string): string {
  return `${jobType}#${idempotencyKey}`;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    error instanceof ConditionalCheckFailedException ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "ConditionalCheckFailedException")
  );
}

function toItem(job: EdiJob): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    jobType: job.jobType,
    ediConfigId: job.ediConfigId,
    businessKeys: job.businessKeys,
    idempotencyKey: job.idempotencyKey,
    idempotencyPk: idempotencyPk(job.jobType, job.idempotencyKey),
    orderingGroup: job.orderingGroup,
    artifactRefs: job.artifactRefs,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.payloadRef ? { payloadRef: job.payloadRef } : {}),
    ...(job.handedOff ? { handedOff: true } : {}),
    ...(job.step ? { step: job.step } : {}),
    ...(job.durableExecutionId
      ? { durableExecutionId: job.durableExecutionId }
      : {}),
    ...(job.attempt !== undefined ? { attempt: job.attempt } : {}),
  };
}

function fromItem(item: Record<string, unknown>): EdiJob {
  return {
    id: item.id as string,
    status: item.status as EdiJob["status"],
    jobType: item.jobType as EdiJob["jobType"],
    ediConfigId: item.ediConfigId as string,
    businessKeys: item.businessKeys as Record<string, string>,
    idempotencyKey: item.idempotencyKey as string,
    orderingGroup: item.orderingGroup as string,
    artifactRefs: (item.artifactRefs as EdiJob["artifactRefs"]) ?? [],
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    ...(item.payloadRef
      ? { payloadRef: item.payloadRef as EdiJob["payloadRef"] }
      : {}),
    ...(item.handedOff === true ? { handedOff: true } : {}),
    ...(typeof item.step === "string" ? { step: item.step } : {}),
    ...(typeof item.durableExecutionId === "string"
      ? { durableExecutionId: item.durableExecutionId }
      : {}),
    ...(typeof item.attempt === "number" ? { attempt: item.attempt } : {}),
  };
}

export class DynamoEdiJobStore implements EdiJobStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async findByIdempotencyKey(
    jobType: JobType,
    idempotencyKey: string,
  ): Promise<EdiJob | null> {
    const pk = idempotencyPk(jobType, idempotencyKey);
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: IDEMPOTENCY_INDEX_NAME,
          KeyConditionExpression: "idempotencyPk = :pk",
          ExpressionAttributeValues: {
            ":pk": pk,
          },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      for (const item of result.Items ?? []) {
        const job = fromItem(item);
        if (isIdempotencyReplayable(job.status)) {
          return job;
        }
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return null;
  }

  async claimIdempotencyKey(
    jobType: JobType,
    idempotencyKey: string,
    jobId: string,
  ): Promise<IdempotencyClaimResult> {
    const pk = idempotencyPk(jobType, idempotencyKey);

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { id: pk, jobId },
          ConditionExpression: "attribute_not_exists(id)",
        }),
      );
      return { outcome: "claimed" };
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }

    const existingClaim = await this.getIdempotencyClaim(pk);
    if (!existingClaim) {
      return this.claimIdempotencyKey(jobType, idempotencyKey, jobId);
    }

    const linkedJob = await this.getById(existingClaim.jobId);
    if (linkedJob && isIdempotencyReplayable(linkedJob.status)) {
      return { outcome: "conflict", jobId: existingClaim.jobId };
    }

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { id: pk, jobId },
          ConditionExpression: "jobId = :existingJobId",
          ExpressionAttributeValues: {
            ":existingJobId": existingClaim.jobId,
          },
        }),
      );
      return { outcome: "claimed" };
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }

    const latestClaim = await this.getIdempotencyClaim(pk);
    return {
      outcome: "conflict",
      jobId: latestClaim?.jobId ?? existingClaim.jobId,
    };
  }

  async getById(id: string): Promise<EdiJob | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id },
      }),
    );

    if (!result.Item || !("jobType" in result.Item)) {
      return null;
    }
    return fromItem(result.Item);
  }

  async put(job: EdiJob): Promise<EdiJob> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toItem(job),
      }),
    );
    return job;
  }

  private async getIdempotencyClaim(
    pk: string,
  ): Promise<{ jobId: string } | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id: pk },
      }),
    );

    if (!result.Item || typeof result.Item.jobId !== "string") {
      return null;
    }
    return { jobId: result.Item.jobId };
  }
}
