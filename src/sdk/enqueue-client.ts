import {
  InvokeCommand,
  LambdaClient,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import type { CreateEdiJobInput, EdiJob } from "../domain/edi-job.js";
import type { EnqueueHandlerResponse } from "../lambda/enqueue-handler.js";

export type EnqueueFn = (input: CreateEdiJobInput) => Promise<EdiJob>;

export interface EnqueueClientConfig {
  functionName: string;
  lambda?: LambdaClient;
}

export function readEnqueueClientEnv(
  env: NodeJS.ProcessEnv = process.env,
): Pick<EnqueueClientConfig, "functionName"> {
  const functionName = env.EDI_ENQUEUE_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("EDI_ENQUEUE_FUNCTION_NAME must be set");
  }
  return { functionName };
}

function parseInvokePayload(
  response: InvokeCommandOutput,
): EnqueueHandlerResponse {
  if (response.FunctionError) {
    const raw = response.Payload
      ? Buffer.from(response.Payload).toString("utf8")
      : "";
    let message = `Enqueue Lambda failed (${response.FunctionError})`;
    if (raw) {
      try {
        const errorBody = JSON.parse(raw) as { errorMessage?: string };
        if (errorBody.errorMessage) {
          message = errorBody.errorMessage;
        }
      } catch {
        message = raw;
      }
    }
    throw new Error(message);
  }

  if (!response.Payload) {
    throw new Error("Enqueue Lambda returned an empty payload");
  }

  return JSON.parse(
    Buffer.from(response.Payload).toString("utf8"),
  ) as EnqueueHandlerResponse;
}

export function createEnqueueClient(config: EnqueueClientConfig): EnqueueFn {
  const lambda = config.lambda ?? new LambdaClient({});

  return async (input: CreateEdiJobInput): Promise<EdiJob> => {
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: config.functionName,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(input)),
      }),
    );

    const { job } = parseInvokePayload(response);
    return job;
  };
}
