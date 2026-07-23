import type { ControlNumberKind, ControlNumbers } from "../domain/control-number.js";

export interface ControlNumberSeed {
  ediConfigId: string;
  kind: ControlNumberKind;
  /** Legacy watermark — the allocator returns values strictly above this. */
  watermark: number;
}

export interface ControlNumberAllocator {
  allocate(ediConfigId: string, kind: ControlNumberKind): Promise<string>;
  allocateSet(ediConfigId: string): Promise<ControlNumbers>;
}

export function controlNumberCounterKey(
  ediConfigId: string,
  kind: ControlNumberKind,
): string {
  return `${ediConfigId}#${kind}`;
}
