import type { FetchResultCursor, IngestionAdapter } from "@mspbyte/pipeline";

export const devAdapter: IngestionAdapter = {
  providerId: "dev",
  types: ["dev_entities"],
  async *fetch(_type, mode, cursor, context): AsyncGenerator<
    {
      records: Array<{
        externalId: string;
        payload: Record<string, unknown>;
      }>;
      cursorIn?: string;
      cursorOut?: string;
    },
    FetchResultCursor
  > {
    const cursorIn = cursor;
    const cursorOut = `${Date.now()}`;

    yield {
      cursorIn,
      cursorOut,
      records: [
        {
          externalId: `${context.linkId}_dev_1`,
          payload: {
            id: `${context.linkId}_dev_1`,
            mode,
            name: "Development Entity 1",
          },
        },
        {
          externalId: `${context.linkId}_dev_2`,
          payload: {
            id: `${context.linkId}_dev_2`,
            mode,
            name: "Development Entity 2",
          },
        },
      ],
    };

    return cursorOut;
  },
};
