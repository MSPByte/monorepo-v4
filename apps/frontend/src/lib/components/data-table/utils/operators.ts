import type { FilterOperator } from '../types';

/**
 * Get available operators for each filter component type
 */
export const OPERATOR_MAP: Record<string, FilterOperator[]> = {
  text: ['contains', 'eq', 'neq'],
  select: ['eq', 'neq'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  boolean: ['eq'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
};

/**
 * Get default operator for a component type
 */
export function getDefaultOperator(component: keyof typeof OPERATOR_MAP): FilterOperator {
  const defaults: Record<string, FilterOperator> = {
    text: 'contains',
    select: 'eq',
    number: 'eq',
    boolean: 'eq',
    date: 'eq',
  };
  return defaults[component];
}

/**
 * Human readable labels for operators
 */
export const OPERATOR_LABELS: Partial<Record<FilterOperator, string>> = {
  eq: 'Equals',
  neq: 'Does not equal',
  gt: 'Greater than',
  gte: 'Greater than or equal',
  lt: 'Less than',
  lte: 'Less than or equal',
  contains: 'Contains',
  is_null: 'Is missing',
  is_not_null: 'Exists',
};
