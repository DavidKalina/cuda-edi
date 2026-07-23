import type { EdiConfig } from "../domain/edi-config.js";
import type { EdiJob } from "../domain/edi-job.js";

/** Remote SFTP path for an OUTBOUND_214 X12 drop under EDI Config mailbox paths. */
export function resolveOutbound214MailboxPath(
  ediConfig: EdiConfig,
  job: EdiJob,
): string {
  const base = ediConfig.mailboxPaths?.outbound;
  if (!base) {
    throw new Error(
      `EDI Config ${ediConfig.id} has no outbound mailbox path configured`,
    );
  }

  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalized}/214/${job.id}.x12`;
}
