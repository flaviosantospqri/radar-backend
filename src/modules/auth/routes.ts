import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireDb } from "../../database/client.js";
import { sessions, settings, users } from "../../database/schema.js";
import { AppError } from "../../shared/errors.js";
import { hashToken, authenticate } from "../../shared/auth.js";
import { z } from "zod";

const registerSchema = z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(320), password: z.string().min(8).max(128) });
const loginSchema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(128) });

async function createSession(app: FastifyInstance, userId: string) {
  const db = requireDb();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = app.jwt.sign({ sub: userId, sid: id }, { expiresIn: "7d" });
  await db.insert(sessions).values({ id, userId, tokenHash: hashToken(token), expiresAt });
  return token;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const db = requireDb();
    const email = input.email.toLowerCase();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new AppError("Este e-mail já está cadastrado.", 409, "EMAIL_EXISTS");
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const [user] = await db.insert(users).values({ name: input.name, email, passwordHash }).returning({ id: users.id, name: users.name, email: users.email });
    await db.insert(settings).values({ userId: user.id });
    const token = await createSession(app, user.id);
    return reply.code(201).send({ data: { token, user } });
  });

  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const input = loginSchema.parse(request.body);
    const db = requireDb();
    const [user] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
    if (!user || !(await argon2.verify(user.passwordHash, input.password))) throw new AppError("E-mail ou senha inválidos.", 401, "INVALID_CREDENTIALS");
    const token = await createSession(app, user.id);
    return { data: { token, user: { id: user.id, name: user.name, email: user.email } } };
  });

  app.post("/logout", { preHandler: authenticate }, async (request, reply) => {
    const db = requireDb();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: authenticate }, async (request) => {
    const db = requireDb();
    const [user] = await db.select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt }).from(users).where(eq(users.id, request.auth!.userId)).limit(1);
    if (!user) throw new AppError("Usuário não encontrado.", 404, "USER_NOT_FOUND");
    return { data: user };
  });
}

