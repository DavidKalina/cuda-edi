import type { ArtifactRef, EdiJob } from "../../domain/edi-job.js";
import { resolveOutbound214MailboxPath } from "../../mailbox/resolve-outbound-214-path.js";
import { buildOutboundX12 } from "../../x12/x12-builder.js";
import type { OutboundProcessorDeps } from "../outbound-processor.js";
import { patchJob } from "../patch-job.js";
import { verifyOutbound214MappedBody } from "../verify-outbound-214.js";

export const OUTBOUND_214_GENERATE_STEP = "generate";
export const OUTBOUND_214_VERIFY_STEP = "verify";
export const OUTBOUND_214_DELIVER_STEP = "deliver";

const TRANSACTION_SET = "214";
const X12_ARTIFACT_KIND = "x12";

function asMappedBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSONata map must return an object for OUTBOUND_214");
  }
  return value as Record<string, unknown>;
}

function findArtifactByKind(
  artifactRefs: ArtifactRef[],
  kind: string,
): ArtifactRef | undefined {
  return artifactRefs.find((ref) => ref.kind === kind);
}

function processingTime(deps: OutboundProcessorDeps): Date {
  return new Date(deps.now?.() ?? new Date().toISOString());
}

async function deliverOutbound214X12(
  deps: OutboundProcessorDeps,
  job: EdiJob,
): Promise<EdiJob> {
  const current = await patchJob(deps, job, {
    step: OUTBOUND_214_DELIVER_STEP,
  });

  const ediConfig = await deps.ediConfigStore.getById(current.ediConfigId);
  if (!ediConfig) {
    throw new Error(`EDI Config not found: ${current.ediConfigId}`);
  }

  const x12Ref = findArtifactByKind(current.artifactRefs, X12_ARTIFACT_KIND);
  if (!x12Ref) {
    throw new Error(`X12 artifact missing for OUTBOUND_214 job ${current.id}`);
  }

  const remotePath = resolveOutbound214MailboxPath(ediConfig, current);
  if (!(await deps.partnerMailboxClient.exists(remotePath))) {
    const content = await deps.artifactStore.get(x12Ref);
    if (!content) {
      throw new Error(`Artifact not found for key ${x12Ref.key}`);
    }
    await deps.partnerMailboxClient.putFile(remotePath, content);
  }

  return current;
}

/** OUTBOUND_214 workflow: map, verify, generate X12 artifact, then deliver to Partner Mailbox. */
export async function runOutbound214Workflow(
  deps: OutboundProcessorDeps,
  job: EdiJob,
): Promise<EdiJob> {
  let current = job;

  if (!findArtifactByKind(current.artifactRefs, X12_ARTIFACT_KIND)) {
    current = await patchJob(deps, current, {
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

    const verifyReport = verifyOutbound214MappedBody(mappedBody);
    const verifyRef = await deps.artifactStore.put({
      jobId: current.id,
      ediConfigId: current.ediConfigId,
      content: JSON.stringify(verifyReport),
      kind: "verify",
      contentType: "application/json",
    });
    current = await patchJob(deps, current, {
      step: OUTBOUND_214_VERIFY_STEP,
      artifactRefs: [...current.artifactRefs, verifyRef],
    });

    const controlNumbers = await deps.controlNumberAllocator.allocateSet(
      current.ediConfigId,
    );
    const x12 = buildOutboundX12({
      transactionSet: TRANSACTION_SET,
      formatIds: ediConfig.formatIds,
      controlNumbers,
      body: mappedBody,
      processedAt: processingTime(deps),
    });

    const artifactRef = await deps.artifactStore.put({
      jobId: current.id,
      ediConfigId: current.ediConfigId,
      content: x12,
      kind: X12_ARTIFACT_KIND,
      contentType: "application/edi-x12",
    });

    current = await patchJob(deps, current, {
      artifactRefs: [...current.artifactRefs, artifactRef],
    });
  }

  current = await deliverOutbound214X12(deps, current);

  return patchJob(deps, current, {
    status: "succeeded",
    step: undefined,
  });
}
