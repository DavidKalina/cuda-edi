import { describe, expect, it } from "vitest";
import { partnerAEdiConfig } from "../test-fixtures/partner-a-edi-config.js";
import { transactionSetMapKey } from "./map-executor.js";
import { JsonataMapExecutor } from "./jsonata-map-executor.js";

describe("transactionSetMapKey", () => {
  it("prefixes transaction set numbers with ts", () => {
    expect(transactionSetMapKey("214")).toBe("ts214");
    expect(transactionSetMapKey("204")).toBe("ts204");
  });
});

describe("JsonataMapExecutor", () => {
  const executor = new JsonataMapExecutor();
  const partnerConfig = partnerAEdiConfig();

  function mapContext(shipmentInternalNumber: string) {
    return {
      businessKeys: { shipmentInternalNumber },
      formatIds: partnerConfig.formatIds,
    };
  }

  it("applies a JSONata expression with businessKeys bindings", async () => {
    const result = await executor.apply(partnerConfig.maps.ts214!, {
      businessKeys: { shipmentInternalNumber: "SHP-1001" },
      formatIds: partnerConfig.formatIds,
    });

    expect(result).toEqual({
      shipmentId: "SHP-1001",
      statusCode: "AF",
    });
  });

  it("applies a transaction-set map from EDI Config maps", async () => {
    const result = await executor.applyTransactionSetMap(
      partnerConfig.maps,
      "214",
      mapContext("SHP-2002"),
    );

    expect(result).toEqual({
      shipmentId: "SHP-2002",
      statusCode: "AF",
    });
  });

  it("exposes formatIds to map expressions", async () => {
    const result = await executor.apply(
      `{
        "sender": formatIds.interchangeSenderId,
        "receiver": formatIds.interchangeReceiverId
      }`,
      mapContext("SHP-1001"),
    );

    expect(result).toEqual({
      sender: "CUDACORP",
      receiver: "PARTNERA",
    });
  });

  it("rejects missing transaction-set maps", async () => {
    await expect(
      executor.applyTransactionSetMap({}, "214", mapContext("SHP-1001")),
    ).rejects.toThrow("EDI Config map not found: ts214");
  });

  it("surfaces JSONata evaluation errors", async () => {
    await expect(
      executor.apply("$notAFunction()", mapContext("SHP-1001")),
    ).rejects.toThrow("JSONata map failed:");
  });
});
