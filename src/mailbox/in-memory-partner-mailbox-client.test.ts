import { describe, expect, it } from "vitest";
import { InMemoryPartnerMailboxClient } from "./in-memory-partner-mailbox-client.js";

describe("InMemoryPartnerMailboxClient", () => {
  it("tracks uploads and existence by remote path", async () => {
    const mailbox = new InMemoryPartnerMailboxClient();
    const content = new TextEncoder().encode("ISA*00*~");

    expect(await mailbox.exists("/partner-a/outbound/214/job-1.x12")).toBe(false);

    await mailbox.putFile("/partner-a/outbound/214/job-1.x12", content);

    expect(await mailbox.exists("/partner-a/outbound/214/job-1.x12")).toBe(true);
    expect(mailbox.getFile("/partner-a/outbound/214/job-1.x12")?.content).toEqual(
      content,
    );
  });
});
