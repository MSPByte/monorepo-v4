import type { FilterOperator } from "../types";

/**
 * Get available operators for each filter component type
 */
export const OPERATOR_MAP: Record<string, FilterOperator[]> = {
  text: ["contains", "eq", "neq"],
  select: ["eq", "neq"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte"],
  boolean: ["eq"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte"],
};

/**
 * Get default operator for a component type
 */
export function getDefaultOperator(
  component: keyof typeof OPERATOR_MAP,
): FilterOperator {
  const defaults: Record<string, FilterOperator> = {
    text: "contains",
    select: "eq",
    number: "eq",
    boolean: "eq",
    date: "eq",
  };
  return defaults[component];
}

/**
 * Human readable labels for operators
 */
export const OPERATOR_LABELS: Partial<Record<FilterOperator, string>> = {
  eq: "equals",
  neq: "not equals",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  contains: "contains",
  is_null: "is empty",
  is_not_null: "is not empty",
};
