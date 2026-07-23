import type { CreateEdiJobInput } from "../domain/edi-job.js";

/**
 * Legacy EDI path when cutover is off — hands work to cuda-edi-api, not cuda-edi
 * EDI Jobs.
 */
export interface LegacyOutboundClient {
  sendOutbound214(input: CreateEdiJobInput): Promise<void>;
}

/** Records Legacy handoffs for tests; no cuda-edi job is created. */
export class InMemoryLegacyOutboundClient implements LegacyOutboundClient {
  readonly requests: CreateEdiJobInput[] = [];

  async sendOutbound214(input: CreateEdiJobInput): Promise<void> {
    this.requests.push(input);
  }
}
