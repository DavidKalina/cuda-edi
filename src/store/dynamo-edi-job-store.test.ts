import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { describe, expect, it, beforeEach } from "vitest";
import {
  computeOrderingGroup,
  type EdiJob,
  SHIPMENT_BUSINESS_KEY,
} from "../domain/edi-job.js";
import {
  DynamoEdiJobStore,
  IDEMPOTENCY_INDEX_NAME,
  idempotencyPk,
} from "./dynamo-edi-job-store.js";

const TABLE_NAME = "edi-jobs-test";

function sampleJob(overrides: Partial<EdiJob> = {}): EdiJob {
  const ediConfigId = "cfg-partner-a";
  const businessKeys = { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" };
  const now = "2026-07-23T00:00:00.000Z";
  return {
    id: "job-1",
    status: "queued",
    jobType: "OUTBOUND_214",
    ediConfigId,
    businessKeys,
    idempotencyKey: "milestone:SHP-1001:214",
    orderingGroup: computeOrderingGroup(ediConfigId, businessKeys),
    artifactRefs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("DynamoEdiJobStore", () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  let store: DynamoEdiJobStore;

  beforeEach(() => {
    ddbMock.reset();
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    store = new DynamoEdiJobStore(client, TABLE_NAME);
  });

  it("puts a job with idempotency GSI key", async () => {
    const job = sampleJob();
    ddbMock.on(PutCommand).resolves({});

    await store.put(job);

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    const input = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(input.TableName).toBe(TABLE_NAME);
    expect(input.Item).toMatchObject({
      id: job.id,
      idempotencyPk: idempotencyPk(job.jobType, job.idempotencyKey),
    });
  });

  it("gets a job by id", async () => {
    const job = sampleJob();
    ddbMock.on(GetCommand).resolves({
      Item: {
        ...job,
        idempotencyPk: idempotencyPk(job.jobType, job.idempotencyKey),
      },
    });

    expect(await store.getById(job.id)).toEqual(job);
    expect(ddbMock.commandCalls(GetCommand)[0]!.args[0].input).toMatchObject({
      TableName: TABLE_NAME,
      Key: { id: job.id },
    });
  });

  it("finds a replayable job by idempotency key via GSI", async () => {
    const job = sampleJob();
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          ...job,
          idempotencyPk: idempotencyPk(job.jobType, job.idempotencyKey),
        },
      ],
    });

    expect(
      await store.findByIdempotencyKey("OUTBOUND_214", job.idempotencyKey),
    ).toEqual(job);
    expect(ddbMock.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({
      TableName: TABLE_NAME,
      IndexName: IDEMPOTENCY_INDEX_NAME,
      KeyConditionExpression: "idempotencyPk = :pk",
      ExpressionAttributeValues: {
        ":pk": idempotencyPk("OUTBOUND_214", job.idempotencyKey),
      },
    });
  });

  it("returns null when only dead jobs match the idempotency key", async () => {
    const job = sampleJob({ status: "dead" });
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          ...job,
          idempotencyPk: idempotencyPk(job.jobType, job.idempotencyKey),
        },
      ],
    });

    expect(
      await store.findByIdempotencyKey("OUTBOUND_214", job.idempotencyKey),
    ).toBeNull();
  });

  it("returns a replayable job when a dead row is returned before a live one", async () => {
    const deadJob = sampleJob({ id: "job-dead", status: "dead" });
    const liveJob = sampleJob({ id: "job-live", status: "queued" });
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          {
            ...deadJob,
            idempotencyPk: idempotencyPk(deadJob.jobType, deadJob.idempotencyKey),
          },
        ],
        LastEvaluatedKey: { id: deadJob.id },
      })
      .resolvesOnce({
        Items: [
          {
            ...liveJob,
            idempotencyPk: idempotencyPk(liveJob.jobType, liveJob.idempotencyKey),
          },
        ],
      });

    expect(
      await store.findByIdempotencyKey("OUTBOUND_214", liveJob.idempotencyKey),
    ).toEqual(liveJob);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
  });

  it("claims an idempotency key with a conditional put", async () => {
    ddbMock.on(PutCommand).resolves({});

    await expect(
      store.claimIdempotencyKey("OUTBOUND_214", "milestone:SHP-1001:214", "job-new"),
    ).resolves.toEqual({ outcome: "claimed" });

    expect(ddbMock.commandCalls(PutCommand)[0]!.args[0].input).toMatchObject({
      TableName: TABLE_NAME,
      Item: {
        id: idempotencyPk("OUTBOUND_214", "milestone:SHP-1001:214"),
        jobId: "job-new",
      },
      ConditionExpression: "attribute_not_exists(id)",
    });
  });

  it("returns conflict when the idempotency key is already claimed by a live job", async () => {
    const job = sampleJob({ id: "job-live" });
    ddbMock
      .on(PutCommand)
      .rejectsOnce({ name: "ConditionalCheckFailedException" })
      .resolves({});
    ddbMock
      .on(GetCommand)
      .resolvesOnce({ Item: { id: idempotencyPk(job.jobType, job.idempotencyKey), jobId: job.id } })
      .resolvesOnce({
        Item: {
          ...job,
          idempotencyPk: idempotencyPk(job.jobType, job.idempotencyKey),
        },
      });

    await expect(
      store.claimIdempotencyKey("OUTBOUND_214", job.idempotencyKey, "job-new"),
    ).resolves.toEqual({ outcome: "conflict", jobId: "job-live" });
  });
});
