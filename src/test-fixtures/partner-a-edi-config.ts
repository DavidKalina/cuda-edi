import type { ControlNumberSeed } from "../control-number/control-number-allocator.js";
import type { EdiConfig } from "../domain/edi-config.js";

export function partnerAEdiConfig(): EdiConfig {
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

export function partnerAControlNumberSeeds(): ControlNumberSeed[] {
  return [
    { ediConfigId: "cfg-partner-a", kind: "isa", watermark: 1_000_000 },
    { ediConfigId: "cfg-partner-a", kind: "gs", watermark: 500_000 },
    { ediConfigId: "cfg-partner-a", kind: "st", watermark: 42 },
  ];
}
