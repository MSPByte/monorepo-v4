CREATE TABLE "policy"."fact_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "provider_id" text REFERENCES "public"."integrations"("id") ON DELETE SET NULL,
  "fact_key" text NOT NULL,
  "priority" integer NOT NULL DEFAULT 0,
  "definition" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "fact_rules_enabled_idx" ON "policy"."fact_rules" ("enabled");
--> statement-breakpoint
CREATE INDEX "fact_rules_provider_idx" ON "policy"."fact_rules" ("provider_id");
--> statement-breakpoint
ALTER TABLE "policy"."fact_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "fact_rules_crud" ON "policy"."fact_rules"
  FOR ALL TO "authenticated" USING (true) WITH CHECK (true);
