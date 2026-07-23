import SftpClient from "ssh2-sftp-client";
import type { PartnerMailboxClient } from "./partner-mailbox-client.js";

export interface SftpPartnerMailboxClientConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
}

/** SFTPGo Partner Mailbox uploads via SFTP. */
export class SftpPartnerMailboxClient implements PartnerMailboxClient {
  constructor(private readonly config: SftpPartnerMailboxClientConfig) {}

  private async withClient<T>(
    operation: (client: SftpClient) => Promise<T>,
  ): Promise<T> {
    const client = new SftpClient();
    await client.connect({
      host: this.config.host,
      port: this.config.port ?? 22,
      username: this.config.username,
      password: this.config.password,
    });
    try {
      return await operation(client);
    } finally {
      await client.end();
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    return this.withClient(async (client) => {
      const result = await client.exists(remotePath);
      return result !== false;
    });
  }

  async putFile(remotePath: string, content: Uint8Array): Promise<void> {
    await this.withClient(async (client) => {
      const directory = remotePath.slice(0, remotePath.lastIndexOf("/"));
      if (directory.length > 0) {
        await client.mkdir(directory, true);
      }
      await client.put(Buffer.from(content), remotePath);
    });
  }
}

export function readSftpPartnerMailboxClientEnv(
  env: NodeJS.ProcessEnv = process.env,
): SftpPartnerMailboxClientConfig {
  const host = env.EDI_MAILBOX_SFTP_HOST;
  const username = env.EDI_MAILBOX_SFTP_USERNAME;
  const password = env.EDI_MAILBOX_SFTP_PASSWORD;
  if (!host || !username || !password) {
    throw new Error(
      "EDI_MAILBOX_SFTP_HOST, EDI_MAILBOX_SFTP_USERNAME, and EDI_MAILBOX_SFTP_PASSWORD must be set",
    );
  }

  const port = env.EDI_MAILBOX_SFTP_PORT
    ? Number(env.EDI_MAILBOX_SFTP_PORT)
    : undefined;
  if (port !== undefined && Number.isNaN(port)) {
    throw new Error("EDI_MAILBOX_SFTP_PORT must be a number");
  }

  return { host, username, password, port };
}
