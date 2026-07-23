import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type DurableContext,
  type DurableExecutionHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import type { ControlNumberAllocator } from "../control-number/control-number-allocator.js";
import type { ArtifactStore } from "../artifact/artifact-store.js";
import type { EdiJob } from "../domain/edi-job.js";
import type { OutboundQueueMessage } from "../enqueue/outbound-queue.js";
import type { MapExecutor } from "../map/map-executor.js";
import {
  processOutboundJob,
  type OutboundProcessorDeps,
} from "../outbound/outbound-processor.js";
import type { EdiConfigStore } from "../store/edi-config-store.js";
import { DynamoEdiJobStore } from "../store/dynamo-edi-job-store.js";

function unconfiguredEdiConfigStore(): EdiConfigStore {
  return {
    async getById(id: string): Promise<never> {
      throw new Error(
        `EdiConfigStore is not configured for outbound handler (missing config: ${id})`,
      );
    },
  };
}

function unconfiguredControlNumberAllocator(): ControlNumberAllocator {
  return {
    async allocate(): Promise<never> {
      throw new Error(
        "ControlNumberAllocator is not configured for outbound handler",
      );
    },
    async allocateSet(): Promise<never> {
      throw new Error(
        "ControlNumberAllocator is not configured for outbound handler",
      );
    },
  };
}

function unconfiguredMapExecutor(): MapExecutor {
  return {
    async apply(): Promise<never> {
      throw new Error("MapExecutor is not configured for outbound handler");
    },
    async applyTransactionSetMap(): Promise<never> {
      throw new Error("MapExecutor is not configured for outbound handler");
    },
  };
}

function unconfiguredArtifactStore(): ArtifactStore {
  return {
    async put(): Promise<never> {
      throw new Error("ArtifactStore is not configured for outbound handler");
    },
  };
}

/** Minimal SQS FIFO trigger shape — only fields the handler reads. */
export interface OutboundSqsRecord {
  body: string;
}

export interface OutboundSqsEvent {
  Records: OutboundSqsRecord[];
}

export interface OutboundHandlerEnv {
  ediJobTableName: string;
}

export function readOutboundHandlerEnv(
  env: NodeJS.ProcessEnv = process.env,
): OutboundHandlerEnv {
  const ediJobTableName = env.EDI_JOB_TABLE_NAME;
  if (!ediJobTableName) {
    throw new Error("EDI_JOB_TABLE_NAME must be set");
  }
  return { ediJobTableName };
}

export function createOutboundHandlerDeps(
  config: OutboundHandlerEnv,
  clients?: {
    dynamo?: DynamoDBDocumentClient;
    ediConfigStore?: EdiConfigStore;
    controlNumberAllocator?: ControlNumberAllocator;
    mapExecutor?: MapExecutor;
    artifactStore?: ArtifactStore;
  },
): OutboundProcessorDeps {
  const dynamo =
    clients?.dynamo ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });

  return {
    store: new DynamoEdiJobStore(dynamo, config.ediJobTableName),
    ediConfigStore:
      clients?.ediConfigStore ?? unconfiguredEdiConfigStore(),
    controlNumberAllocator:
      clients?.controlNumberAllocator ?? unconfiguredControlNumberAllocator(),
    mapExecutor: clients?.mapExecutor ?? unconfiguredMapExecutor(),
    artifactStore: clients?.artifactStore ?? unconfiguredArtifactStore(),
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
