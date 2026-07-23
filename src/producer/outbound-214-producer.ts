import type { CutoverStore } from "../cutover/cutover-store.js";
import type { CreateEdiJobInput, EdiJob } from "../domain/edi-job.js";
import type { EnqueueFn } from "../sdk/enqueue-client.js";
import type { LegacyOutboundClient } from "./legacy-outbound-client.js";

export type Outbound214ProducerResult =
  | { runtime: "cuda-edi"; job: EdiJob }
  | { runtime: "legacy" };

export interface Outbound214ProducerDeps {
  cutoverStore: CutoverStore;
  enqueue: EnqueueFn;
  legacy: LegacyOutboundClient;
}

/**
 * Pilot producer harness for OUTBOUND_214. Routes to cuda-edi Enqueue only when
 * cutover is enabled for the job type × EDI Config; otherwise Legacy only.
 */
export async function produceOutbound214(
  deps: Outbound214ProducerDeps,
  input: CreateEdiJobInput,
): Promise<Outbound214ProducerResult> {
  if (input.jobType !== "OUTBOUND_214") {
    throw new Error(`expected OUTBOUND_214, got ${input.jobType}`);
  }

  const cudaEdiEnabled = await deps.cutoverStore.isCudaEdiEnabled(
    input.ediConfigId,
    "OUTBOUND_214",
  );

  if (cudaEdiEnabled) {
    const job = await deps.enqueue(input);
    return { runtime: "cuda-edi", job };
  }

  await deps.legacy.sendOutbound214(input);
  return { runtime: "legacy" };
}
