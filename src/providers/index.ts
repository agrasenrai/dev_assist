import type { IEHRProvider } from "./types.js";
import { SQLiteCacheProvider } from "./sqlite-cache-provider.js";
import { LiveFHIRProvider } from "./fhir-api-provider.js";

export * from "./types.js";
export * from "./sqlite-cache-provider.js";
export * from "./fhir-api-provider.js";

// Singleton provider instances
const cacheProvider = new SQLiteCacheProvider();
const fhirProvider = new LiveFHIRProvider();

const providers: Record<string, IEHRProvider> = {
  "sqlite-edge-cache": cacheProvider,
  "live-fhir-api": fhirProvider
};

let currentProvider: IEHRProvider = cacheProvider;

export function getActiveProvider(): IEHRProvider {
  return currentProvider;
}

export function setActiveProvider(providerId: "sqlite-edge-cache" | "live-fhir-api"): IEHRProvider {
  const selected = providers[providerId];
  if (!selected) {
    throw new Error(`Unknown provider: ${providerId}. Available: ${Object.keys(providers).join(", ")}`);
  }
  currentProvider = selected;
  console.log(`[ProviderManager] Active provider switched to: ${selected.providerName} (${selected.providerId})`);
  return currentProvider;
}

export function listAvailableProviders(): Array<{ id: string; name: string; isEdgeCache: boolean; isActive: boolean }> {
  return Object.values(providers).map(p => ({
    id: p.providerId,
    name: p.providerName,
    isEdgeCache: p.isEdgeCache,
    isActive: p.providerId === currentProvider.providerId
  }));
}
