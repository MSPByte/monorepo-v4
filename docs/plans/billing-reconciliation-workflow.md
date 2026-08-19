# Billing reconciliation: close the coverage loop

## Product intent

Billing is the report-and-reconcile surface for operators responsible for
revenue accuracy. Its first job is to turn an uncovered PSA billing line into
a trustworthy reconciliation rule without making the operator leave the
report, transcribe a name, or guess which site they were looking at.

## Delivered workflow

1. The **Missing rule** report view exposes a contextual **Create rule** action
   on each uncovered PSA line.
2. The action opens the existing editor with the line name, its site scope,
   billed quantity, and unit price already carried into the draft.
3. The editor identifies the source line and presents the setup in a natural
   order: confirm the PSA match, set its site scope, choose the vendor
   inventory to count, then refine filters only if needed.
4. The live preview becomes a confirmation checkpoint: it shows the source
   coverage, matched PSA rows, counted inventory, and projected MRR delta
   before saving.
5. Saving returns the operator to the report, where invalidation refreshes the
   coverage gap automatically.

## Guardrails

- A rule started from a mapped line defaults to an **exact** item-name match
  and the source site only. This avoids accidentally applying a customer-
  specific line item across every customer. The operator can deliberately
  broaden either choice.
- An unmapped line retains the existing all-sites default and explains why no
  site could be inferred.
- This is a UI/state handoff. Current tables already hold the needed PSA item,
  site, quantity, and price data, so no database migration is warranted.

## Future follow-ons

- Suggest likely vendor facets using historical rule names and inventory
  presence.
- Add a bulk rule-creation review flow for repeated uncovered lines.
- Track rule coverage and resolution time as executive-level reconciliation
  health metrics.
