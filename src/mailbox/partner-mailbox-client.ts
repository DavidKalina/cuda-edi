/** Remote Partner Mailbox (SFTPGo) file upload. */
export interface PartnerMailboxClient {
  /** Returns true when a file already exists at the remote path. */
  exists(remotePath: string): Promise<boolean>;
  /** Uploads bytes to the Partner Mailbox at the given remote path. */
  putFile(remotePath: string, content: Uint8Array): Promise<void>;
}
