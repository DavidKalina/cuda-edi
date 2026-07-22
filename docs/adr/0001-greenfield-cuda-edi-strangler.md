---
status: accepted
date: 2026-07-22
---

# Greenfield cuda-edi with per-config strangler cutover

We need a simpler, more scalable EDI runtime than Nest + BullMQ + Redis, without destabilizing production partners still on the current stack. We will build **cuda-edi** as a new folder/repo and leave **Legacy EDI** (`cuda-edi-api`) running unchanged except for critical fixes. Cutover is **per job type × EDI Config**; producers send each job to exactly one runtime. First tracer bullet: `OUTBOUND_214`. Both sides share **EDI Config** and a coordinated **control number** allocator; job truth for cuda-edi lives in a new table, not `cuda_edi`.
