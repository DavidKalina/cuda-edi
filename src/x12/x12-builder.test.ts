import { describe, expect, it } from "vitest";
import { partnerAEdiConfig } from "../test-fixtures/partner-a-edi-config.js";
import { buildOutboundX12 } from "./x12-builder.js";

describe("buildOutboundX12", () => {
  const partnerConfig = partnerAEdiConfig();
  const processedAt = new Date("2026-07-23T12:00:00.000Z");

  const controlNumbers = {
    isa: "1000001",
    gs: "500001",
    st: "43",
  };

  const mappedBody = {
    shipmentId: "SHP-1001",
    statusCode: "AF",
  };

  it("embeds minted control numbers in ISA, GS, and ST envelopes", () => {
    const x12 = buildOutboundX12({
      transactionSet: "214",
      formatIds: partnerConfig.formatIds,
      controlNumbers,
      body: mappedBody,
      processedAt,
    });

    expect(x12).toContain("*001000001*");
    expect(x12).toContain("GS*QM*CUDACORP*PARTNERA*20260723*1200*500001*");
    expect(x12).toContain("ST*214*43~");
    expect(x12).toContain("SE*4*43~");
    expect(x12).toContain("GE*1*500001~");
    expect(x12).toContain("IEA*1*001000001~");
  });

  it("includes mapped document fields in transaction-set body segments", () => {
    const x12 = buildOutboundX12({
      transactionSet: "214",
      formatIds: partnerConfig.formatIds,
      controlNumbers,
      body: mappedBody,
      processedAt,
    });

    expect(x12).toContain("B10*SHP-1001~");
    expect(x12).toContain("AT7*AF~");
  });

  it("reflects partner format ids in the interchange envelope", () => {
    const x12 = buildOutboundX12({
      transactionSet: "214",
      formatIds: partnerConfig.formatIds,
      controlNumbers,
      body: mappedBody,
      processedAt,
    });

    expect(x12).toContain("*ZZ*CUDACORP       *ZZ*PARTNERA       *");
    expect(x12).toContain("GS*QM*CUDACORP*PARTNERA*");
  });

  it("rejects unsupported transaction sets", () => {
    expect(() =>
      buildOutboundX12({
        transactionSet: "997",
        formatIds: partnerConfig.formatIds,
        controlNumbers,
        body: {},
        processedAt,
      }),
    ).toThrow("unsupported outbound transaction set: 997");
  });
});
