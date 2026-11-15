import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireDb } from "../../database/client.js";
import { aiUsageLogs, analyses, marketReferences, opportunities, products, profitability, researchLogs } from "../../database/schema.js";
import { identifyProduct } from "../../integrations/gemini/identification.js";
import { mercadoLivreProvider } from "../../integrations/market-providers/mercado-livre.js";
import { authenticate } from "../../shared/auth.js";
import { AppError, safeErrorMessage } from "../../shared/errors.js";
import { parseCents } from "../../shared/money.js";
import { classifyMatch } from "../../shared/matching.js";
import { confirmationSchema, simulateSchema, uuidSchema } from "../../shared/validation.js";
import { cachedResearchExists, evaluateAnalysis, getAnalysisResult, getOwnedAnalysis, persistIdentification } from "./service.js";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, optimizeToTemporaryFile, type UploadedImage } from "./temp-image.js";

async function readUpload(request: FastifyRequest) {
  let image: Buffer | null = null;
  let mimeType: string | null = null;
  let askingPriceCents: number | null = null;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (image) throw new AppError("Envie somente uma imagem por análise.", 400, "TOO_MANY_FILES");
        if (!ALLOWED_IMAGE_MIME_TYPES.has(part.mimetype)) throw new AppError("Formato inválido. Use JPEG, PNG ou WebP.", 415, "INVALID_IMAGE_TYPE");
        image = await part.toBuffer();
        if (image.byteLength > MAX_IMAGE_BYTES) throw new AppError("A imagem excede o limite de 8 MB.", 413, "IMAGE_TOO_LARGE");
        mimeType = part.mimetype;
      } else if (part.fieldname === "askingPriceCents") {
        askingPriceCents = parseCents(part.value, "askingPriceCents");
      }
    }
  } catch (error) {
    image?.fill(0);
    throw error;
  }
  if (!image || !mimeType) throw new AppError("A fotografia do produto é obrigatória.", 400, "IMAGE_REQUIRED");
  return { upload: { buffer: image, mimeType } satisfies UploadedImage, askingPriceCents };
}

async function identifyAndLog(analysisId: string, image: Buffer, mimeType: string) {
  const db = requireDb();
  try {
    const response = await identifyProduct({ image, mimeType });
    const product = await persistIdentification(analysisId, response.data);
    await db.insert(aiUsageLogs).values({
      analysisId, provider: "google_genai", model: response.model, operation: "product_identification",
      inputTokens: response.inputTokens, outputTokens: response.outputTokens, estimatedCostUsd: null, status: "success",
      errorMessage: response.usedCorrection ? "Resposta corrigida em uma segunda chamada por falha de validação inicial." : null,
    });
    return product;
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    await db.insert(aiUsageLogs).values({ analysisId, provider: "google_genai", model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash", operation: "product_identification", status: "failed", errorMessage });
    await db.update(analyses).set({ status: "failed", updatedAt: new Date() }).where(eq(analyses.id, analysisId));
    throw error;
  }
}

export async function analysesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.post("/", async (request, reply) => {
    const db = requireDb();
    const userId = request.auth!.userId;
    const idempotencyKey = request.headers["idempotency-key"];
    const clientRequestId = typeof idempotencyKey === "string" ? idempotencyKey.slice(0, 100) : null;
    if (clientRequestId) {
      const [existing] = await db.select({ id: analyses.id }).from(analyses).where(and(eq(analyses.userId, userId), eq(analyses.clientRequestId, clientRequestId))).limit(1);
      if (existing) return reply.code(200).send({ data: await getAnalysisResult(userId, existing.id), idempotentReplay: true });
    }
    const { upload, askingPriceCents } = await readUpload(request);
    let temporaryImage;
    try { temporaryImage = await optimizeToTemporaryFile(upload); }
    catch (error) { upload.buffer.fill(0); throw error; }
    const id = randomUUID();
    try {
      const [analysis] = await db.insert(analyses).values({ id, userId, clientRequestId, status: "identifying", askingPriceCents }).onConflictDoNothing().returning();
      if (!analysis) {
        const [existing] = clientRequestId ? await db.select({ id: analyses.id }).from(analyses).where(and(eq(analyses.userId, userId), eq(analyses.clientRequestId, clientRequestId))).limit(1) : [];
        if (existing) return reply.code(200).send({ data: await getAnalysisResult(userId, existing.id), idempotentReplay: true });
        throw new AppError("Não foi possível registrar a análise.", 500, "ANALYSIS_CREATE_FAILED");
      }
      let product = null;
      try { product = await identifyAndLog(id, temporaryImage.buffer, temporaryImage.mimeType); }
      catch (error) { request.log.warn({ err: error, analysisId: id }, "Identification failed; temporary image was discarded"); }
      return reply.code(202).send({ data: { ...(await getOwnedAnalysis(userId, id)), product } });
    } finally {
      upload.buffer.fill(0);
      await temporaryImage.dispose();
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
    const refs = await db.select().from(marketReferences).where(eq(marketReferences.analysisId, id)).orderBy(desc(marketReferences.matchConfidenceBps), desc(marketReferences.collectedAt));
    return { data: refs, meta: { pricesAreActiveListings: true, completedSales: false } };
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

  app.post("/:id/identify", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const userId = request.auth!.userId;
    const { analysis, product: existingProduct } = await getOwnedAnalysis(userId, id);
    if (existingProduct && analysis.status === "awaiting_confirmation") return { data: { analysis, product: existingProduct, reused: true } };
    if (analysis.status === "identifying") throw new AppError("A identificação desta análise já está em andamento.", 409, "IDENTIFICATION_IN_PROGRESS");
    const { upload } = await readUpload(request);
    let temporaryImage;
    try { temporaryImage = await optimizeToTemporaryFile(upload); }
    catch (error) { upload.buffer.fill(0); throw error; }
    try {
      await requireDb().update(analyses).set({ status: "identifying", updatedAt: new Date() }).where(eq(analyses.id, id));
      const identified = await identifyAndLog(id, temporaryImage.buffer, temporaryImage.mimeType);
      return { data: { analysis: (await getOwnedAnalysis(userId, id)).analysis, product: identified, reused: false } };
    } finally {
      upload.buffer.fill(0);
      await temporaryImage.dispose();
    }
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

  app.post("/:id/research", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const userId = request.auth!.userId;
    const { analysis, product } = await getOwnedAnalysis(userId, id);
    if (!product?.confirmedByUser) throw new AppError("Confirme os dados do produto antes da pesquisa.", 409, "CONFIRMATION_REQUIRED");
    const db = requireDb();
    if (await cachedResearchExists(id)) return { data: await getAnalysisResult(userId, id), reusedCachedResearch: true };
    const query = [product.brand, product.model, product.version, product.name].filter(Boolean).join(" ").slice(0, 180);
    const startedAt = Date.now();
    await db.update(analyses).set({ status: "researching", updatedAt: new Date() }).where(eq(analyses.id, id));
    try {
      const raw = await mercadoLivreProvider.searchProducts({ query, limit: 50 });
      const classified = raw.map((reference) => {
        const match = classifyMatch(product, reference.title);
        return { ...reference, ...match };
      });
      for (const reference of classified) {
        await db.insert(marketReferences).values({
          analysisId: id, source: reference.source, externalId: reference.externalId, title: reference.title,
          priceCents: reference.priceCents, currency: reference.currency, condition: reference.condition, url: reference.url,
          collectedAt: reference.collectedAt, matchConfidenceBps: reference.confidenceBps, matchType: reference.type,
          isCompatible: reference.compatible, metadata: reference.metadata,
        }).onConflictDoUpdate({
          target: [marketReferences.analysisId, marketReferences.url],
          set: { title: reference.title, priceCents: reference.priceCents, condition: reference.condition, collectedAt: reference.collectedAt, matchConfidenceBps: reference.confidenceBps, matchType: reference.type, isCompatible: reference.compatible, metadata: reference.metadata },
        });
      }
      await db.insert(researchLogs).values({ analysisId: id, provider: mercadoLivreProvider.getProviderName(), status: "success", query, resultCount: classified.length, executionTimeMs: Date.now() - startedAt });
      await evaluateAnalysis(userId, id, { askingPriceCents: analysis.askingPriceCents });
      return { data: await getAnalysisResult(userId, id), reusedCachedResearch: false };
    } catch (error) {
      const message = safeErrorMessage(error);
      await db.insert(researchLogs).values({ analysisId: id, provider: mercadoLivreProvider.getProviderName(), status: "failed", query, resultCount: 0, errorMessage: message, executionTimeMs: Date.now() - startedAt });
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

