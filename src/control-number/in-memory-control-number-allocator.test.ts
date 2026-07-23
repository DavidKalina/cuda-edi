import { describe, expect, it } from "vitest";
import { InMemoryControlNumberAllocator } from "./in-memory-control-number-allocator.js";

describe("InMemoryControlNumberAllocator", () => {
  it("mints control numbers strictly above the Legacy watermark", async () => {
    const allocator = new InMemoryControlNumberAllocator([
      { ediConfigId: "cfg-partner-a", kind: "isa", watermark: 1_000_000 },
      { ediConfigId: "cfg-partner-a", kind: "gs", watermark: 500_000 },
      { ediConfigId: "cfg-partner-a", kind: "st", watermark: 42 },
    ]);

    const first = await allocator.allocateSet("cfg-partner-a");

    expect(first).toEqual({
      isa: "1000001",
      gs: "500001",
      st: "43",
    });
  });

  it("increments monotonically per EDI Config and counter kind", async () => {
    const allocator = new InMemoryControlNumberAllocator([
      { ediConfigId: "cfg-partner-a", kind: "isa", watermark: 10 },
      { ediConfigId: "cfg-partner-a", kind: "gs", watermark: 20 },
      { ediConfigId: "cfg-partner-a", kind: "st", watermark: 30 },
    ]);

    expect(await allocator.allocate("cfg-partner-a", "isa")).toBe("11");
    expect(await allocator.allocate("cfg-partner-a", "isa")).toBe("12");
    expect(await allocator.allocate("cfg-partner-a", "gs")).toBe("21");
    expect(await allocator.allocate("cfg-partner-a", "st")).toBe("31");
    expect(await allocator.allocate("cfg-partner-a", "st")).toBe("32");
  });

  it("isolates counters across EDI Configs", async () => {
    const allocator = new InMemoryControlNumberAllocator([
      { ediConfigId: "cfg-partner-a", kind: "isa", watermark: 100 },
      { ediConfigId: "cfg-partner-b", kind: "isa", watermark: 200 },
    ]);

    expect(await allocator.allocate("cfg-partner-a", "isa")).toBe("101");
    expect(await allocator.allocate("cfg-partner-b", "isa")).toBe("201");
    expect(await allocator.allocate("cfg-partner-a", "isa")).toBe("102");
  });

  it("rejects allocation when the counter was not seeded", async () => {
    const allocator = new InMemoryControlNumberAllocator();

    await expect(allocator.allocate("cfg-missing", "isa")).rejects.toThrow(
      "control number counter not seeded for cfg-missing#isa",
    );
  });
});
