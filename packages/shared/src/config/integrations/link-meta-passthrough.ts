import { z } from "zod";

export const passthroughLinkMetaSchema = z.record(z.string(), z.unknown());
