import type { EdiJob } from "../../domain/edi-job.js";
import { buildOutboundX12 } from "../../x12/x12-builder.js";
import type { OutboundProcessorDeps } from "../outbound-processor.js";
import { patchJob } from "../patch-job.js";

export const OUTBOUND_214_GENERATE_STEP = "generate";
export const OUTBOUND_214_DELIVER_STEP = "deliver";

const TRANSACTION_SET = "214";

function asMappedBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSONata map must return an object for OUTBOUND_214");
  }
  return value as Record<string, unknown>;
}

/** OUTBOUND_214 workflow: generate X12 artifact then deliver (deliver may be stubbed). */
export async function runOutbound214Workflow(
  deps: OutboundProcessorDeps,
  job: EdiJob,
): Promise<EdiJob> {
  let current = await patchJob(deps, job, {
    step: OUTBOUND_214_GENERATE_STEP,
  });

  const ediConfig = await deps.ediConfigStore.getById(current.ediConfigId);
  if (!ediConfig) {
    throw new Error(`EDI Config not found: ${current.ediConfigId}`);
  }

  const mapContext = {
    businessKeys: current.businessKeys,
    formatIds: ediConfig.formatIds,
  };
  const mappedBody = asMappedBody(
    await deps.mapExecutor.applyTransactionSetMap(
      ediConfig.maps,
      TRANSACTION_SET,
      mapContext,
    ),
  );

  const controlNumbers = await deps.controlNumberAllocator.allocateSet(
    current.ediConfigId,
  );
  const x12 = buildOutboundX12({
    transactionSet: TRANSACTION_SET,
    formatIds: ediConfig.formatIds,
    controlNumbers,
    body: mappedBody,
  });

  const artifactRef = await deps.artifactStore.put({
    jobId: current.id,
    ediConfigId: current.ediConfigId,
    content: x12,
    kind: "x12",
    contentType: "application/edi-x12",
  });

  current = await patchJob(deps, current, {
    artifactRefs: [...current.artifactRefs, artifactRef],
    step: OUTBOUND_214_DELIVER_STEP,
  });
  // Stub deliver — real implementation will push artifacts to Partner Mailbox.

  return patchJob(deps, current, {
    status: "succeeded",
    step: undefined,
  });
}
