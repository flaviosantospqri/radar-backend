import { and, desc, eq, gte } from "drizzle-orm";
import { analyses, marketReferences, opportunities, products, profitability, settings, researchLogs } from "../../database/schema.js";
import { requireDb } from "../../database/client.js";
import { AppError } from "../../shared/errors.js";
import { calculateProfitability } from "../../shared/money.js";
import { summarizeMarket, type MarketEstimate } from "./market-math.js";
import { scoreOpportunity } from "./scoring.js";
import type { IdentificationResult } from "../../shared/validation.js";

const isEstimateReference = (metadata: Record<string, unknown>) => metadata.kind === "grounded_market_estimate";

function readEstimateReference(row: { priceCents: number; metadata?: Record<string, unknown> } | undefined): MarketEstimate | null {
  if (!row?.metadata || !isEstimateReference(row.metadata)) return null;
  const metadata = row.metadata;
  const lowPriceCents = metadata.lowPriceCents;
  const averagePriceCents = metadata.averagePriceCents;
  const highPriceCents = metadata.highPriceCents;
  const confidenceBps = metadata.confidenceBps;
  const note = metadata.note;
  const sources = metadata.sources;
  if (![lowPriceCents, averagePriceCents, highPriceCents, confidenceBps].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return {
    lowPriceCents: lowPriceCents as number,
    averagePriceCents: averagePriceCents as number,
    highPriceCents: highPriceCents as number,
    confidenceBps: confidenceBps as number,
    note: typeof note === "string" ? note : "Estimativa indicativa baseada em fontes públicas da web.",
    sources: Array.isArray(sources) ? sources.flatMap((source) => {
      if (!source || typeof source !== "object") return [];
      const value = source as Record<string, unknown>;
      return typeof value.title === "string" && typeof value.url === "string" ? [{ title: value.title, url: value.url }] : [];
    }) : [],
  };
}

function summarizeReferences(rows: Array<{ priceCents: number; matchType: "EXATA" | "ALTA" | "PARCIAL" | "INCOMPATIVEL"; metadata?: Record<string, unknown> }>) {
  const estimateRow = rows.find((row) => row.metadata && isEstimateReference(row.metadata));
  const pricedRows = rows.filter((row) => !row.metadata || !isEstimateReference(row.metadata));
  return summarizeMarket(pricedRows.map(({ priceCents, matchType }) => ({ priceCents, matchType })), readEstimateReference(estimateRow));
}

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
  const allRefs = await db.select().from(marketReferences).where(eq(marketReferences.analysisId, analysisId)).orderBy(desc(marketReferences.matchConfidenceBps), desc(marketReferences.collectedAt));
  const refs = allRefs.filter((r) => !isEstimateReference(r.metadata));
  const [financial] = await db.select().from(profitability).where(eq(profitability.analysisId, analysisId)).limit(1);
  const [lastResearch] = await db.select().from(researchLogs).where(eq(researchLogs.analysisId, analysisId)).orderBy(desc(researchLogs.createdAt)).limit(1);
  const summary = summarizeReferences(allRefs);
  return {
    analysis,
    product,
    market: {
      ...summary,
      collectedAt: allRefs[0]?.collectedAt ?? null,
      isActiveListingData: refs.length > 0 && refs.every((r) => r.metadata.activeListing === true),
      representsCompletedSales: false,
      sourceNames: [...new Set(allRefs.map((r: any) => r.source))],
    },
    references: refs,
    profitability: financial ?? null,
    lastResearch: lastResearch ?? null,
  };
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
  const market = summarizeReferences(refs);
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
  const recommendationResult = input.askingPriceCents === null
    ? { recommendation: null, reasons: [] as string[] }
    : scoreOpportunity({
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
    status: market.averagePriceCents !== null ? "completed" : analysis.status === "researching" ? "partial" : analysis.status,
    completedAt: market.averagePriceCents !== null ? new Date() : analysis.completedAt,
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

