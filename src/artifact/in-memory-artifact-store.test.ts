import { describe, expect, it } from "vitest";
import { partnerAEdiConfig } from "../test-fixtures/partner-a-edi-config.js";
import { InMemoryArtifactStore } from "./in-memory-artifact-store.js";

describe("InMemoryArtifactStore", () => {
  it("stores artifact bytes and returns an object-storage ref", async () => {
    const store = new InMemoryArtifactStore({ bucket: "test-artifacts" });
    const content = "ISA*00*          *00*          *ZZ*CUDACORP~";

    const ref = await store.put({
      jobId: "job-1",
      ediConfigId: "cfg-partner-a",
      content,
      kind: "x12",
      contentType: "application/edi-x12",
    });

    expect(ref).toEqual({
      bucket: "test-artifacts",
      key: "cfg-partner-a/job-1/x12",
      kind: "x12",
    });

    const stored = store.getByKey("cfg-partner-a/job-1/x12");
    expect(stored?.contentType).toBe("application/edi-x12");
    expect(new TextDecoder().decode(stored!.content)).toBe(content);
  });

  it("accepts Uint8Array content", async () => {
    const store = new InMemoryArtifactStore();
    const bytes = new TextEncoder().encode("ST*214*43~");

    const ref = await store.put({
      jobId: "job-2",
      ediConfigId: partnerAEdiConfig().id,
      content: bytes,
      kind: "x12",
    });

    const stored = store.getByKey(ref.key);
    expect(stored?.content).toEqual(bytes);
  });
});
