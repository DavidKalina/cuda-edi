import { describe, expect, it } from "vitest";
import { SHIPMENT_BUSINESS_KEY } from "../domain/edi-job.js";
import { partnerAEdiConfig } from "../test-fixtures/partner-a-edi-config.js";
import { resolveOutbound214MailboxPath } from "./resolve-outbound-214-path.js";

describe("resolveOutbound214MailboxPath", () => {
  it("builds a 214 path under the config outbound mailbox root", () => {
    const job = {
      id: "job-new-1",
      status: "running" as const,
      jobType: "OUTBOUND_214" as const,
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
      orderingGroup: "cfg-partner-a#SHP-1001",
      artifactRefs: [],
      createdAt: "2026-07-23T12:00:00.000Z",
      updatedAt: "2026-07-23T12:00:00.000Z",
    };

    expect(resolveOutbound214MailboxPath(partnerAEdiConfig(), job)).toBe(
      "/partner-a/outbound/214/job-new-1.x12",
    );
  });

  it("throws when outbound mailbox path is missing", () => {
    const config = { ...partnerAEdiConfig(), mailboxPaths: undefined };
    const job = {
      id: "job-1",
      status: "running" as const,
      jobType: "OUTBOUND_214" as const,
      ediConfigId: "cfg-partner-a",
      businessKeys: { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" },
      idempotencyKey: "milestone:SHP-1001:214",
      orderingGroup: "cfg-partner-a#SHP-1001",
      artifactRefs: [],
      createdAt: "2026-07-23T12:00:00.000Z",
      updatedAt: "2026-07-23T12:00:00.000Z",
    };

    expect(() => resolveOutbound214MailboxPath(config, job)).toThrow(
      "no outbound mailbox path configured",
    );
  });
});
