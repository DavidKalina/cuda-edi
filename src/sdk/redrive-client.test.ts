import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { InvokeCommandOutput } from "@aws-sdk/client-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import {
  createRedriveClient,
  readRedriveClientEnv,
} from "./redrive-client.js";

const FUNCTION_NAME = "cuda-edi-redrive";
const FIXED_TIME = "2026-07-23T12:00:00.000Z";

function jsonPayload(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function readPayload(payload: Uint8Array): string {
  return new TextDecoder().decode(payload);
}

function redrivenJob() {
  return {
    id: "job-sdk-1",
    status: "queued" as const,
    jobType: "OUTBOUND_214" as const,
    ediConfigId: "cfg-partner-a",
    businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
    idempotencyKey: "milestone:SHP-1001:214",
    orderingGroup: "cfg-partner-a#SHP-1001",
    artifactRefs: [],
    attempt: 2,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  };
}

describe("readRedriveClientEnv", () => {
  it("requires EDI_REDRIVE_FUNCTION_NAME", () => {
    expect(() => readRedriveClientEnv({})).toThrow(
      "EDI_REDRIVE_FUNCTION_NAME must be set",
    );
  });

  it("reads the configured function name", () => {
    expect(
      readRedriveClientEnv({ EDI_REDRIVE_FUNCTION_NAME: FUNCTION_NAME }),
    ).toEqual({ functionName: FUNCTION_NAME });
  });
});

describe("createRedriveClient", () => {
  const lambdaMock = mockClient(LambdaClient);
  let redrive: ReturnType<typeof createRedriveClient>;

  beforeEach(() => {
    lambdaMock.reset();
    redrive = createRedriveClient({
      functionName: FUNCTION_NAME,
      lambda: new LambdaClient({}),
    });
  });

  it("invokes the Redrive Lambda with the job id payload", async () => {
    const input = { jobId: "job-sdk-1" };
    lambdaMock.on(InvokeCommand).resolves({
      Payload: jsonPayload({ job: redrivenJob() }),
    } as InvokeCommandOutput);

    const job = await redrive(input);

    expect(job).toMatchObject({
      id: "job-sdk-1",
      status: "queued",
      jobType: "OUTBOUND_214",
      attempt: 2,
      orderingGroup: "cfg-partner-a#SHP-1001",
    });
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(1);
    const invokeInput = lambdaMock.commandCalls(InvokeCommand)[0]!.args[0]
      .input;
    expect(invokeInput.FunctionName).toBe(FUNCTION_NAME);
    expect(invokeInput.InvocationType).toBe("RequestResponse");
    expect(JSON.parse(readPayload(invokeInput.Payload as Uint8Array))).toEqual(
      input,
    );
  });

  it("surfaces Lambda function errors", async () => {
    lambdaMock.on(InvokeCommand).resolves({
      FunctionError: "Unhandled",
      Payload: jsonPayload({
        errorMessage: "EDI Job job-dead-1 cannot be redriven from status dead",
      }),
    } as InvokeCommandOutput);

    await expect(redrive({ jobId: "job-dead-1" })).rejects.toThrow(
      "EDI Job job-dead-1 cannot be redriven from status dead",
    );
  });
});
