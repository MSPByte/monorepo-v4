/** Intersect saved workspace sites with the Billing.Read permission ceiling. */
export function restrictBillingSites(
  roleSites: 'all' | readonly string[],
  selectedSites: readonly string[] | null
): Set<string> | null {
  if (selectedSites === null) return roleSites === 'all' ? null : new Set(roleSites);
  const selected = new Set(selectedSites);
  return roleSites === 'all' ? selected : new Set(roleSites.filter((site) => selected.has(site)));
}
