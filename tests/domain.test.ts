import { describe, expect, it } from "vitest";
import { calculateProfitability, parseCents } from "../src/shared/money.js";
import { classifyMatch } from "../src/shared/matching.js";
import { summarizeMarket } from "../src/modules/analyses/market-math.js";
import { scoreOpportunity } from "../src/modules/analyses/scoring.js";

describe("RADAR domain calculations", () => {
  it("parses currency into integer cents without floating point drift", () => {
    expect(parseCents("1234.56")).toBe(123456);
    expect(parseCents("0.1")).toBe(10);
    expect(() => parseCents("1.234")).toThrow();
  });

  it("calculates net profit, ROI and maximum purchase price from costs", () => {
    expect(calculateProfitability({
      purchasePriceCents: 100_000, resalePriceCents: 180_000, sellingFeeBps: 1000,
      transportCostCents: 5000, maintenanceCostCents: 3000, preparationCostCents: 1000,
      additionalCostCents: 1000, minimumProfitCents: 20_000, minimumRoiBps: 2500,
    })).toMatchObject({
      sellingFeesCents: 18_000, totalCostCents: 110_000, estimatedProfitCents: 52_000,
      roiBps: 4727, marginBps: 2889, maximumPurchasePriceCents: 121_600,
    });
  });

  it("separates exact, partial and incompatible market references", () => {
    const product = { name: "Câmera digital", brand: "Canon", model: "EOS R50" };
    expect(classifyMatch(product, "Câmera Canon EOS R50 Kit").type).toBe("EXATA");
    expect(classifyMatch(product, "Câmera Canon usada").type).toBe("PARCIAL");
    expect(classifyMatch(product, "Lente Nikon 50mm").type).toBe("INCOMPATIVEL");
  });

  it("computes comparable price quantiles while keeping partials separate", () => {
    const summary = summarizeMarket([
      { priceCents: 10_000, matchType: "EXATA" }, { priceCents: 20_000, matchType: "ALTA" },
      { priceCents: 30_000, matchType: "EXATA" }, { priceCents: 40_000, matchType: "ALTA" },
      { priceCents: 99_000, matchType: "PARCIAL" },
    ]);
    expect(summary).toMatchObject({ comparableCount: 4, partialCount: 1, lowestPriceCents: 10_000, medianPriceCents: 25_000, highestPriceCents: 40_000, partialMedianPriceCents: 99_000 });
  });

  it("avoids a definitive buy recommendation with fewer than three comparable listings", () => {
    expect(scoreOpportunity({
      askingPriceCents: 10_000, estimatedProfitCents: 5000, roiBps: 5000, maximumPurchasePriceCents: 12_000,
      minimumProfitCents: 1000, minimumRoiBps: 2000, identificationConfidenceBps: 9000,
      comparableCount: 2, liquidity: "INSUFICIENTE", functionalCondition: "funcionando",
    })).toMatchObject({ recommendation: "INVESTIGAR" });
  });
});
