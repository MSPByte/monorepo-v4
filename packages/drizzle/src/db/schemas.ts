import { pgSchema } from "drizzle-orm/pg-core";

export const agentSchema = pgSchema("agent");
export const auditSchema = pgSchema("audit");
export const billingSchema = pgSchema("billing");
export const canonicalSchema = pgSchema("canonical");
export const ingestorSchema = pgSchema("ingestor");
export const policySchema = pgSchema("policy");
export const vendorsSchema = pgSchema("vendors");
export const wikiSchema = pgSchema("wiki");
