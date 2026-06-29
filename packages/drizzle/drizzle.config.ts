import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
config();

export default defineConfig({
  schema: ["./src/index.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.MSP_DATABASE_URL!,
  },
  schemaFilter: [
    "public",
    "agent",
    "audit",
    "billing",
    "canonical",
    "ingestor",
    "compliance",
    "policy",
    "vendors",
    "wiki",
  ],
});
