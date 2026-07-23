import {
  DynamoDBDocumentClient,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ControlNumberKind } from "../domain/control-number.js";
import {
  controlNumberCounterKey,
  type ControlNumberAllocator,
} from "./control-number-allocator.js";

export class DynamoControlNumberAllocator implements ControlNumberAllocator {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async allocate(
    ediConfigId: string,
    kind: ControlNumberKind,
  ): Promise<string> {
    const pk = controlNumberCounterKey(ediConfigId, kind);
    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk },
        UpdateExpression: "ADD #value :inc",
        ExpressionAttributeNames: { "#value": "value" },
        ExpressionAttributeValues: { ":inc": 1 },
        ReturnValues: "UPDATED_NEW",
      }),
    );

    const value = result.Attributes?.value;
    if (typeof value !== "number") {
      throw new Error(
        `control number counter not seeded for ${ediConfigId}#${kind}`,
      );
    }
    return String(value);
  }

  async allocateSet(ediConfigId: string): Promise<{
    isa: string;
    gs: string;
    st: string;
  }> {
    const [isa, gs, st] = await Promise.all([
      this.allocate(ediConfigId, "isa"),
      this.allocate(ediConfigId, "gs"),
      this.allocate(ediConfigId, "st"),
    ]);
    return { isa, gs, st };
  }
}
