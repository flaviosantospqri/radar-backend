import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import { requireDb } from "../database/client.js";
import { sessions } from "../database/schema.js";
import { AppError } from "./errors.js";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError("Token inválido ou expirado.", 401, "UNAUTHORIZED");
  }
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const userId = request.user?.sub;
  if (!token || !userId || !request.user.sid) throw new AppError("Sessão inválida.", 401, "UNAUTHORIZED");
  const db = requireDb();
  const [session] = await db.select({ id: sessions.id }).from(sessions).where(and(
    eq(sessions.id, request.user.sid),
    eq(sessions.userId, userId),
    eq(sessions.tokenHash, hashToken(token)),
    gt(sessions.expiresAt, new Date()),
  )).limit(1);
  if (!session) throw new AppError("Sessão encerrada.", 401, "SESSION_REVOKED");
  request.auth = { userId };
}

declare module "fastify" {
  interface FastifyRequest { auth: { userId: string } | null }
}
declare module "@fastify/jwt" {
  interface FastifyJWT { user: { sub: string; sid: string } }
}

