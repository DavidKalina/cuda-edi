---
status: accepted
date: 2026-07-22
---

# SQS FIFO + durable Lambda, not Kafka or Nest/Bull

EDI here is a **job queue**, not a multi-consumer event backbone, and the stack has no Kafka today. We will use **two SQS FIFO queues** (`edi-outbound`, `edi-inbound`) with a thin `type` switch into workflow modules, and **AWS Lambda durable functions** for flattened sequential steps (replacing Bull `FlowProducer` trees). Branching becomes a follow-on Enqueue (e.g. `OUTBOUND_997`), not nested child jobs. Kafka and “smart broker routing” are explicit non-goals; Nest + Bull remains Legacy only during strangler cutover.
