import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import {
  type DurableContext,
  type DurableExecutionHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { S3ArtifactStore } from "../artifact/s3-artifact-store.js";
import { DynamoControlNumberAllocator } from "../control-number/dynamo-control-number-allocator.js";
import type { ArtifactStore } from "../artifact/artifact-store.js";
import type { ControlNumberAllocator } from "../control-number/control-number-allocator.js";
import type { EdiJob } from "../domain/edi-job.js";
import type { OutboundQueueMessage } from "../enqueue/outbound-queue.js";
import type { PartnerMailboxClient } from "../mailbox/partner-mailbox-client.js";
import {
  readSftpPartnerMailboxClientEnv,
  SftpPartnerMailboxClient,
} from "../mailbox/sftp-partner-mailbox-client.js";
import { JsonataMapExecutor } from "../map/jsonata-map-executor.js";
import type { MapExecutor } from "../map/map-executor.js";
import {
  processOutboundJob,
  type OutboundProcessorDeps,
} from "../outbound/outbound-processor.js";
import { DynamoEdiConfigStore } from "../store/dynamo-edi-config-store.js";
import type { EdiConfigStore } from "../store/edi-config-store.js";
import { DynamoEdiJobStore } from "../store/dynamo-edi-job-store.js";

/** Minimal SQS FIFO trigger shape — only fields the handler reads. */
export interface OutboundSqsRecord {
  body: string;
}

export interface OutboundSqsEvent {
  Records: OutboundSqsRecord[];
}

export interface OutboundHandlerEnv {
  ediJobTableName: string;
  ediConfigTableName: string;
  controlNumberTableName: string;
  artifactsBucket: string;
}

export function readOutboundHandlerEnv(
  env: NodeJS.ProcessEnv = process.env,
): OutboundHandlerEnv {
  const ediJobTableName = env.EDI_JOB_TABLE_NAME;
  const ediConfigTableName = env.EDI_CONFIG_TABLE_NAME;
  const controlNumberTableName = env.EDI_CONTROL_NUMBER_TABLE_NAME;
  const artifactsBucket = env.EDI_ARTIFACTS_BUCKET;
  if (
    !ediJobTableName ||
    !ediConfigTableName ||
    !controlNumberTableName ||
    !artifactsBucket
  ) {
    throw new Error(
      "EDI_JOB_TABLE_NAME, EDI_CONFIG_TABLE_NAME, EDI_CONTROL_NUMBER_TABLE_NAME, and EDI_ARTIFACTS_BUCKET must be set",
    );
  }
  return {
    ediJobTableName,
    ediConfigTableName,
    controlNumberTableName,
    artifactsBucket,
  };
}

export function createOutboundHandlerDeps(
  config: OutboundHandlerEnv,
  clients?: {
    dynamo?: DynamoDBDocumentClient;
    s3?: S3Client;
    ediConfigStore?: EdiConfigStore;
    controlNumberAllocator?: ControlNumberAllocator;
    mapExecutor?: MapExecutor;
    artifactStore?: ArtifactStore;
    partnerMailboxClient?: PartnerMailboxClient;
  },
): OutboundProcessorDeps {
  const dynamo =
    clients?.dynamo ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  const s3 = clients?.s3 ?? new S3Client({});

  return {
    store: new DynamoEdiJobStore(dynamo, config.ediJobTableName),
    ediConfigStore:
      clients?.ediConfigStore ??
      new DynamoEdiConfigStore(dynamo, config.ediConfigTableName),
    controlNumberAllocator:
      clients?.controlNumberAllocator ??
      new DynamoControlNumberAllocator(dynamo, config.controlNumberTableName),
    mapExecutor: clients?.mapExecutor ?? new JsonataMapExecutor(),
    artifactStore:
      clients?.artifactStore ??
      new S3ArtifactStore(s3, config.artifactsBucket),
    partnerMailboxClient:
      clients?.partnerMailboxClient ??
      new SftpPartnerMailboxClient(readSftpPartnerMailboxClientEnv()),
  };
}

let cachedOutboundHandlerDeps: OutboundProcessorDeps | undefined;

function resolveDefaultOutboundHandlerDeps(): OutboundProcessorDeps {
  if (!cachedOutboundHandlerDeps) {
    cachedOutboundHandlerDeps = createOutboundHandlerDeps(
      readOutboundHandlerEnv(),
    );
  }
  return cachedOutboundHandlerDeps;
}

/** Clears module-scope deps cache (for tests). */
export function resetOutboundHandlerDepsCacheForTests(): void {
  cachedOutboundHandlerDeps = undefined;
}

/** Returns the default cached deps resolver (for tests). */
export function resolveDefaultOutboundHandlerDepsForTests(): OutboundProcessorDeps {
  return resolveDefaultOutboundHandlerDeps();
}

export function readDurableExecutionId(
  context: Pick<DurableContext, "executionContext">,
): string {
  return context.executionContext.durableExecutionArn;
}

export function parseOutboundQueueMessage(body: string): OutboundQueueMessage {
  return JSON.parse(body) as OutboundQueueMessage;
}

export async function processOutboundSqsEvent(
  deps: OutboundProcessorDeps,
  event: OutboundSqsEvent,
  durableExecutionId: string,
): Promise<EdiJob[]> {
  const results: EdiJob[] = [];
  for (const record of event.Records) {
    const message = parseOutboundQueueMessage(record.body);
    results.push(
      await processOutboundJob(deps, { message, durableExecutionId }),
    );
  }
  return results;
}

export function createOutboundDurableHandler(
  resolveDeps: () => OutboundProcessorDeps = resolveDefaultOutboundHandlerDeps,
): DurableExecutionHandler<OutboundSqsEvent, EdiJob[]> {
  return async (event, context) =>
    processOutboundSqsEvent(
      resolveDeps(),
      event,
      readDurableExecutionId(context),
    );
}

export const handler = withDurableExecution(createOutboundDurableHandler());
