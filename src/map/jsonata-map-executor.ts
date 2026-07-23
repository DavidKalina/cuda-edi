import jsonata from "jsonata";
import type { EdiMaps } from "../domain/edi-config.js";
import {
  transactionSetMapKey,
  type MapContext,
  type MapExecutor,
} from "./map-executor.js";

export class JsonataMapExecutor implements MapExecutor {
  async apply(expression: string, context: MapContext): Promise<unknown> {
    try {
      const compiled = jsonata(expression);
      return await compiled.evaluate(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`JSONata map failed: ${message}`);
    }
  }

  async applyTransactionSetMap(
    maps: EdiMaps,
    transactionSet: string,
    context: MapContext,
  ): Promise<unknown> {
    const mapKey = transactionSetMapKey(transactionSet);
    const expression = maps[mapKey];
    if (!expression) {
      throw new Error(`EDI Config map not found: ${mapKey}`);
    }
    return this.apply(expression, context);
  }
}
