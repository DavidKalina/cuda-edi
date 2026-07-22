# cuda-edi

Greenfield EDI runtime (SQS FIFO + durable Lambda) that stranglers Legacy Nest/Bull (`cuda-edi-api`). First tracer: **`OUTBOUND_214`**.

- Glossary: [`CONTEXT.md`](./CONTEXT.md)
- Decisions: [`docs/adr/`](./docs/adr/)
- Parent spec: [issue #2](https://github.com/DavidKalina/cuda-edi/issues/2)
- **Next implementation ticket:** [issue #3 — Idempotent Enqueue](https://github.com/DavidKalina/cuda-edi/issues/3)

Personal POC repo for now; not in the compose stack.

## Layout

| Path | Role |
|---|---|
| `packages/edi-core` | Domain types, Ordering group helpers, `JobStore` seam |
| `packages/enqueue-sdk` | Thin client: Lambda `Invoke` only (ADR 0003) |
| `lambda/enqueue` | Enqueue Lambda (stub → #3) |
| `lambda/outbound-worker` | Outbound FIFO worker stub (#4 shell, #5 real 214) |
| `lib/` + `bin/` | AWS CDK stack |
| `db/migrations/` | `edi_job` (+ control-number stub) — **not** Legacy `cuda_edi` |
| `events/` | Sample Enqueue + SQS payloads |
| `test/` | Smoke tests for the package graph |

## Object storage

Payloads and Artifacts live in a **dedicated S3 bucket** created by the CDK stack (`cuda-edi-artifacts-{env}-{account}`). Queue messages carry refs only. (Supabase S3-compatible storage is used elsewhere in CUDA; we can switch later if we want one store — not required for the POC.)

## Install / build / test

```bash
npm install
npm run build
npm test
```

Requires Node ≥ 20.

## Deploy (dev)

```bash
cp env.example .env   # fill non-secret placeholders / wire secrets via CDK context
npm run synth:dev     # CloudFormation template
npm run diff:dev
npm run deploy:dev    # needs AWS credentials + account
```

CDK context / env:

- `environment` — `dev` \| `test` \| `prod`
- `DATABASE_URL` or `EDI_DB_SECRET_ARN` — job store (Secrets Manager preferred in AWS)
- Outputs: Enqueue function name (for the SDK), queue URLs, artifacts bucket

IAM sketches in the stack: Enqueue may send to `edi-outbound`, both Lambdas read/write the artifacts bucket, optional Secrets Manager get for DB, account-principal invoke on Enqueue (tighten to cuda-api role later).

## Work starts at #3

Scaffold only. Do **not** expect real idempotent Enqueue, JSONata 214, SFTP delivery, Cutover, or Redrive here — those are tickets #3–#8.
