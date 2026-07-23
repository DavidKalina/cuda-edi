import type { ArtifactStore } from "../artifact/artifact-store.js";
import type { ControlNumberAllocator } from "../control-number/control-number-allocator.js";
import type { EdiJob, JobType } from "../domain/edi-job.js";
import type { PartnerMailboxClient } from "../mailbox/partner-mailbox-client.js";
import type { MapExecutor } from "../map/map-executor.js";
import type { EdiConfigStore } from "../store/edi-config-store.js";
import type { EdiJobStore } from "../store/edi-job-store.js";
import type { OutboundQueueMessage } from "../enqueue/outbound-queue.js";
import { patchJob } from "./patch-job.js";
import { runOutbound214Workflow } from "./workflows/outbound-214.js";

export interface OutboundProcessorDeps {
  store: EdiJobStore;
  ediConfigStore: EdiConfigStore;
  controlNumberAllocator: ControlNumberAllocator;
  mapExecutor: MapExecutor;
  artifactStore: ArtifactStore;
  partnerMailboxClient: PartnerMailboxClient;
  now?: () => string;
}

export interface ProcessOutboundJobInput {
  message: OutboundQueueMessage;
  durableExecutionId: string;
}

type OutboundWorkflowRunner = (
  deps: OutboundProcessorDeps,
  job: EdiJob,
) => Promise<EdiJob>;

const OUTBOUND_WORKFLOWS: Partial<Record<JobType, OutboundWorkflowRunner>> = {
  OUTBOUND_214: runOutbound214Workflow,
};

export async function processOutboundJob(
  deps: OutboundProcessorDeps,
  input: ProcessOutboundJobInput,
): Promise<EdiJob> {
  const job = await deps.store.getById(input.message.jobId);
  if (!job) {
    throw new Error(`EDI Job not found: ${input.message.jobId}`);
  }

  if (job.status === "succeeded") {
    return job;
  }

  if (job.status !== "queued" && job.status !== "running") {
    throw new Error(
      `EDI Job ${job.id} cannot be processed from status ${job.status}`,
    );
  }

  const workflow = OUTBOUND_WORKFLOWS[job.jobType];
  if (!workflow) {
    throw new Error(`unsupported outbound job type: ${job.jobType}`);
  }

  const running = await patchJob(deps, job, {
    status: "running",
    durableExecutionId: input.durableExecutionId,
  });

  try {
    return await workflow(deps, running);
  } catch (error) {
    const latest = (await deps.store.getById(job.id)) ?? running;
    await patchJob(deps, latest, { status: "failed" });
    throw error;
  }
}
