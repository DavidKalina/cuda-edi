import type { EdiJobStore } from "../store/edi-job-store.js";
import { InMemoryEdiJobStore } from "../store/in-memory-edi-job-store.js";
import { enqueue, type EnqueueDeps } from "../enqueue/enqueue-service.js";
import type { EnqueueFn } from "../sdk/enqueue-client.js";
import { LabFifoQueue } from "./lab-fifo-queue.js";

/**
 * Local lab transport: invokes the real enqueue module in-process instead of
 * Lambda. Producers swap `createLocalEnqueueTransport` for `createEnqueueClient`
 * when moving to AWS — same `EnqueueFn` surface, different edge.
 */
export function createLocalEnqueueTransport(deps: EnqueueDeps): EnqueueFn {
  return (input) => enqueue(deps, input);
}

export interface LabEnqueueTransportConfig {
  store?: EdiJobStore;
  outboundQueue?: LabFifoQueue;
  now?: () => string;
  newId?: () => string;
}

export interface LabEnqueueTransport {
  enqueue: EnqueueFn;
  deps: EnqueueDeps;
  store: EdiJobStore;
  outboundQueue: LabFifoQueue;
}

/** Wires in-memory job store + lab FIFO queue for harness producers. */
export function createLabEnqueueTransport(
  config: LabEnqueueTransportConfig = {},
): LabEnqueueTransport {
  const store = config.store ?? new InMemoryEdiJobStore();
  const outboundQueue = config.outboundQueue ?? new LabFifoQueue();
  const deps: EnqueueDeps = {
    store,
    outboundQueue,
    ...(config.now ? { now: config.now } : {}),
    ...(config.newId ? { newId: config.newId } : {}),
  };

  return {
    enqueue: createLocalEnqueueTransport(deps),
    deps,
    store,
    outboundQueue,
  };
}
