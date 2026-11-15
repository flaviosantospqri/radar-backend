export type MarketSearchInput = { query: string; limit?: number };
export type RawMarketReference = {
  source: string; externalId: string | null; title: string; priceCents: number; currency: "BRL"; condition: string | null; url: string; collectedAt: Date; metadata: Record<string, unknown>;
};

export interface MarketResearchProvider {
  getProviderName(): string;
  checkAvailability(): Promise<boolean>;
  searchProducts(input: MarketSearchInput): Promise<RawMarketReference[]>;
  normalizeResults(raw: unknown): RawMarketReference[];
}

