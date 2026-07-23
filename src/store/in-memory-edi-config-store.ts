import type { EdiConfig } from "../domain/edi-config.js";
import type { EdiConfigStore } from "./edi-config-store.js";

export class InMemoryEdiConfigStore implements EdiConfigStore {
  private readonly byId = new Map<string, EdiConfig>();

  constructor(seed: EdiConfig[] = []) {
    for (const config of seed) {
      this.byId.set(config.id, config);
    }
  }

  async getById(id: string): Promise<EdiConfig | null> {
    return this.byId.get(id) ?? null;
  }
}
