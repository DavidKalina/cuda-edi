export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

export type JobType = `${"OUTBOUND" | "INBOUND"}_${string}`;

export interface PayloadRef {
  bucket: string;
  key: string;
}

export interface ArtifactRef {
  bucket: string;
  key: string;
  kind?: string;
}

export interface EdiJob {
  id: string;
  status: JobStatus;
  /** Progress detail while status is running or failed. */
  step?: string;
  jobType: JobType;
  ediConfigId: string;
  businessKeys: Record<string, string>;
  idempotencyKey: string;
  orderingGroup: string;
  payloadRef?: PayloadRef;
  artifactRefs: ArtifactRef[];
  /** Set after the job is successfully sent to the outbound/inbound queue. */
  handedOff?: boolean;
  /** AWS Lambda durable execution id for ops correlation. */
  durableExecutionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEdiJobInput {
  jobType: JobType;
  ediConfigId: string;
  businessKeys: Record<string, string>;
  idempotencyKey: string;
  payloadRef?: PayloadRef;
}

/** Primary business key used for FIFO ordering group (shipment internal number). */
export const SHIPMENT_BUSINESS_KEY = "shipmentInternalNumber";

/**
 * Ordering group = EDI config + primary business key (shipment internal number).
 * Jobs within a group run strictly in FIFO order.
 */
export function computeOrderingGroup(
  ediConfigId: string,
  businessKeys: Record<string, string>,
): string {
  const shipmentKey = businessKeys[SHIPMENT_BUSINESS_KEY];
  if (!shipmentKey) {
    throw new Error(
      `businessKeys must include "${SHIPMENT_BUSINESS_KEY}" for ordering group`,
    );
  }
  return `${ediConfigId}#${shipmentKey}`;
}

/** Non-dead jobs are eligible for idempotent replay. */
export function isIdempotencyReplayable(status: JobStatus): boolean {
  return status !== "dead";
}
