---
status: accepted
date: 2026-07-22
---

# Shared control-number allocator seeded above Legacy watermark

Outbound ISA/GS/ST **control numbers** must not collide while Legacy EDI and cuda-edi both send for the same partners. cuda-edi will mint from a **dedicated Postgres allocator** (row-locked counters, ideally per EDI Config + counter kind), **seeded above Legacy’s current watermark**. We will not run a second uncoordinated “max(`cuda_edi`)+1” scheme, and we will not rewrite Legacy stash on day one. Pointing Legacy at the same allocator is optional later when those job types cut over.
