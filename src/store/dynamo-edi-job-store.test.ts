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

  it("returns null for dead jobs on idempotency lookup", async () => {
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
});
