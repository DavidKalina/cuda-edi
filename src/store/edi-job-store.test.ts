import { describe, expect, it } from "vitest";
import {
  computeOrderingGroup,
  type EdiJob,
  SHIPMENT_BUSINESS_KEY,
} from "../domain/edi-job.js";
import { findReplayableJob } from "./edi-job-store.js";
import { InMemoryEdiJobStore } from "./in-memory-edi-job-store.js";

function sampleJob(overrides: Partial<EdiJob> = {}): EdiJob {
  const ediConfigId = "cfg-partner-a";
  const businessKeys = { [SHIPMENT_BUSINESS_KEY]: "SHP-1001" };
  const now = "2026-07-23T00:00:00.000Z";
  return {
    id: "job-1",
    status: "queued",
    jobType: "OUTBOUND_214",
    ediConfigId,
    businessKeys,
    idempotencyKey: "milestone:SHP-1001:214",
    orderingGroup: computeOrderingGroup(ediConfigId, businessKeys),
    artifactRefs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("computeOrderingGroup", () => {
  it("combines edi config id and shipment business key", () => {
    expect(
      computeOrderingGroup("cfg-abc", {
        [SHIPMENT_BUSINESS_KEY]: "SHP-42",
      }),
    ).toBe("cfg-abc#SHP-42");
  });

  it("requires shipment internal number in business keys", () => {
    expect(() => computeOrderingGroup("cfg-abc", {})).toThrow(
      SHIPMENT_BUSINESS_KEY,
    );
  });
});

describe("InMemoryEdiJobStore", () => {
  it("stores and retrieves a job by id", async () => {
    const store = new InMemoryEdiJobStore();
    const job = sampleJob();
    await store.put(job);
    expect(await store.getById(job.id)).toEqual(job);
  });

  it("finds a job by job type and idempotency key", async () => {
    const store = new InMemoryEdiJobStore();
    const job = sampleJob();
    await store.put(job);
    expect(
      await store.findByIdempotencyKey("OUTBOUND_214", job.idempotencyKey),
    ).toEqual(job);
  });

  it("returns null for idempotency key when job is dead", async () => {
    const store = new InMemoryEdiJobStore();
    const job = sampleJob({ status: "dead" });
    await store.put(job);
    expect(
      await store.findByIdempotencyKey("OUTBOUND_214", job.idempotencyKey),
    ).toBeNull();
  });

  it("returns succeeded jobs for idempotent replay lookup", async () => {
    const store = new InMemoryEdiJobStore();
    const job = sampleJob({ status: "succeeded" });
    await store.put(job);
    expect(
      await store.findByIdempotencyKey("OUTBOUND_214", job.idempotencyKey),
    ).toEqual(job);
  });

  it("scopes idempotency lookup by job type", async () => {
    const store = new InMemoryEdiJobStore();
    const job = sampleJob();
    await store.put(job);
    expect(
      await store.findByIdempotencyKey("INBOUND_204", job.idempotencyKey),
    ).toBeNull();
  });
});

describe("findReplayableJob", () => {
  it("returns existing non-dead job for idempotency key", async () => {
    const store = new InMemoryEdiJobStore();
    const job = sampleJob();
    await store.put(job);
    expect(
      await findReplayableJob(store, "OUTBOUND_214", job.idempotencyKey),
    ).toEqual(job);
  });

  it("returns null when only a dead job exists", async () => {
    const store = new InMemoryEdiJobStore();
    const job = sampleJob({ status: "dead" });
    await store.put(job);
    expect(
      await findReplayableJob(store, "OUTBOUND_214", job.idempotencyKey),
    ).toBeNull();
  });
});
