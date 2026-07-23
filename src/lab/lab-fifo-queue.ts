import { randomUUID } from "node:crypto";
import type {
  OutboundQueue,
  OutboundQueueMessage,
  SendOutboundMessageOptions,
} from "../enqueue/outbound-queue.js";

interface QueuedEntry {
  receiptHandle: string;
  message: OutboundQueueMessage;
  messageGroupId: string;
}

export interface ReceivedOutboundMessage {
  receiptHandle: string;
  message: OutboundQueueMessage;
  messageGroupId: string;
}

export interface ReceiveOutboundMessagesOptions {
  /** Max messages to return (default 1). */
  maxMessages?: number;
}

/**
 * In-memory FIFO queue with SQS FIFO–like ordering: one in-flight message per
 * MessageGroupId; strict order within a group; groups are independent.
 */
export class LabFifoQueue implements OutboundQueue {
  private readonly pending = new Map<string, QueuedEntry[]>();
  private readonly inFlight = new Map<string, QueuedEntry>();

  async send(
    message: OutboundQueueMessage,
    options: SendOutboundMessageOptions,
  ): Promise<void> {
    const entry: QueuedEntry = {
      receiptHandle: randomUUID(),
      message,
      messageGroupId: options.messageGroupId,
    };
    const group = this.pending.get(options.messageGroupId) ?? [];
    group.push(entry);
    this.pending.set(options.messageGroupId, group);
  }

  /**
   * Returns the oldest available message per group — at most one per group while
   * a prior message in that group is still in flight.
   */
  async receive(
    options: ReceiveOutboundMessagesOptions = {},
  ): Promise<ReceivedOutboundMessage[]> {
    const maxMessages = options.maxMessages ?? 1;
    const received: ReceivedOutboundMessage[] = [];

    for (const [messageGroupId, group] of this.pending) {
      if (received.length >= maxMessages) {
        break;
      }
      if (group.length === 0) {
        continue;
      }
      if (this.hasInFlightForGroup(messageGroupId)) {
        continue;
      }

      const entry = group.shift()!;
      if (group.length === 0) {
        this.pending.delete(messageGroupId);
      }
      this.inFlight.set(entry.receiptHandle, entry);
      received.push({
        receiptHandle: entry.receiptHandle,
        message: entry.message,
        messageGroupId: entry.messageGroupId,
      });
    }

    return received;
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    if (!this.inFlight.delete(receiptHandle)) {
      throw new Error(`unknown receipt handle: ${receiptHandle}`);
    }
  }

  private hasInFlightForGroup(messageGroupId: string): boolean {
    for (const entry of this.inFlight.values()) {
      if (entry.messageGroupId === messageGroupId) {
        return true;
      }
    }
    return false;
  }
}
