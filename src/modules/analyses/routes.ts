import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireDb } from "../../database/client.js";
import { aiUsageLogs, analyses, marketReferences, opportunities, products, profitability, researchLogs } from "../../database/schema.js";
import { createGeminiLiveSession } from "../../integrations/gemini/live-session.js";
import { searchGroundedMarketPrices } from "../../integrations/market-providers/gemini-grounded-search.js";
import { mercadoLivreProvider } from "../../integrations/market-providers/mercado-livre.js";
import { authenticate } from "../../shared/auth.js";
import { AppError, safeErrorMessage } from "../../shared/errors.js";
import { classifyMatch } from "../../shared/matching.js";
import { confirmationSchema, identificationSchema, simulateSchema, uuidSchema } from "../../shared/validation.js";
import { cachedResearchExists, evaluateAnalysis, getAnalysisResult, getOwnedAnalysis, persistIdentification } from "./service.js";

export async function analysesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.post("/live-session", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async () => {
    const session = await createGeminiLiveSession();
    return { data: session };
  });

  app.post("/live-result", async (request, reply) => {
    const db = requireDb();
    const userId = request.auth!.userId;
    const body = request.body as { identification?: unknown };
    const identification = identificationSchema.parse(body?.identification);
    const idempotencyKey = request.headers["idempotency-key"];
    const clientRequestId = typeof idempotencyKey === "string" ? idempotencyKey.slice(0, 100) : null;
    if (clientRequestId) {
      const [existing] = await db.select({ id: analyses.id }).from(analyses)
        .where(and(eq(analyses.userId, userId), eq(analyses.clientRequestId, clientRequestId))).limit(1);
      if (existing) return reply.code(200).send({ data: await getAnalysisResult(userId, existing.id), idempotentReplay: true });
    }
    const id = randomUUID();
    const [analysis] = await db.insert(analyses).values({ id, userId, clientRequestId, status: "identifying" }).onConflictDoNothing().returning();
    if (!analysis) throw new AppError("Não foi possível registrar a análise.", 500, "ANALYSIS_CREATE_FAILED");
    try {
      const product = await persistIdentification(id, identification);
      await db.insert(aiUsageLogs).values({
        analysisId: id, provider: "google_genai", model: process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live",
        operation: "live_product_identification", status: "success", errorMessage: null,
      }).catch((error) => request.log.warn({ err: error, analysisId: id }, "Could not record the client-side Gemini usage event"));
      return reply.code(202).send({ data: { ...(await getOwnedAnalysis(userId, id)), product } });
    } catch (error) {
      await db.update(analyses).set({ status: "failed", updatedAt: new Date() }).where(eq(analyses.id, id));
      throw error;
    }
  });

  app.get("/", async (request) => {
    const query = request.query as { page?: string; limit?: string };
    const page = Math.max(1, Math.min(Number(query.page) || 1, 100000));
    const limit = Math.max(1, Math.min(Number(query.limit) || 20, 50));
    const offset = (page - 1) * limit;
    const db = requireDb();
    const userId = request.auth!.userId;
    const rows = await db.select({ analysis: analyses, product: products, profitability }).from(analyses)
      .leftJoin(products, eq(products.analysisId, analyses.id)).leftJoin(profitability, eq(profitability.analysisId, analyses.id))
      .where(eq(analyses.userId, userId)).orderBy(desc(analyses.createdAt)).limit(limit).offset(offset);
    const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(analyses).where(eq(analyses.userId, userId));
    return { data: rows, pagination: { page, limit, total: totalRow?.count ?? 0, pages: Math.ceil((totalRow?.count ?? 0) / limit) } };
  });

  app.get("/:id", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    return { data: await getAnalysisResult(request.auth!.userId, id) };
  });

  app.get("/:id/result", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    return { data: await getAnalysisResult(request.auth!.userId, id) };
  });

  app.get("/:id/references", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    await getOwnedAnalysis(request.auth!.userId, id);
    const db = requireDb();
    const storedRefs = await db.select().from(marketReferences).where(eq(marketReferences.analysisId, id)).orderBy(desc(marketReferences.matchConfidenceBps), desc(marketReferences.collectedAt));
    const refs = storedRefs.filter((reference) => reference.metadata.kind !== "grounded_market_estimate");
    return {
      data: refs,
      meta: {
        pricesAreActiveListings: refs.length > 0 && refs.every((reference) => reference.source === "mercado_livre"),
        containsGroundedWebResults: refs.some((reference) => reference.source === "google_search_grounding"),
        completedSales: false,
      },
    };
  });

  app.patch("/:id", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const input = simulateSchema.parse(request.body);
    const userId = request.auth!.userId;
    await getOwnedAnalysis(userId, id);
    const evaluation = await evaluateAnalysis(userId, id, input);
    return { data: await getAnalysisResult(userId, id), evaluation };
  });

  app.delete("/:id", async (request, reply) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const userId = request.auth!.userId;
    await getOwnedAnalysis(userId, id);
    await requireDb().delete(analyses).where(and(eq(analyses.id, id), eq(analyses.userId, userId)));
    return reply.code(204).send();
  });

  app.post("/:id/confirm-identification", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const userId = request.auth!.userId;
    const { analysis, product } = await getOwnedAnalysis(userId, id);
    if (!product) throw new AppError("Identifique o produto antes de confirmá-lo.", 409, "PRODUCT_NOT_IDENTIFIED");
    const input = confirmationSchema.parse(request.body);
    const attributes = { ...(product.attributes ?? {}), ...(input.attributes ?? {}), ...(input.accessories ? { accessories: input.accessories } : {}) };
    const db = requireDb();
    const [updatedProduct] = await db.update(products).set({
      name: input.name, category: input.category ?? product.category, subcategory: input.subcategory ?? product.subcategory,
      brand: input.brand ?? product.brand, model: input.model ?? product.model, version: input.version ?? product.version,
      description: input.description ?? product.description, attributes, visibleCondition: input.visibleCondition ?? product.visibleCondition,
      functionalCondition: input.functionalCondition ?? product.functionalCondition, confirmedByUser: true, updatedAt: new Date(),
    }).where(eq(products.analysisId, id)).returning();
    await db.update(analyses).set({ status: "awaiting_confirmation", updatedAt: new Date() }).where(eq(analyses.id, id));
    return { data: { analysis, product: updatedProduct, researchMustStartAfterConfirmation: true } };
  });

  app.post("/:id/research", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const userId = request.auth!.userId;
    const { analysis, product } = await getOwnedAnalysis(userId, id);
    if (!product) throw new AppError("Identifique o produto antes da pesquisa.", 409, "PRODUCT_NOT_IDENTIFIED");
    const forceRefresh = (request.body as { force?: unknown } | null)?.force === true;
    const db = requireDb();
    if (!forceRefresh && await cachedResearchExists(id)) return { data: await getAnalysisResult(userId, id), reusedCachedResearch: true };
    const query = [product.name, product.brand, product.model, product.version].filter((value): value is string => Boolean(value?.trim())).join(" ").slice(0, 180)
      || product.searchQueries.find((value) => value.trim())?.slice(0, 180)
      || "produto usado Brasil";
    const startedAt = Date.now();
    await db.update(analyses).set({ status: "researching", updatedAt: new Date() }).where(eq(analyses.id, id));
    let researchProvider = mercadoLivreProvider.getProviderName();
    try {
      const classify = (references: Awaited<ReturnType<typeof mercadoLivreProvider.searchProducts>>) => references.map((reference) => {
        const match = classifyMatch(product, reference.title);
        return { ...reference, ...match };
      }).filter((reference) => reference.type !== "INCOMPATIVEL");
      let classified: ReturnType<typeof classify> = [];
      let groundedEstimate: Awaited<ReturnType<typeof searchGroundedMarketPrices>>["estimate"] = null;
      let mercadoLivreFailed = false;
      try {
        classified = classify(await mercadoLivreProvider.searchProducts({ query, limit: 50 }));
      } catch (error) {
        mercadoLivreFailed = true;
        await db.insert(researchLogs).values({
          analysisId: id, provider: mercadoLivreProvider.getProviderName(), status: "failed", query,
          resultCount: 0, errorMessage: safeErrorMessage(error), executionTimeMs: Date.now() - startedAt,
        });
        request.log.warn({ err: error, analysisId: id }, "Mercado Livre search was unavailable; trying Gemini grounded search");
      }

      if (mercadoLivreFailed || !classified.some((reference) => reference.compatible)) {
        researchProvider = mercadoLivreFailed ? "gemini_google_search" : "mercado_livre+gemini_google_search";
        try {
          const grounded = await searchGroundedMarketPrices({
            name: product.name,
            brand: product.brand,
            model: product.model,
            version: product.version,
            category: product.category,
            condition: product.visibleCondition,
            searchQueries: product.searchQueries,
          });
          const groundedReferences = classify(grounded.references);
          if (groundedReferences.length) {
            const byUrl = new Map([...classified, ...groundedReferences].map((reference) => [reference.url, reference]));
            classified = [...byUrl.values()];
          }
          if (!classified.length) groundedEstimate = grounded.estimate;
        } catch (error) {
          if (!classified.length) throw error;
          request.log.warn({ err: error, analysisId: id }, "Gemini grounded search failed; retaining similar Mercado Livre prices");
        }
      }
      if (!classified.length && !groundedEstimate) {
        throw new AppError("Não encontramos preços verificáveis para esse produto. Tente novamente ou ajuste a identificação.", 502, "MARKET_PRICES_NOT_FOUND");
      }
      await db.transaction(async (tx) => {
        if (forceRefresh) await tx.delete(marketReferences).where(eq(marketReferences.analysisId, id));
        else await tx.delete(marketReferences).where(and(eq(marketReferences.analysisId, id), eq(marketReferences.source, "gemini_grounded_estimate")));
        for (const reference of classified) {
          await tx.insert(marketReferences).values({
            analysisId: id, source: reference.source, externalId: reference.externalId, title: reference.title,
            priceCents: reference.priceCents, currency: reference.currency, condition: reference.condition, url: reference.url,
            collectedAt: reference.collectedAt, matchConfidenceBps: reference.confidenceBps, matchType: reference.type,
            isCompatible: reference.compatible, metadata: reference.metadata,
          }).onConflictDoUpdate({
            target: [marketReferences.analysisId, marketReferences.url],
            set: { title: reference.title, priceCents: reference.priceCents, condition: reference.condition, collectedAt: reference.collectedAt, matchConfidenceBps: reference.confidenceBps, matchType: reference.type, isCompatible: reference.compatible, metadata: reference.metadata },
          });
        }
        if (groundedEstimate) {
          const estimateUrl = new URL("https://www.google.com/search");
          estimateUrl.searchParams.set("q", query);
          await tx.insert(marketReferences).values({
            analysisId: id,
            source: "gemini_grounded_estimate",
            externalId: null,
            title: "Estimativa indicativa de revenda baseada em pesquisa na web",
            priceCents: groundedEstimate.averagePriceCents,
            currency: "BRL",
            condition: null,
            url: estimateUrl.toString(),
            collectedAt: new Date(),
            matchConfidenceBps: groundedEstimate.confidenceBps,
            matchType: "PARCIAL",
            isCompatible: false,
            metadata: {
              kind: "grounded_market_estimate",
              lowPriceCents: groundedEstimate.lowPriceCents,
              averagePriceCents: groundedEstimate.averagePriceCents,
              highPriceCents: groundedEstimate.highPriceCents,
              confidenceBps: groundedEstimate.confidenceBps,
              note: groundedEstimate.note,
              sources: groundedEstimate.sources,
            },
          }).onConflictDoUpdate({
            target: [marketReferences.analysisId, marketReferences.url],
            set: {
              priceCents: groundedEstimate.averagePriceCents,
              collectedAt: new Date(),
              matchConfidenceBps: groundedEstimate.confidenceBps,
              metadata: {
                kind: "grounded_market_estimate",
                lowPriceCents: groundedEstimate.lowPriceCents,
                averagePriceCents: groundedEstimate.averagePriceCents,
                highPriceCents: groundedEstimate.highPriceCents,
                confidenceBps: groundedEstimate.confidenceBps,
                note: groundedEstimate.note,
                sources: groundedEstimate.sources,
              },
            },
          });
        }
      });
      await db.insert(researchLogs).values({ analysisId: id, provider: researchProvider, status: "success", query, resultCount: classified.length + (groundedEstimate ? 1 : 0), executionTimeMs: Date.now() - startedAt });
      await evaluateAnalysis(userId, id, { askingPriceCents: analysis.askingPriceCents });
      return { data: await getAnalysisResult(userId, id), reusedCachedResearch: false };
    } catch (error) {
      const message = safeErrorMessage(error);
      await db.insert(researchLogs).values({ analysisId: id, provider: researchProvider, status: "failed", query, resultCount: 0, errorMessage: message, executionTimeMs: Date.now() - startedAt });
      await db.update(analyses).set({ status: "partial", updatedAt: new Date() }).where(eq(analyses.id, id));
      request.log.warn({ err: error, analysisId: id }, "Market research failed; identification is retained");
      return { data: await getAnalysisResult(userId, id), partial: true, error: "A pesquisa de mercado falhou; a identificação foi preservada." };
    }
  });

  app.post("/:id/recalculate", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const input = simulateSchema.parse(request.body);
    const userId = request.auth!.userId;
    await getOwnedAnalysis(userId, id);
    const evaluation = await evaluateAnalysis(userId, id, input);
    return { data: await getAnalysisResult(userId, id), evaluation, aiCalls: 0, marketSearches: 0 };
  });
}

