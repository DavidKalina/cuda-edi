/**
 * ISA/GS sender and receiver identifiers for outbound interchange envelopes.
 */
export interface EdiFormatIds {
  interchangeSenderId: string;
  interchangeReceiverId: string;
  applicationSenderId: string;
  applicationReceiverId: string;
}

/**
 * Partner-specific JSONata transforms keyed by transaction set (e.g. ts214).
 */
export interface EdiMaps {
  ts214?: string;
  ts204?: string;
  [mapKey: string]: string | undefined;
}

/** Partner Mailbox SFTP path metadata for inbound/outbound drops. */
export interface PartnerMailboxPaths {
  outbound?: string;
  inbound?: string;
}

/**
 * Shared partner EDI settings — maps, format/ids, and mailbox paths.
 * Source of truth for both Legacy EDI and cuda-edi (not duplicated per runtime).
 */
export interface EdiConfig {
  id: string;
  partnerId?: string;
  enabledTransactionSets?: string[];
  maps: EdiMaps;
  formatIds: EdiFormatIds;
  mailboxPaths?: PartnerMailboxPaths;
}
