import { describe, expect, it } from "vitest";
import { cutoverKey } from "../domain/cutover.js";
import { InMemoryCutoverStore } from "./in-memory-cutover-store.js";

describe("cutoverKey", () => {
  it("combines ediConfigId and jobType", () => {
    expect(cutoverKey("cfg-partner-a", "OUTBOUND_214")).toBe(
      "cfg-partner-a#OUTBOUND_214",
    );
  });
});

describe("InMemoryCutoverStore", () => {
  it("defaults to Legacy (cuda-edi off) for unseeded job type × config", async () => {
    const store = new InMemoryCutoverStore();

    await expect(
      store.isCudaEdiEnabled("cfg-partner-a", "OUTBOUND_214"),
    ).resolves.toBe(false);
    await expect(
      store.isCudaEdiEnabled("cfg-partner-b", "INBOUND_204"),
    ).resolves.toBe(false);
  });

  it("returns cuda-edi on only for explicitly seeded entries", async () => {
    const store = new InMemoryCutoverStore([
      { ediConfigId: "cfg-partner-a", jobType: "OUTBOUND_214" },
    ]);

    await expect(
      store.isCudaEdiEnabled("cfg-partner-a", "OUTBOUND_214"),
    ).resolves.toBe(true);
    await expect(
      store.isCudaEdiEnabled("cfg-partner-a", "INBOUND_204"),
    ).resolves.toBe(false);
    await expect(
      store.isCudaEdiEnabled("cfg-partner-b", "OUTBOUND_214"),
    ).resolves.toBe(false);
  });
});
