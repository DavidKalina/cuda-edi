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
  const { transactionSet, formatIds, controlNumbers, body } = input;
  const bodySegments = buildTransactionSetBody(transactionSet, body);
  const stControl = controlNumbers.st;
  const transactionSegments = [
    joinSegment("ST", transactionSet, stControl),
    ...bodySegments,
    joinSegment("SE", String(bodySegments.length + 1), stControl),
  ];

  const gsControl = controlNumbers.gs;
  const functionalSegments = [
    joinSegment(
      "GS",
      "QM",
      formatIds.applicationSenderId,
      formatIds.applicationReceiverId,
      "20260723",
      "0138",
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
      "260723",
      "0138",
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
