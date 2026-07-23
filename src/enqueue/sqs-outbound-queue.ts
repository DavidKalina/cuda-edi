import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type {
  OutboundQueue,
  OutboundQueueMessage,
  SendOutboundMessageOptions,
} from "./outbound-queue.js";

export class SqsOutboundQueue implements OutboundQueue {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async send(
    message: OutboundQueueMessage,
    options: SendOutboundMessageOptions,
  ): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: options.messageGroupId,
        MessageDeduplicationId: message.jobId,
      }),
    );
  }
}
