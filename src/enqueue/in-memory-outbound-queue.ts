import type {
  OutboundQueue,
  OutboundQueueMessage,
  SendOutboundMessageOptions,
} from "./outbound-queue.js";

export interface RecordedOutboundMessage {
  message: OutboundQueueMessage;
  messageGroupId: string;
}

export class InMemoryOutboundQueue implements OutboundQueue {
  readonly messages: RecordedOutboundMessage[] = [];

  async send(
    message: OutboundQueueMessage,
    options: SendOutboundMessageOptions,
  ): Promise<void> {
    this.messages.push({
      message,
      messageGroupId: options.messageGroupId,
    });
  }
}
