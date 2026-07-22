/**
 * Shared EDI domain types and seams for cuda-edi.
 * Glossary: see CONTEXT.md. Do not reuse Legacy `cuda_edi` as the job store.
 */

/** Job type = `{DIRECTION}_{SET}` (e.g. OUTBOUND_214). */
export type JobType = "OUTBOUND_214" | (string & {});

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

export type JobDirection = "outbound" | "inbound";

/** Object-storage reference; never put EDI document bytes in SQS. */
export interface ObjectRef {
  bucket: string;
  key: string;
}

export interface EdiJob {
  id: string;
  jobType: JobType;
  status: JobStatus;
  /** EDI Config id (shared with Legacy). */
  ediConfigId: string;
  /** Producer-chosen or enqueue-derived; unique per non-dead job of this type. */
  idempotencyKey: string;
  /** Ordering group = typically config + primary business key. */
  orderingGroup: string;
  businessKeys: Record<string, string>;
  payloadRef?: ObjectRef;
  artifactRefs: ObjectRef[];
  /** Progress detail on running/failed; not a separate status. */
  stepName?: string;
  /** Durable-execution id for correlation (not a clone of AWS checkpoint history). */
  durableExecutionId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueRequest {
  jobType: JobType;
  ediConfigId: string;
  idempotencyKey: string;
  businessKeys: Record<string, string>;
  /** Optional; typical for inbound after Intake. Often absent for OUTBOUND_214. */
  payloadRef?: ObjectRef;
}

export interface EnqueueResult {
  job: EdiJob;
  /** True when this call created the job; false on idempotent replay. */
  created: boolean;
}

/** Refs-only queue message body (ADR 0002). */
export interface QueueJobMessage {
  jobId: string;
  jobType: JobType;
  ediConfigId: string;
  idempotencyKey: string;
  orderingGroup: string;
  businessKeys: Record<string, string>;
  payloadRef?: ObjectRef;
}

export function directionOf(jobType: JobType): JobDirection {
  if (jobType.startsWith("INBOUND_")) return "inbound";
  if (jobType.startsWith("OUTBOUND_")) return "outbound";
  throw new Error(`Unknown job type direction: ${jobType}`);
}

/**
 * Default Ordering group: EDI Config + primary business key.
 * OUTBOUND_214 uses shipment internal number when present.
 */
export function defaultOrderingGroup(
  ediConfigId: string,
  businessKeys: Record<string, string>
): string {
  const primary =
    businessKeys.shipmentInternalNumber ??
    businessKeys.shipmentId ??
    businessKeys.primaryBusinessKey;
  if (!primary) {
    throw new Error(
      "Ordering group requires a primary business key (e.g. shipmentInternalNumber)"
    );
  }
  return `${ediConfigId}#${primary}`;
}

/** Job-store seam — Postgres adapter lands with ticket #3. */
export interface JobStore {
  findByIdempotencyKey(
    jobType: JobType,
    idempotencyKey: string
  ): Promise<EdiJob | null>;
  insertQueued(job: Omit<EdiJob, "createdAt" | "updatedAt">): Promise<EdiJob>;
  updateStatus(
    id: string,
    status: JobStatus,
    patch?: Partial<Pick<EdiJob, "stepName" | "errorMessage" | "durableExecutionId" | "artifactRefs">>
  ): Promise<EdiJob>;
}
