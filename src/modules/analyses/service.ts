import { and, desc, eq, gte } from "drizzle-orm";
import { analyses, marketReferences, opportunities, products, profitability, settings, researchLogs } from "../../database/schema.js";
import { requireDb } from "../../database/client.js";
import { AppError } from "../../shared/errors.js";
import { calculateProfitability } from "../../shared/money.js";
import { summarizeMarket } from "./market-math.js";
import { scoreOpportunity } from "./scoring.js";
import type { IdentificationResult } from "../../integrations/gemini/identification.js";

export async function getOwnedAnalysis(userId: string, analysisId: string) {
  const db = requireDb();
  const [analysis] = await db.select().from(analyses).where(and(eq(analyses.id, analysisId), eq(analyses.userId, userId))).limit(1);
  if (!analysis) throw new AppError("Análise não encontrada.", 404, "ANALYSIS_NOT_FOUND");
  const [product] = await db.select().from(products).where(eq(products.analysisId, analysisId)).limit(1);
  return { analysis, product: product ?? null };
}

export async function persistIdentification(analysisId: string, result: IdentificationResult) {
  const db = requireDb();
  const [product] = await db.insert(products).values({
    analysisId,
    name: result.name,
    category: result.category,
    subcategory: result.subcategory,
    brand: result.brand,
    model: result.model,
    version: result.version,
    description: result.description,
    visibleCondition: result.visibleCondition,
    confidenceBps: Math.round(result.confidence * 10_000),
    attributes: result.attributes,
    visibleDefects: result.visibleDefects,
    warnings: result.warnings,
    identifiedInformation: result.identifiedInformation,
    uncertainInformation: result.uncertainInformation,
    verificationQuestions: result.verificationQuestions,
    searchQueries: result.searchQueries,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: products.analysisId,
    set: {
      name: result.name, category: result.category, subcategory: result.subcategory, brand: result.brand,
      model: result.model, version: result.version, description: result.description, visibleCondition: result.visibleCondition,
      confidenceBps: Math.round(result.confidence * 10_000), attributes: result.attributes, visibleDefects: result.visibleDefects,
      warnings: result.warnings, identifiedInformation: result.identifiedInformation, uncertainInformation: result.uncertainInformation,
      verificationQuestions: result.verificationQuestions, searchQueries: result.searchQueries, confirmedByUser: false, updatedAt: new Date(),
    },
  }).returning();
  await db.update(analyses).set({
    productId: product.id,
    identificationConfidenceBps: product.confidenceBps,
    status: "awaiting_confirmation",
    updatedAt: new Date(),
  }).where(eq(analyses.id, analysisId));
  return product;
}

export async function getAnalysisResult(userId: string, analysisId: string) {
  const db = requireDb();
  const { analysis, product } = await getOwnedAnalysis(userId, analysisId);
  const refs = await db.select().from(marketReferences).where(eq(marketReferences.analysisId, analysisId)).orderBy(desc(marketReferences.matchConfidenceBps), desc(marketReferences.collectedAt));
  const [financial] = await db.select().from(profitability).where(eq(profitability.analysisId, analysisId)).limit(1);
  const [lastResearch] = await db.select().from(researchLogs).where(eq(researchLogs.analysisId, analysisId)).orderBy(desc(researchLogs.createdAt)).limit(1);
  const summary = summarizeMarket(refs.map((r: any) => ({ priceCents: r.priceCents, matchType: r.matchType })));
  return { analysis, product, market: { ...summary, collectedAt: refs[0]?.collectedAt ?? null, isActiveListingData: true, representsCompletedSales: false, sourceNames: [...new Set(refs.map((r: any) => r.source))] }, references: refs, profitability: financial ?? null, lastResearch: lastResearch ?? null };
}

export async function evaluateAnalysis(userId: string, analysisId: string, input: {
  askingPriceCents: number | null;
  transportCostCents?: number;
  maintenanceCostCents?: number;
  preparationCostCents?: number;
  additionalCostCents?: number;
  sellingFeeBps?: number;
  scenario?: "conservador" | "provavel" | "otimista";
}) {
  const db = requireDb();
  const { analysis, product } = await getOwnedAnalysis(userId, analysisId);
  const refs = await db.select().from(marketReferences).where(eq(marketReferences.analysisId, analysisId));
  const [userSettings] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
  const market = summarizeMarket(refs.map((r: any) => ({ priceCents: r.priceCents, matchType: r.matchType })));
  const prices: Record<string, number | null> = {
    conservador: market.q25PriceCents,
    provavel: market.medianPriceCents,
    otimista: market.q75PriceCents,
  };
  const scenarios: Record<string, unknown> = {};
  for (const scenarioName of ["conservador", "provavel", "otimista"] as const) {
    const resalePriceCents = prices[scenarioName];
    scenarios[scenarioName] = resalePriceCents === null ? null : {
      basis: `Percentil observado de anúncios ativos compatíveis (${scenarioName})`,
      resalePriceCents,
      ...calculateProfitability({
        purchasePriceCents: input.askingPriceCents,
        resalePriceCents,
        sellingFeeBps: input.sellingFeeBps ?? userSettings?.defaultSellingFeeBps ?? 0,
        transportCostCents: input.transportCostCents ?? userSettings?.defaultTransportCostCents ?? 0,
        maintenanceCostCents: input.maintenanceCostCents ?? 0,
        preparationCostCents: input.preparationCostCents ?? 0,
        additionalCostCents: input.additionalCostCents ?? 0,
        minimumProfitCents: userSettings?.minimumProfitCents ?? 0,
        minimumRoiBps: userSettings?.minimumRoiBps ?? 2000,
      }),
    };
  }
  const selectedScenario = input.scenario ?? userSettings?.preferredScenario ?? "provavel";
  const selected = scenarios[selectedScenario] as null | Record<string, any>;
  const recommendationResult = scoreOpportunity({
    askingPriceCents: input.askingPriceCents,
    estimatedProfitCents: selected?.estimatedProfitCents ?? null,
    roiBps: selected?.roiBps ?? null,
    maximumPurchasePriceCents: selected?.maximumPurchasePriceCents ?? null,
    minimumProfitCents: userSettings?.minimumProfitCents ?? 0,
    minimumRoiBps: userSettings?.minimumRoiBps ?? 2000,
    identificationConfidenceBps: product?.confidenceBps ?? null,
    comparableCount: market.comparableCount,
    liquidity: market.liquidity as "ALTA" | "MEDIA" | "BAIXA" | "INSUFICIENTE",
    functionalCondition: product?.functionalCondition ?? null,
  });
  const resalePriceCents = selected?.resalePriceCents ?? null;
  await db.insert(profitability).values({
    analysisId,
    purchasePriceCents: input.askingPriceCents,
    resalePriceCents,
    sellingFeeBps: input.sellingFeeBps ?? userSettings?.defaultSellingFeeBps ?? 0,
    sellingFeesCents: selected?.sellingFeesCents ?? 0,
    transportCostCents: input.transportCostCents ?? userSettings?.defaultTransportCostCents ?? 0,
    maintenanceCostCents: input.maintenanceCostCents ?? 0,
    preparationCostCents: input.preparationCostCents ?? 0,
    additionalCostCents: input.additionalCostCents ?? 0,
    totalCostCents: selected?.totalCostCents ?? null,
    estimatedProfitCents: selected?.estimatedProfitCents ?? null,
    roiBps: selected?.roiBps ?? null,
    marginBps: selected?.marginBps ?? null,
    maximumPurchasePriceCents: selected?.maximumPurchasePriceCents ?? null,
    scenarios,
    updatedAt: new Date(),
  }).onConflictDoUpdate({ target: profitability.analysisId, set: {
    purchasePriceCents: input.askingPriceCents, resalePriceCents, sellingFeeBps: input.sellingFeeBps ?? userSettings?.defaultSellingFeeBps ?? 0,
    sellingFeesCents: selected?.sellingFeesCents ?? 0, transportCostCents: input.transportCostCents ?? userSettings?.defaultTransportCostCents ?? 0,
    maintenanceCostCents: input.maintenanceCostCents ?? 0, preparationCostCents: input.preparationCostCents ?? 0,
    additionalCostCents: input.additionalCostCents ?? 0, totalCostCents: selected?.totalCostCents ?? null,
    estimatedProfitCents: selected?.estimatedProfitCents ?? null, roiBps: selected?.roiBps ?? null,
    marginBps: selected?.marginBps ?? null, maximumPurchasePriceCents: selected?.maximumPurchasePriceCents ?? null,
    scenarios, updatedAt: new Date(),
  } });
  await db.update(analyses).set({
    askingPriceCents: input.askingPriceCents,
    recommendation: recommendationResult.recommendation,
    recommendationReasons: recommendationResult.reasons,
    researchConfidenceBps: market.researchConfidenceBps,
    liquidityLevel: market.liquidity as "ALTA" | "MEDIA" | "BAIXA" | "INSUFICIENTE",
    status: market.comparableCount ? "completed" : analysis.status === "researching" ? "partial" : analysis.status,
    completedAt: market.comparableCount ? new Date() : analysis.completedAt,
    updatedAt: new Date(),
  }).where(and(eq(analyses.id, analysisId), eq(analyses.userId, userId)));
  return { market, scenarios, selectedScenario, selected, recommendation: recommendationResult };
}

export async function cachedResearchExists(analysisId: string) {
  const db = requireDb();
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const [recent] = await db.select({ id: researchLogs.id }).from(researchLogs).where(and(eq(researchLogs.analysisId, analysisId), eq(researchLogs.status, "success"), gte(researchLogs.createdAt, cutoff))).limit(1);
  return Boolean(recent);
}

export async function requireOwnedOpportunity(userId: string, opportunityId: string) {
  const db = requireDb();
  const [row] = await db.select().from(opportunities).where(and(eq(opportunities.id, opportunityId), eq(opportunities.userId, userId))).limit(1);
  if (!row) throw new AppError("Oportunidade não encontrada.", 404, "OPPORTUNITY_NOT_FOUND");
  return row;
}

