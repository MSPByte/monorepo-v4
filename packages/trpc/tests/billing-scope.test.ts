import { describe, expect, test } from 'bun:test';
import { restrictBillingSites } from '../src/routers/billing-scope.js';

describe('billing workspace scope', () => {
  test('all scope preserves the permission ceiling', () => {
    expect(restrictBillingSites('all', null)).toBeNull();
    expect(restrictBillingSites(['allowed'], null)).toEqual(new Set(['allowed']));
  });
  test('selected sites and resolved group/link sites cannot widen access', () => {
    expect(restrictBillingSites(['allowed'], ['allowed', 'other'])).toEqual(new Set(['allowed']));
    expect(restrictBillingSites([], ['other'])).toEqual(new Set());
  });
  test('empty selections and links without attached sites return no sites', () => {
    expect(restrictBillingSites('all', [])).toEqual(new Set());
  });
  test('overlapping group and link targets are deduplicated', () => {
    expect(restrictBillingSites('all', ['a', 'a', 'b'])).toEqual(new Set(['a', 'b']));
  });
});
