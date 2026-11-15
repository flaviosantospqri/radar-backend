import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireDb } from "../../database/client.js";
import { analyses, opportunities, products, profitability } from "../../database/schema.js";
import { authenticate } from "../../shared/auth.js";
import { AppError } from "../../shared/errors.js";
import { centsSchema, uuidSchema } from "../../shared/validation.js";
import { getOwnedAnalysis, requireOwnedOpportunity } from "../analyses/service.js";

const statusSchema = z.enum(["ANALISADO", "FAVORITO", "DESCARTADO"]);
const purchaseSchema = z.object({
  actualPurchasePriceCents: centsSchema,
  actualTransportCostCents: centsSchema.default(0),
  actualMaintenanceCostCents: centsSchema.default(0),
  actualPreparationCostCents: centsSchema.default(0),
  actualAdditionalCostsCents: centsSchema.default(0),
  purchasedAt: z.coerce.date().optional(),
});
const saleSchema = z.object({
  actualSalePriceCents: centsSchema,
  actualSellingFeesCents: centsSchema.default(0),
  actualAdditionalCostsCents: centsSchema.default(0),
  soldAt: z.coerce.date().optional(),
});

export async function opportunityRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/opportunities", async (request) => {
    const query = request.query as { page?: string; limit?: string; status?: string };
    const page = Math.max(1, Math.min(Number(query.page) || 1, 100000));
    const limit = Math.max(1, Math.min(Number(query.limit) || 20, 50));
    const userId = request.auth!.userId;
    const db = requireDb();
    const where = query.status && ["ANALISADO", "FAVORITO", "COMPRADO", "VENDIDO", "DESCARTADO"].includes(query.status)
      ? and(eq(opportunities.userId, userId), eq(opportunities.status, query.status as any))
      : eq(opportunities.userId, userId);
    const rows = await db.select({ opportunity: opportunities, analysis: analyses, product: products, profitability })
      .from(opportunities).innerJoin(analyses, eq(analyses.id, opportunities.analysisId))
      .leftJoin(products, eq(products.analysisId, analyses.id)).leftJoin(profitability, eq(profitability.analysisId, analyses.id))
      .where(where).orderBy(desc(opportunities.updatedAt)).limit(limit).offset((page - 1) * limit);
    const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(opportunities).where(eq(opportunities.userId, userId));
    return { data: rows, pagination: { page, limit, total: totalRow?.count ?? 0, pages: Math.ceil((totalRow?.count ?? 0) / limit) } };
  });

  app.post("/analyses/:analysisId/opportunity", async (request, reply) => {
    const analysisId = uuidSchema.parse((request.params as { analysisId: string }).analysisId);
    const userId = request.auth!.userId;
    await getOwnedAnalysis(userId, analysisId);
    const db = requireDb();
    const [row] = await db.insert(opportunities).values({ analysisId, userId }).onConflictDoNothing().returning();
    if (row) return reply.code(201).send({ data: row });
    const [existing] = await db.select().from(opportunities).where(and(eq(opportunities.analysisId, analysisId), eq(opportunities.userId, userId))).limit(1);
    return { data: existing, reusedExisting: true };
  });

  app.patch("/opportunities/:id", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const status = statusSchema.parse((request.body as { status?: unknown })?.status);
    await requireOwnedOpportunity(request.auth!.userId, id);
    const [row] = await requireDb().update(opportunities).set({ status, updatedAt: new Date() }).where(eq(opportunities.id, id)).returning();
    return { data: row };
  });

  app.post("/opportunities/:id/purchase", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const input = purchaseSchema.parse(request.body);
    const current = await requireOwnedOpportunity(request.auth!.userId, id);
    if (current.status === "VENDIDO") throw new AppError("Uma oportunidade vendida não pode receber outra compra.", 409, "INVALID_OPPORTUNITY_STATE");
    const [row] = await requireDb().update(opportunities).set({
      ...input, status: "COMPRADO", purchasedAt: input.purchasedAt ?? new Date(), updatedAt: new Date(),
      actualSalePriceCents: null, actualSellingFeesCents: null, soldAt: null, realizedProfitCents: null, realizedRoiBps: null,
    }).where(eq(opportunities.id, id)).returning();
    return { data: row };
  });

  app.post("/opportunities/:id/sale", async (request) => {
    const id = uuidSchema.parse((request.params as { id: string }).id);
    const input = saleSchema.parse(request.body);
    const current = await requireOwnedOpportunity(request.auth!.userId, id);
    if (current.status !== "COMPRADO" || current.actualPurchasePriceCents === null) throw new AppError("Registre a compra antes da venda.", 409, "PURCHASE_REQUIRED");
    const totalCost = current.actualPurchasePriceCents + (current.actualTransportCostCents ?? 0) + (current.actualMaintenanceCostCents ?? 0) + (current.actualPreparationCostCents ?? 0) + (current.actualAdditionalCostsCents ?? 0) + input.actualAdditionalCostsCents;
    const profit = input.actualSalePriceCents - totalCost - input.actualSellingFeesCents;
    const roiBps = totalCost > 0 ? Math.round(profit * 10_000 / totalCost) : null;
    const [row] = await requireDb().update(opportunities).set({
      actualSalePriceCents: input.actualSalePriceCents,
      actualSellingFeesCents: input.actualSellingFeesCents,
      actualAdditionalCostsCents: (current.actualAdditionalCostsCents ?? 0) + input.actualAdditionalCostsCents,
      realizedProfitCents: profit, realizedRoiBps: roiBps, status: "VENDIDO",
      soldAt: input.soldAt ?? new Date(), updatedAt: new Date(),
    }).where(eq(opportunities.id, id)).returning();
    return { data: row, comparison: {
      predictedProfitCents: (await requireDb().select({ estimatedProfitCents: profitability.estimatedProfitCents }).from(profitability).where(eq(profitability.analysisId, current.analysisId)).limit(1))[0]?.estimatedProfitCents ?? null,
      realizedProfitCents: profit,
      varianceCents: profit - ((await requireDb().select({ estimatedProfitCents: profitability.estimatedProfitCents }).from(profitability).where(eq(profitability.analysisId, current.analysisId)).limit(1))[0]?.estimatedProfitCents ?? profit),
    } };
  });
}

