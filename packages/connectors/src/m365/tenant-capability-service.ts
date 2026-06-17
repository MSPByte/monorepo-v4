import type { M365Connector } from "./connector.js";

export class TenantCapabilityService {
  constructor(private connector: M365Connector) {}

  async probe(
    plans: Record<string, string[]>,
  ): Promise<Record<string, boolean>> {
    const skus = (await this.connector.subscribedSkus.listAll()) as Array<{
      servicePlans: Array<{ servicePlanName: string }>;
    }>;

    const activePlans = new Set<string>(
      skus.flatMap((sku) => sku.servicePlans.map((sp) => sp.servicePlanName)),
    );

    return Object.fromEntries(
      Object.entries(plans).map(([key, plans]) => [
        key,
        plans.some((plan) => activePlans.has(plan)),
      ]),
    );
  }
}
