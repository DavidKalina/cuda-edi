import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { InvokeCommandOutput } from "@aws-sdk/client-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import {
  createEnqueueClient,
  readEnqueueClientEnv,
} from "./enqueue-client.js";

const FUNCTION_NAME = "cuda-edi-enqueue";
const FIXED_TIME = "2026-07-23T12:00:00.000Z";

function jsonPayload(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function readPayload(payload: Uint8Array): string {
  return new TextDecoder().decode(payload);
}

function outbound214Input() {
  return {
    jobType: "OUTBOUND_214" as const,
    ediConfigId: "cfg-partner-a",
    businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
    idempotencyKey: "milestone:SHP-1001:214",
  };
}

function queuedJob() {
  return {
    id: "job-sdk-1",
    status: "queued" as const,
    jobType: "OUTBOUND_214" as const,
    ediConfigId: "cfg-partner-a",
    businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
    idempotencyKey: "milestone:SHP-1001:214",
    orderingGroup: "cfg-partner-a#SHP-1001",
    artifactRefs: [],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  };
}

describe("readEnqueueClientEnv", () => {
  it("requires EDI_ENQUEUE_FUNCTION_NAME", () => {
    expect(() => readEnqueueClientEnv({})).toThrow(
      "EDI_ENQUEUE_FUNCTION_NAME must be set",
    );
  });

  it("reads the configured function name", () => {
    expect(
      readEnqueueClientEnv({ EDI_ENQUEUE_FUNCTION_NAME: FUNCTION_NAME }),
    ).toEqual({ functionName: FUNCTION_NAME });
  });
});

describe("createEnqueueClient", () => {
  const lambdaMock = mockClient(LambdaClient);
  let enqueue: ReturnType<typeof createEnqueueClient>;

  beforeEach(() => {
    lambdaMock.reset();
    enqueue = createEnqueueClient({
      functionName: FUNCTION_NAME,
      lambda: new LambdaClient({}),
    });
  });

  it("invokes the Enqueue Lambda with the job input payload", async () => {
    const input = outbound214Input();
    lambdaMock.on(InvokeCommand).resolves({
      Payload: jsonPayload({ job: queuedJob() }),
    } as InvokeCommandOutput);

    const job = await enqueue(input);

    expect(job).toMatchObject({
      id: "job-sdk-1",
      status: "queued",
      jobType: "OUTBOUND_214",
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

  it("returns the existing job on idempotent replay", async () => {
    const input = outbound214Input();
    const job = queuedJob();
    lambdaMock.on(InvokeCommand).resolves({
      Payload: jsonPayload({ job }),
    } as InvokeCommandOutput);

    const first = await enqueue(input);
    const second = await enqueue(input);

    expect(second).toEqual(first);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(2);
    const payloads = lambdaMock
      .commandCalls(InvokeCommand)
      .map((call) =>
        JSON.parse(readPayload(call.args[0].input.Payload as Uint8Array)),
      );
    expect(payloads[0]).toEqual(payloads[1]);
  });

  it("surfaces Lambda function errors", async () => {
    lambdaMock.on(InvokeCommand).resolves({
      FunctionError: "Unhandled",
      Payload: jsonPayload({
        errorMessage: "businessKeys must include shipment",
      }),
    } as InvokeCommandOutput);

    await expect(enqueue(outbound214Input())).rejects.toThrow(
      "businessKeys must include shipment",
    );
  });
});
