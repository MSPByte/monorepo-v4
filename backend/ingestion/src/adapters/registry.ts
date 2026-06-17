import type { IngestionAdapter } from "@mspbyte/pipeline";

const adapters = new Map<string, IngestionAdapter>();

export function registerAdapter(adapter: IngestionAdapter): void {
  adapters.set(adapter.providerId, adapter);
}

export function getAdapter(providerId: string): IngestionAdapter {
  const adapter = adapters.get(providerId);
  if (!adapter) throw new Error(`No ingestion adapter registered for provider: ${providerId}`);

  return adapter;
}

export function maybeGetAdapter(providerId: string): IngestionAdapter | undefined {
  return adapters.get(providerId);
}

export function listAdapters(): IngestionAdapter[] {
  return [...adapters.values()];
}
