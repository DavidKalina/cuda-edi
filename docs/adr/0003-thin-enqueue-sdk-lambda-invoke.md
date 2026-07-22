---
status: accepted
date: 2026-07-22
---

# Thin Enqueue SDK via Lambda invoke (not fat SDK or public URL)

**Enqueue** (idempotent job persist + queue handoff) is owned by cuda-edi and is the only door that creates an **EDI Job**. Producers (`cuda-api`, Intake, follow-ons) use a **thin SDK that invokes an Enqueue Lambda** (AWS `Invoke`), not a public Function URL and not a fat SDK that writes the job store/SQS from the caller. That keeps credentials and idempotency in EDI, avoids a public HTTP surface, and still gives typed clients. Source-side producers replace Nest Supabase Realtime sockets as the target trigger model.
