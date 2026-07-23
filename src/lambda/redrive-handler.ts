import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { EdiJob } from "../domain/edi-job.js";
import {
  redrive,
  type RedriveDeps,
  type RedriveInput,
} from "../redrive/redrive-service.js";
import { SqsOutboundQueue } from "../enqueue/sqs-outbound-queue.js";
import { DynamoEdiJobStore } from "../store/dynamo-edi-job-store.js";

export type RedriveHandlerEvent = RedriveInput;

export interface RedriveHandlerResponse {
  job: EdiJob;
}

export interface RedriveHandlerEnv {
  ediJobTableName: string;
  ediOutboundQueueUrl: string;
}

export function readRedriveHandlerEnv(
  env: NodeJS.ProcessEnv = process.env,
): RedriveHandlerEnv {
  const ediJobTableName = env.EDI_JOB_TABLE_NAME;
  const ediOutboundQueueUrl = env.EDI_OUTBOUND_QUEUE_URL;
  if (!ediJobTableName || !ediOutboundQueueUrl) {
    throw new Error(
      "EDI_JOB_TABLE_NAME and EDI_OUTBOUND_QUEUE_URL must be set",
    );
  }
  return { ediJobTableName, ediOutboundQueueUrl };
}

export function createRedriveHandlerDeps(
  config: RedriveHandlerEnv,
  clients?: {
    dynamo?: DynamoDBDocumentClient;
    sqs?: SQSClient;
  },
): RedriveDeps {
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

let cachedRedriveHandlerDeps: RedriveDeps | undefined;

function resolveDefaultRedriveHandlerDeps(): RedriveDeps {
  if (!cachedRedriveHandlerDeps) {
    cachedRedriveHandlerDeps = createRedriveHandlerDeps(readRedriveHandlerEnv());
  }
  return cachedRedriveHandlerDeps;
}

/** Clears module-scope deps cache (for tests). */
export function resetRedriveHandlerDepsCacheForTests(): void {
  cachedRedriveHandlerDeps = undefined;
}

/** Returns the default cached deps resolver (for tests). */
export function resolveDefaultRedriveHandlerDepsForTests(): RedriveDeps {
  return resolveDefaultRedriveHandlerDeps();
}

export function createRedriveHandler(
  resolveDeps: () => RedriveDeps = resolveDefaultRedriveHandlerDeps,
) {
  return async (
    event: RedriveHandlerEvent,
  ): Promise<RedriveHandlerResponse> => {
    const job = await redrive(resolveDeps(), event);
    return { job };
  };
}

export const handler = createRedriveHandler();
