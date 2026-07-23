import type { EdiJob } from "../domain/edi-job.js";
import type { OutboundProcessorDeps } from "./outbound-processor.js";

export async function patchJob(
  deps: OutboundProcessorDeps,
  job: EdiJob,
  patch: Partial<
    Pick<EdiJob, "status" | "step" | "durableExecutionId" | "artifactRefs">
  >,
): Promise<EdiJob> {
  const timestamp = deps.now?.() ?? new Date().toISOString();
  return deps.store.put({
    ...job,
    ...patch,
    updatedAt: timestamp,
  });
}
