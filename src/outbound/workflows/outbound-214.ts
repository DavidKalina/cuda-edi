import type { EdiJob } from "../../domain/edi-job.js";
import type { OutboundProcessorDeps } from "../outbound-processor.js";
import { patchJob } from "../patch-job.js";

export const OUTBOUND_214_GENERATE_STEP = "generate";
export const OUTBOUND_214_DELIVER_STEP = "deliver";

/** Stub OUTBOUND_214 workflow: generate then deliver, no real X12 or SFTP. */
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
  // Stub generate — real implementation will apply map, mint control numbers,
  // build X12, and store artifact refs via deps.controlNumberAllocator.

  current = await patchJob(deps, current, {
    step: OUTBOUND_214_DELIVER_STEP,
  });
  // Stub deliver — real implementation will push artifacts to Partner Mailbox.

  return patchJob(deps, current, {
    status: "succeeded",
    step: undefined,
  });
}
