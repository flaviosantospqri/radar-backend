import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireDb } from "../../database/client.js";
import { settings } from "../../database/schema.js";
import { authenticate } from "../../shared/auth.js";
import { settingsSchema } from "../../shared/validation.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.get("/", async (request) => {
    const db = requireDb();
    const [row] = await db.select().from(settings).where(eq(settings.userId, request.auth!.userId)).limit(1);
    if (row) return { data: row };
    const [created] = await db.insert(settings).values({ userId: request.auth!.userId }).returning();
    return { data: created };
  });
  app.put("/", async (request) => {
    const input = settingsSchema.parse(request.body);
    const db = requireDb();
    const [row] = await db.insert(settings).values({ userId: request.auth!.userId, ...input }).onConflictDoUpdate({
      target: settings.userId,
      set: { ...input, updatedAt: new Date() },
    }).returning();
    return { data: row };
  });
}

