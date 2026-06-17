const SKU_CATALOG_URL =
  'https://download.microsoft.com/download/e/3/e/e3e9faf2-f28b-490a-9ada-c6089a1fc5b0/Product%20names%20and%20service%20plan%20identifiers%20for%20licensing.csv';

/**
 * Resolves Microsoft Graph skuPartNumber values to Microsoft's product display names.
 * The public CSV is cached once per process and failures fall back to an empty map.
 */
export class SkuCatalogService {
  private static cache: Map<string, string> | null = null;

  static async resolve(): Promise<Map<string, string>> {
    if (SkuCatalogService.cache) return SkuCatalogService.cache;

    const map = new Map<string, string>();
    try {
      const res = await fetch(SKU_CATALOG_URL);
      if (!res.ok) throw new Error(`SKU catalog fetch failed: ${res.status}`);

      const text = await res.text();
      const lines = text.split(/\r?\n/);
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;

        const cols = parseCsvLine(line);
        const friendlyName = cols[0]?.trim();
        const skuPartNumber = cols[1]?.trim();
        if (skuPartNumber && friendlyName && !map.has(skuPartNumber)) {
          map.set(skuPartNumber, friendlyName);
        }
      }
    } catch {
      // Friendly names are cosmetic; callers fall back to skuPartNumber.
    }

    SkuCatalogService.cache = map;
    return map;
  }

  static clearCacheForTests(): void {
    SkuCatalogService.cache = null;
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
