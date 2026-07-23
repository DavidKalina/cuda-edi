import { describe, expect, it } from "vitest";
import type { EdiConfig } from "../domain/edi-config.js";
import { InMemoryEdiConfigStore } from "./in-memory-edi-config-store.js";

function partnerAConfig(): EdiConfig {
  return {
    id: "cfg-partner-a",
    partnerId: "partner-a",
    enabledTransactionSets: ["214"],
    maps: {
      ts214: `{
        "shipmentId": businessKeys.shipmentInternalNumber,
        "statusCode": "AF"
      }`,
    },
    formatIds: {
      interchangeSenderId: "CUDACORP",
      interchangeReceiverId: "PARTNERA",
      applicationSenderId: "CUDACORP",
      applicationReceiverId: "PARTNERA",
    },
    mailboxPaths: {
      outbound: "/partner-a/outbound",
      inbound: "/partner-a/inbound",
    },
  };
}

describe("InMemoryEdiConfigStore", () => {
  it("returns seeded EDI Config by id", async () => {
    const config = partnerAConfig();
    const store = new InMemoryEdiConfigStore([config]);

    const loaded = await store.getById("cfg-partner-a");

    expect(loaded).toEqual(config);
    expect(loaded?.maps.ts214).toContain("shipmentInternalNumber");
    expect(loaded?.formatIds.interchangeSenderId).toBe("CUDACORP");
    expect(loaded?.mailboxPaths?.outbound).toBe("/partner-a/outbound");
  });

  it("returns null when config id is unknown", async () => {
    const store = new InMemoryEdiConfigStore([partnerAConfig()]);

    await expect(store.getById("cfg-missing")).resolves.toBeNull();
  });
});
