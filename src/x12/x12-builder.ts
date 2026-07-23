import type { ControlNumbers } from "../domain/control-number.js";
import type { EdiFormatIds } from "../domain/edi-config.js";

const SEGMENT_TERMINATOR = "~";
const ELEMENT_SEPARATOR = "*";

export interface OutboundX12Input {
  transactionSet: string;
  formatIds: EdiFormatIds;
  controlNumbers: ControlNumbers;
  /** Mapped transaction-set document from JSONata. */
  body: Record<string, unknown>;
  /** Interchange timestamp used for ISA/GS date-time elements. */
  processedAt: Date;
}

function padRight(value: string, length: number): string {
  if (value.length > length) {
    return value.slice(0, length);
  }
  return value.padEnd(length, " ");
}

function padLeft(value: string, length: number, fill = "0"): string {
  if (value.length > length) {
    return value.slice(-length);
  }
  return value.padStart(length, fill);
}

function joinSegment(...elements: string[]): string {
  return elements.join(ELEMENT_SEPARATOR) + SEGMENT_TERMINATOR;
}

function stringField(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function formatGsDate(processedAt: Date): string {
  const year = processedAt.getUTCFullYear();
  const month = String(processedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(processedAt.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatIsaDate(processedAt: Date): string {
  return formatGsDate(processedAt).slice(2);
}

function formatInterchangeTime(processedAt: Date): string {
  const hours = String(processedAt.getUTCHours()).padStart(2, "0");
  const minutes = String(processedAt.getUTCMinutes()).padStart(2, "0");
  return `${hours}${minutes}`;
}

function build214BodySegments(body: Record<string, unknown>): string[] {
  const segments: string[] = [];
  const shipmentId = stringField(body.shipmentId);
  const statusCode = stringField(body.statusCode);

  if (shipmentId) {
    segments.push(joinSegment("B10", shipmentId));
  }
  if (statusCode) {
    segments.push(joinSegment("AT7", statusCode));
  }

  return segments;
}

function buildTransactionSetBody(
  transactionSet: string,
  body: Record<string, unknown>,
): string[] {
  switch (transactionSet) {
    case "214":
      return build214BodySegments(body);
    default:
      throw new Error(`unsupported outbound transaction set: ${transactionSet}`);
  }
}

/** Builds a minimal X12 interchange envelope with mapped transaction-set body. */
export function buildOutboundX12(input: OutboundX12Input): string {
  const { transactionSet, formatIds, controlNumbers, body, processedAt } =
    input;
  const bodySegments = buildTransactionSetBody(transactionSet, body);
  const stControl = controlNumbers.st;
  const gsDate = formatGsDate(processedAt);
  const isaDate = formatIsaDate(processedAt);
  const interchangeTime = formatInterchangeTime(processedAt);
  const transactionSegments = [
    joinSegment("ST", transactionSet, stControl),
    ...bodySegments,
    joinSegment("SE", String(bodySegments.length + 2), stControl),
  ];

  const gsControl = controlNumbers.gs;
  const functionalSegments = [
    joinSegment(
      "GS",
      "QM",
      formatIds.applicationSenderId,
      formatIds.applicationReceiverId,
      gsDate,
      interchangeTime,
      gsControl,
      "X",
      "004010",
    ),
    ...transactionSegments,
    joinSegment("GE", "1", gsControl),
  ];

  const isaControl = controlNumbers.isa;
  const interchangeSegments = [
    joinSegment(
      "ISA",
      "00",
      padRight("", 10),
      "00",
      padRight("", 10),
      "ZZ",
      padRight(formatIds.interchangeSenderId, 15),
      "ZZ",
      padRight(formatIds.interchangeReceiverId, 15),
      isaDate,
      interchangeTime,
      "U",
      "00401",
      padLeft(isaControl, 9),
      "0",
      "P",
      ">",
    ),
    ...functionalSegments,
    joinSegment("IEA", "1", padLeft(isaControl, 9)),
  ];

  return interchangeSegments.join("");
}
