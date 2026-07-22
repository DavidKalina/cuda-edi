import {
  defaultOrderingGroup,
  directionOf,
  type EnqueueRequest,
} from "@cuda-edi/edi-core";
import { EnqueueClient } from "@cuda-edi/enqueue-sdk";

describe("package graph smoke", () => {
  it("exports domain helpers from edi-core", () => {
    expect(directionOf("OUTBOUND_214")).toBe("outbound");
    expect(directionOf("INBOUND_204")).toBe("inbound");
    expect(
      defaultOrderingGroup("cfg_1", { shipmentInternalNumber: "SHIP-9" })
    ).toBe("cfg_1#SHIP-9");
  });

  it("builds a typed EnqueueRequest shape", () => {
    const request: EnqueueRequest = {
      jobType: "OUTBOUND_214",
      ediConfigId: "cfg_1",
      idempotencyKey: "k1",
      businessKeys: { shipmentInternalNumber: "SHIP-9" },
    };
    expect(request.jobType).toBe("OUTBOUND_214");
  });

  it("constructs EnqueueClient without invoking AWS", () => {
    const client = new EnqueueClient({
      functionName: "cuda-edi-enqueue-dev",
      client: {
        send: async () => {
          throw new Error("should not be called in smoke test");
        },
      } as never,
    });
    expect(client).toBeInstanceOf(EnqueueClient);
  });
});
