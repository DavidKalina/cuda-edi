import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { EdiJob, JobType } from "../domain/edi-job.js";
import { isIdempotencyReplayable } from "../domain/edi-job.js";
import type { EdiJobStore } from "./edi-job-store.js";

export const IDEMPOTENCY_INDEX_NAME = "idempotency-index";

export function idempotencyPk(jobType: JobType, idempotencyKey: string): string {
  return `${jobType}#${idempotencyKey}`;
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
    payloadRef: item.payloadRef as EdiJob["payloadRef"],
    artifactRefs: (item.artifactRefs as EdiJob["artifactRefs"]) ?? [],
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
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
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: IDEMPOTENCY_INDEX_NAME,
        KeyConditionExpression: "idempotencyPk = :pk",
        ExpressionAttributeValues: {
          ":pk": idempotencyPk(jobType, idempotencyKey),
        },
        Limit: 1,
      }),
    );

    const item = result.Items?.[0];
    if (!item) {
      return null;
    }

    const job = fromItem(item);
    if (!isIdempotencyReplayable(job.status)) {
      return null;
    }
    return job;
  }

  async getById(id: string): Promise<EdiJob | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id },
      }),
    );

    if (!result.Item) {
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
}
