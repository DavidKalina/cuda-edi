import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { CreateEdiJobInput, EdiJob } from "../domain/edi-job.js";
import { enqueue, type EnqueueDeps } from "../enqueue/enqueue-service.js";
import { SqsOutboundQueue } from "../enqueue/sqs-outbound-queue.js";
import { DynamoEdiJobStore } from "../store/dynamo-edi-job-store.js";

export type EnqueueHandlerEvent = CreateEdiJobInput;

export interface EnqueueHandlerResponse {
  job: EdiJob;
}

export interface EnqueueHandlerEnv {
  ediJobTableName: string;
  ediOutboundQueueUrl: string;
}

export function readEnqueueHandlerEnv(
  env: NodeJS.ProcessEnv = process.env,
): EnqueueHandlerEnv {
  const ediJobTableName = env.EDI_JOB_TABLE_NAME;
  const ediOutboundQueueUrl = env.EDI_OUTBOUND_QUEUE_URL;
  if (!ediJobTableName || !ediOutboundQueueUrl) {
    throw new Error(
      "EDI_JOB_TABLE_NAME and EDI_OUTBOUND_QUEUE_URL must be set",
    );
  }
  return { ediJobTableName, ediOutboundQueueUrl };
}

export function createEnqueueHandlerDeps(
  config: EnqueueHandlerEnv,
  clients?: {
    dynamo?: DynamoDBDocumentClient;
    sqs?: SQSClient;
  },
): EnqueueDeps {
  const dynamo =
    clients?.dynamo ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  const sqs = clients?.sqs ?? new SQSClient({});

  return {
    store: new DynamoEdiJobStore(dynamo, config.ediJobTableName),
    outboundQueue: new SqsOutboundQueue(sqs, config.ediOutboundQueueUrl),
  };
}

let cachedEnqueueHandlerDeps: EnqueueDeps | undefined;

function resolveDefaultEnqueueHandlerDeps(): EnqueueDeps {
  if (!cachedEnqueueHandlerDeps) {
    cachedEnqueueHandlerDeps = createEnqueueHandlerDeps(readEnqueueHandlerEnv());
  }
  return cachedEnqueueHandlerDeps;
}

/** Clears module-scope deps cache (for tests). */
export function resetEnqueueHandlerDepsCacheForTests(): void {
  cachedEnqueueHandlerDeps = undefined;
}

/** Returns the default cached deps resolver (for tests). */
export function resolveDefaultEnqueueHandlerDepsForTests(): EnqueueDeps {
  return resolveDefaultEnqueueHandlerDeps();
}

export function createEnqueueHandler(
  resolveDeps: () => EnqueueDeps = resolveDefaultEnqueueHandlerDeps,
) {
  return async (
    event: EnqueueHandlerEvent,
  ): Promise<EnqueueHandlerResponse> => {
    const job = await enqueue(resolveDeps(), event);
    return { job };
  };
}

export const handler = createEnqueueHandler();
