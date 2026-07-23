import type { ControlNumberKind } from "../domain/control-number.js";
import {
  controlNumberCounterKey,
  type ControlNumberAllocator,
  type ControlNumberSeed,
} from "./control-number-allocator.js";

export class InMemoryControlNumberAllocator implements ControlNumberAllocator {
  private readonly counters = new Map<string, number>();

  constructor(seeds: ControlNumberSeed[] = []) {
    for (const seed of seeds) {
      this.counters.set(
        controlNumberCounterKey(seed.ediConfigId, seed.kind),
        seed.watermark,
      );
    }
  }

  async allocate(
    ediConfigId: string,
    kind: ControlNumberKind,
  ): Promise<string> {
    const key = controlNumberCounterKey(ediConfigId, kind);
    const watermark = this.counters.get(key);
    if (watermark === undefined) {
      throw new Error(
        `control number counter not seeded for ${ediConfigId}#${kind}`,
      );
    }

    const next = watermark + 1;
    this.counters.set(key, next);
    return String(next);
  }

  async allocateSet(ediConfigId: string): Promise<{
    isa: string;
    gs: string;
    st: string;
  }> {
    const [isa, gs, st] = await Promise.all([
      this.allocate(ediConfigId, "isa"),
      this.allocate(ediConfigId, "gs"),
      this.allocate(ediConfigId, "st"),
    ]);
    return { isa, gs, st };
  }
}
