---
status: accepted
date: 2026-07-22
---

# No n8n in cuda-edi; Maps + Partner extensions for bespoke logic

Legacy inbound 204/211 can POST raw EDI to **n8n** via `cuda_edi_n8n` before JSONata/builtin paths. That is a heavyweight escape hatch (external visual orchestration), not a mapping layer we want to rebuild. cuda-edi will **not** depend on n8n. Partner variance uses a ladder: **builtin → Map (JSONata on EDI Config) → Partner extension** (typed code module selected by config, in-process). Optional generic webhooks are not the default bespoke path and are not a second job orchestrator.
