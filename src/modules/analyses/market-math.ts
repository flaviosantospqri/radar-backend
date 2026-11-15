export type MarketSample = { priceCents: number; matchType: "EXATA" | "ALTA" | "PARCIAL" | "INCOMPATIVEL" };

function quantile(sorted: number[], fraction: number) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

export function summarizeMarket(samples: MarketSample[]) {
  const comparable = samples.filter((s) => s.matchType === "EXATA" || s.matchType === "ALTA").map((s) => s.priceCents).sort((a, b) => a - b);
  const partial = samples.filter((s) => s.matchType === "PARCIAL").map((s) => s.priceCents).sort((a, b) => a - b);
  const median = quantile(comparable, 0.5);
  const liquidity = comparable.length >= 15 ? "ALTA" : comparable.length >= 5 ? "MEDIA" : comparable.length >= 3 ? "BAIXA" : "INSUFICIENTE";
  const researchConfidenceBps = comparable.length >= 10 ? 8000 : comparable.length >= 5 ? 7000 : comparable.length >= 3 ? 6000 : comparable.length ? 4000 : 0;
  return {
    comparableCount: comparable.length,
    partialCount: partial.length,
    lowestPriceCents: comparable[0] ?? null,
    q25PriceCents: quantile(comparable, 0.25),
    medianPriceCents: median,
    q75PriceCents: quantile(comparable, 0.75),
    highestPriceCents: comparable.at(-1) ?? null,
    partialMedianPriceCents: quantile(partial, 0.5),
    liquidity,
    researchConfidenceBps,
  };
}

