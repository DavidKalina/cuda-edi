import type { EdiFormatIds, EdiMaps } from "../domain/edi-config.js";

/** Input bindings exposed to JSONata map expressions on EDI Config. */
export interface MapContext {
  businessKeys: Record<string, string>;
  formatIds: EdiFormatIds;
}

export interface MapExecutor {
  apply(expression: string, context: MapContext): Promise<unknown>;
  applyTransactionSetMap(
    maps: EdiMaps,
    transactionSet: string,
    context: MapContext,
  ): Promise<unknown>;
}

/** EDI Config map key for a transaction set number (e.g. "214" → "ts214"). */
export function transactionSetMapKey(transactionSet: string): string {
  return `ts${transactionSet}`;
}
