import {
  InvokeCommand,
  LambdaClient,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import type { EdiJob } from "../domain/edi-job.js";
import type { RedriveHandlerResponse } from "../lambda/redrive-handler.js";
import type { RedriveInput } from "../redrive/redrive-service.js";

export type RedriveFn = (input: RedriveInput) => Promise<EdiJob>;

export interface RedriveClientConfig {
  functionName: string;
  lambda?: LambdaClient;
}

export function readRedriveClientEnv(
  env: NodeJS.ProcessEnv = process.env,
): Pick<RedriveClientConfig, "functionName"> {
  const functionName = env.EDI_REDRIVE_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("EDI_REDRIVE_FUNCTION_NAME must be set");
  }
  return { functionName };
}

function parseInvokePayload(
  response: InvokeCommandOutput,
): RedriveHandlerResponse {
  if (response.FunctionError) {
    const raw = response.Payload
      ? Buffer.from(response.Payload).toString("utf8")
      : "";
    let message = `Redrive Lambda failed (${response.FunctionError})`;
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
    throw new Error("Redrive Lambda returned an empty payload");
  }

  return JSON.parse(
    Buffer.from(response.Payload).toString("utf8"),
  ) as RedriveHandlerResponse;
}

export function createRedriveClient(config: RedriveClientConfig): RedriveFn {
  const lambda = config.lambda ?? new LambdaClient({});

  return async (input: RedriveInput): Promise<EdiJob> => {
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
