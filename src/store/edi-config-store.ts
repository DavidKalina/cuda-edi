import type { EdiConfig } from "../domain/edi-config.js";

export interface EdiConfigStore {
  getById(id: string): Promise<EdiConfig | null>;
}
