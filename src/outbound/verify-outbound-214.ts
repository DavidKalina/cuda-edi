export interface Outbound214VerifyReport {
  transactionSet: "214";
  valid: true;
  fields: {
    shipmentId: string;
    statusCode: string;
  };
}

export function verifyOutbound214MappedBody(
  body: Record<string, unknown>,
): Outbound214VerifyReport {
  const shipmentId = body.shipmentId;
  const statusCode = body.statusCode;

  if (typeof shipmentId !== "string" || shipmentId.length === 0) {
    throw new Error("OUTBOUND_214 verify failed: shipmentId is required");
  }
  if (typeof statusCode !== "string" || statusCode.length === 0) {
    throw new Error("OUTBOUND_214 verify failed: statusCode is required");
  }

  return {
    transactionSet: "214",
    valid: true,
    fields: { shipmentId, statusCode },
  };
}
