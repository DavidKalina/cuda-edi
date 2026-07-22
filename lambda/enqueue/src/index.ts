/**
 * Enqueue Lambda stub.
 * Ticket #3 implements: idempotent job persist + edi-outbound.fifo handoff.
 */
import type { EnqueueRequest, EnqueueResult } from "@cuda-edi/edi-core";
import { defaultOrderingGroup } from "@cuda-edi/edi-core";

export async function handler(event: EnqueueRequest): Promise<EnqueueResult> {
  // Scaffold only — real JobStore + SQS SendMessage lands in issue #3.
  if (!event?.jobType || !event?.ediConfigId || !event?.idempotencyKey) {
    throw new Error(
      "Enqueue requires jobType, ediConfigId, and idempotencyKey"
    );
  }

  const orderingGroup = defaultOrderingGroup(
    event.ediConfigId,
    event.businessKeys ?? {}
  );

  const now = new Date().toISOString();
  const jobId = `stub-${event.idempotencyKey}`;

  return {
    created: true,
    job: {
      id: jobId,
      jobType: event.jobType,
      status: "queued",
      ediConfigId: event.ediConfigId,
      idempotencyKey: event.idempotencyKey,
      orderingGroup,
      businessKeys: event.businessKeys ?? {},
      payloadRef: event.payloadRef,
      artifactRefs: [],
      createdAt: now,
      updatedAt: now,
    },
  };
}
