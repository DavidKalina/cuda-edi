import {
  DynamoDBDocumentClient,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import type { EdiConfig } from "../domain/edi-config.js";
import type { EdiConfigStore } from "./edi-config-store.js";

export class DynamoEdiConfigStore implements EdiConfigStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async getById(id: string): Promise<EdiConfig | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { id },
      }),
    );

    if (!result.Item) {
      return null;
    }
    return result.Item as EdiConfig;
  }
}
