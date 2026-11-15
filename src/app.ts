import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { sql } from "drizzle-orm";
import { db, sql as pgClient } from "./database/client.js";
import { env, allowedOrigins } from "./config/env.js";
import { authRoutes } from "./modules/auth/routes.js";
import { analysesRoutes } from "./modules/analyses/routes.js";
import { opportunityRoutes } from "./modules/opportunities/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { AppError, safeErrorMessage } from "./shared/errors.js";
import { ZodError } from "zod";

export async function buildApp(options: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? { level: env.NODE_ENV === "production" ? "info" : "debug" }, requestIdHeader: "x-request-id", trustProxy: false });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: allowedOrigins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });
  await app.register(sensible);
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { iss: "radar-back", aud: "radar-mobile" }, verify: { allowedIss: "radar-back", allowedAud: "radar-mobile" } });
  await app.register(swagger, {
    openapi: {
      info: { title: "RADAR API", description: "API para análise de oportunidades de revenda. Preços de mercado representam anúncios ativos, nunca vendas confirmadas.", version: "1.0.0" },
      servers: [{ url: `http://localhost:${env.PORT}` }],
      tags: [{ name: "auth" }, { name: "analyses" }, { name: "opportunities" }, { name: "settings" }, { name: "system" }],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } });
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A requisição contém dados inválidos.", requestId: request.id } });
    if ((error as any).validation) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "A requisição contém dados inválidos.", requestId: request.id } });
    const statusCode = (error as any).statusCode && (error as any).statusCode < 500 ? (error as any).statusCode : 500;
    const code = statusCode === 413 ? "REQUEST_TOO_LARGE" : (error as any).code === "FST_REQ_FILE_TOO_LARGE" ? "IMAGE_TOO_LARGE" : "INTERNAL_ERROR";
    request.log.error({ err: error }, "Request failed");
    return reply.code(statusCode).send({ error: { code, message: statusCode === 500 ? "Ocorreu um erro interno." : safeErrorMessage(error), requestId: request.id } });
  });

  app.get("/health", async (request, reply) => {
    let database = false;
    if (db) {
      try { await db.execute(sql`select 1`); database = true; }
      catch (error) { request.log.warn({ err: error }, "Database health check failed"); }
    }
    const status = database ? "ok" : "degraded";
    if (!database) reply.code(503);
    return { status, checks: { database, geminiConfigured: Boolean(env.GEMINI_API_KEY) }, timestamp: new Date().toISOString() };
  });

  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(analysesRoutes, { prefix: "/api/v1/analyses" });
  await app.register(opportunityRoutes, { prefix: "/api/v1" });
  await app.register(settingsRoutes, { prefix: "/api/v1/settings" });

  app.addHook("onClose", async () => { if (pgClient) await pgClient.end({ timeout: 5 }); });
  return app;
}

