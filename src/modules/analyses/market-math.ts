export type MarketSample = { priceCents: number; matchType: "EXATA" | "ALTA" | "PARCIAL" | "INCOMPATIVEL" };
export type MarketEstimate = {
  lowPriceCents: number;
  averagePriceCents: number;
  highPriceCents: number;
  confidenceBps: number;
  note: string;
  sources: Array<{ title: string; url: string }>;
};

function quantile(sorted: number[], fraction: number) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

export function summarizeMarket(samples: MarketSample[], estimate: MarketEstimate | null = null) {
  const comparable = samples.filter((s) => s.matchType === "EXATA" || s.matchType === "ALTA").map((s) => s.priceCents).sort((a, b) => a - b);
  const partial = samples.filter((s) => s.matchType === "PARCIAL").map((s) => s.priceCents).sort((a, b) => a - b);
  const median = quantile(comparable, 0.5);
  const estimatePrices = comparable.length ? [] : partial;
  const average = comparable.length
    ? Math.round(comparable.reduce((sum, price) => sum + price / comparable.length, 0))
    : estimatePrices.length
      ? Math.round(estimatePrices.reduce((sum, price) => sum + price / estimatePrices.length, 0))
      : estimate?.averagePriceCents ?? null;
  const liquidity = comparable.length >= 15 ? "ALTA" : comparable.length >= 5 ? "MEDIA" : comparable.length >= 3 ? "BAIXA" : "INSUFICIENTE";
  const priceBasis = comparable.length ? "active_listings" : partial.length ? "similar_listings" : estimate ? "grounded_estimate" : "none";
  const researchConfidenceBps = comparable.length >= 10 ? 8000 : comparable.length >= 5 ? 7000 : comparable.length >= 3 ? 6000 : comparable.length ? 4000
    : partial.length >= 5 ? 4000 : partial.length ? 3000 : estimate?.confidenceBps ?? 0;
  return {
    comparableCount: comparable.length,
    partialCount: partial.length,
    averagePriceCents: average,
    lowestPriceCents: comparable[0] ?? partial[0] ?? estimate?.lowPriceCents ?? null,
    q25PriceCents: comparable.length ? quantile(comparable, 0.25) : partial.length ? quantile(partial, 0.25) : estimate?.lowPriceCents ?? null,
    medianPriceCents: median ?? (partial.length ? quantile(partial, 0.5) : estimate?.averagePriceCents ?? null),
    q75PriceCents: comparable.length ? quantile(comparable, 0.75) : partial.length ? quantile(partial, 0.75) : estimate?.highPriceCents ?? null,
    highestPriceCents: comparable.at(-1) ?? partial.at(-1) ?? estimate?.highPriceCents ?? null,
    partialMedianPriceCents: quantile(partial, 0.5),
    liquidity,
    researchConfidenceBps,
    priceBasis,
    estimateNote: priceBasis === "grounded_estimate" ? estimate?.note ?? null : null,
    estimateSources: priceBasis === "grounded_estimate" ? estimate?.sources ?? [] : [],
  };
}

