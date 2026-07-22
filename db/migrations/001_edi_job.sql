-- EDI Job store for cuda-edi (NOT Legacy cuda_edi).
-- Placeholder migration for ticket #3. Apply via your chosen migrator
-- (raw SQL / Prisma / Drizzle — not locked yet).
--
-- Table name: edi_job

CREATE TABLE IF NOT EXISTS edi_job (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type          TEXT NOT NULL,
  status            TEXT NOT NULL
                    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  edi_config_id     TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  ordering_group    TEXT NOT NULL,
  business_keys     JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_ref       JSONB,
  artifact_refs     JSONB NOT NULL DEFAULT '[]'::jsonb,
  step_name         TEXT,
  durable_execution_id TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent Enqueue: one live (non-dead) job per (job_type, idempotency_key).
CREATE UNIQUE INDEX IF NOT EXISTS edi_job_idempotency_live_uidx
  ON edi_job (job_type, idempotency_key)
  WHERE status <> 'dead';

CREATE INDEX IF NOT EXISTS edi_job_status_idx ON edi_job (status);
CREATE INDEX IF NOT EXISTS edi_job_config_type_idx ON edi_job (edi_config_id, job_type);
CREATE INDEX IF NOT EXISTS edi_job_ordering_group_idx ON edi_job (ordering_group);

-- Control-number allocator (ADR 0004) — stub table; seed above Legacy watermark in a later ticket.
CREATE TABLE IF NOT EXISTS edi_control_number (
  edi_config_id   TEXT NOT NULL,
  counter_kind    TEXT NOT NULL,
  next_value      BIGINT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (edi_config_id, counter_kind)
);
