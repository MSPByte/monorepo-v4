import { m365Enrichers } from "../enrichers/m365.js";
import { haloPsaEnrichers } from "../enrichers/halopsa.js";
import { m365Linkers } from "../linkers/m365.js";
import type { ProjectionStep } from "./steps.js";

export const projectionSteps: readonly ProjectionStep[] = [
  ...m365Linkers,
  ...m365Enrichers,
  ...haloPsaEnrichers,
];
