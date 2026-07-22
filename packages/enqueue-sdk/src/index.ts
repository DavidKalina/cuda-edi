/**
 * Thin Enqueue SDK (ADR 0003).
 * Invokes the Enqueue Lambda; does not hold DB or SQS credentials for job creation.
 */
import {
  InvokeCommand,
  LambdaClient,
  type LambdaClientConfig,
} from "@aws-sdk/client-lambda";
import type { EnqueueRequest, EnqueueResult } from "@cuda-edi/edi-core";

export interface EnqueueClientOptions {
  /** Enqueue Lambda function name or ARN. */
  functionName: string;
  /** Optional Lambda client config (region, credentials). */
  lambda?: LambdaClientConfig;
  /** Injected client for tests. */
  client?: LambdaClient;
}

export class EnqueueClient {
  private readonly functionName: string;
  private readonly client: LambdaClient;

  constructor(options: EnqueueClientOptions) {
    this.functionName = options.functionName;
    this.client = options.client ?? new LambdaClient(options.lambda ?? {});
  }

  async enqueue(request: EnqueueRequest): Promise<EnqueueResult> {
    const response = await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(request)),
      })
    );

    if (response.FunctionError) {
      const raw = response.Payload
        ? Buffer.from(response.Payload).toString("utf8")
        : response.FunctionError;
      throw new Error(`Enqueue Lambda error: ${raw}`);
    }

    if (!response.Payload) {
      throw new Error("Enqueue Lambda returned an empty payload");
    }

    return JSON.parse(Buffer.from(response.Payload).toString("utf8")) as EnqueueResult;
  }
}

export type { EnqueueRequest, EnqueueResult };
