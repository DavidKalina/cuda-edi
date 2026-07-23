import type { PartnerMailboxClient } from "./partner-mailbox-client.js";

export interface MailboxFile {
  remotePath: string;
  content: Uint8Array;
}

/** Test/dev Partner Mailbox — retains uploaded files in memory. */
export class InMemoryPartnerMailboxClient implements PartnerMailboxClient {
  readonly files = new Map<string, MailboxFile>();

  async exists(remotePath: string): Promise<boolean> {
    return this.files.has(remotePath);
  }

  async putFile(remotePath: string, content: Uint8Array): Promise<void> {
    this.files.set(remotePath, { remotePath, content: content.slice() });
  }

  getFile(remotePath: string): MailboxFile | undefined {
    return this.files.get(remotePath);
  }
}
