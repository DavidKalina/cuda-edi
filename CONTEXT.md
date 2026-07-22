# EDI

Partner EDI document processing for CUDA: produce and consume X12 transaction sets under partner configs, with durable job lifecycle. This is the glossary for **cuda-edi** (new runtime). Legacy Nest/Bull lives in `cuda-edi-api`.

## Language

**EDI Job**:
One intent to produce or consume one transaction set under one partner EDI config, with a single lifecycle (queued → running → succeeded / failed / dead). Persisted in cuda-edi’s own job store, not in Legacy’s `cuda_edi` table.
_Avoid_: Flow, message, execution, Bull job (as the ops-facing noun); reusing `cuda_edi` as the new job store

**Intake**:
Discovery and preparation of a partner-dropped file before an EDI Job exists: park payload, classify transaction-set type, then create and enqueue the matching inbound EDI Job. Primary trigger is Partner Mailbox upload hook; periodic sweep is backup only. Failures here are Quarantine, not EDI Jobs.
_Avoid_: Inbound job, intake job, intake flow; cron-only as the architecture

**Outbound**:
Direction of an EDI Job where CUDA produces X12 and delivers it to the partner.
_Avoid_: Export, send-only (as the direction name)

**Inbound**:
Direction of an EDI Job where partner-supplied X12 is applied into CUDA, after Intake has created the job.
_Avoid_: Import, intake (intake is not inbound)

**Job type**:
Classification of an EDI Job as `{DIRECTION}_{SET}` (e.g. `OUTBOUND_214`, `INBOUND_204`, `OUTBOUND_997`). Same transaction-set number in both directions are different job types.
_Avoid_: TS infix (`OUTBOUND_TS214`), intake* as a job type, bare set number alone

**Follow-on job**:
An EDI Job created because another EDI Job finished (e.g. `OUTBOUND_997` after an inbound job). Linked by correlation only — not a nested child of the prior job’s execution. Each job has its own terminal status.
_Avoid_: Child job, sub-flow, nested flow

**Idempotency key**:
Producer-chosen (or enqueue-derived) identity of a single business intent for one job type. Enqueue with an existing key for a non-dead job returns that EDI Job — it does not create a second one. Key shape is per job type.
_Avoid_: Soft time-window dedup as the permanent rule; `Date.now()` in the key

**Ordering group**:
The scope within which EDI Jobs must run strictly in order (FIFO). Default: partner EDI config + primary business key (usually shipment internal number; for pre-shipment inbound, the intake-assigned business identity). Not config-alone and not per-message uniqueness.
_Avoid_: Global queue ordering; job-id-only groups

**Enqueue**:
The sole operation that creates an EDI Job (idempotent persist + handoff to the outbound or inbound queue). All producers — cuda-api, triggers, Intake, follow-on logic — go through Enqueue. EDI owns Enqueue; producers use EDI’s client and do not write the job store or queues themselves.
_Avoid_: Ad-hoc `createFlow`, direct queue/DB writes from cuda-api, Nest-only enqueue as the long-term door

**Producer**:
The system that already commits the business fact and is responsible for calling Enqueue (e.g. cuda-api on milestone or charges finalized). Intake and follow-on completion are also producers for the jobs they create.
_Avoid_: Realtime daemon / Nest socket subscription as the primary outbound trigger

**Job status**:
Ops-visible lifecycle of an EDI Job: `queued` → `running` → `succeeded` | `failed` | `dead`. Step name is progress detail on running/failed, not a separate status.
_Avoid_: Numeric codes (`1`/`2`); treating durable-execution state as the ops source of truth

**Redrive**:
Explicit operator (or policy) action that runs a new attempt for a `failed` EDI Job without creating a second job identity. `dead` jobs are not auto-redriven.
_Avoid_: Silent duplicate Enqueue as redrive; nested child retry flows

**Payload**:
Input document bytes for an EDI Job when the job starts from a file (typically inbound after Intake). Referenced from the job; stored in object storage — not in the queue message body. Optional for outbound jobs that generate from TMS state.
_Avoid_: Embedding EDI bodies in SQS; calling the input an “attachment” interchangeably with outputs

**Artifact**:
Output bytes a workflow produced and retained (generated X12, mapped JSON, verify report, etc.). Stored in object storage; the job accumulates refs.
_Avoid_: Payload (inputs are payloads); queue message bodies

**Quarantine**:
Intake outcome when a dropped file cannot become an EDI Job (unknown type, parse failure, no matching config, poison payload). Bytes and reason are retained for operator retry/reclassify; not an EDI Job and not an `INBOUND_UNKNOWN` job type.
_Avoid_: Failed EDI Job of unknown type; silent delete with only a log line

**EDI Config**:
Partner-specific EDI settings (maps, SFTP paths, format/ids, enabled transaction sets) keyed by config id. Shared source of truth for both Legacy EDI and the new runtime — not duplicated per system.
_Avoid_: Copying partner config into a second schema as the default; hard-coding partner behavior in workers

**Legacy EDI**:
The existing NestJS + BullMQ + Redis `cuda-edi-api` worker stack. Remains running for job types not yet cut over; not the long-term runtime.
_Avoid_: Calling Legacy “the EDI system” after cutover; rewriting Bull flows as the migration strategy

**cuda-edi**:
The new EDI runtime and repo: Enqueue, Intake, durable workers, and the Enqueue SDK. Takes over from Legacy EDI one job type at a time (strangler).
_Avoid_: cuda-edi-v2; treating Nest `cuda-edi-api` as the long-term home

**Cutover**:
The switch that sends a given job type for a given EDI Config to cuda-edi instead of Legacy EDI. Default is Legacy until explicitly enabled. Producers choose one path — never both.
_Avoid_: Global-only flip with no per-config pilot; dual-enqueue to Legacy and cuda-edi

**Control number**:
ISA/GS/ST (and related) sequence values minted for outbound interchange identity. During the strangler, cuda-edi allocates from a dedicated allocator seeded above Legacy’s watermark; it does not invent a second ad-hoc “max(cuda_edi)+1” scheme.
_Avoid_: Independent uncoordinated counters in both runtimes; relying on Legacy’s stash algorithm long-term

**Partner Mailbox**:
The partner-facing SFTP endpoint where CUDA drops outbound Artifacts and partners drop inbound files. Remains SFTPGo; not the job runtime.
_Avoid_: Treating Nest or cuda-edi compute as the partner endpoint; replacing SFTPGo as part of this redesign

**Map**:
Partner-specific JSONata transforms stored on EDI Config (e.g. `ts214`, `ts204`). First customization layer above builtins for field and layout quirks.
_Avoid_: Embedding partner maps only in worker source; using n8n as the map layer

**Partner extension**:
Optional typed code module for bespoke partner logic that Maps cannot sanely express. Selected by EDI Config; runs inside the cuda-edi workflow (same job), not as a separate orchestration runtime.
_Avoid_: n8n (or any visual workflow engine) as EDI orchestration; webhook round-trips as the default bespoke path
