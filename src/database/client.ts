import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
export const sql = databaseUrl
  ? postgres(databaseUrl, { ssl: "require", max: 5, idle_timeout: 20, connect_timeout: 10, prepare: false })
  : null;
export const db = sql ? drizzle(sql, { schema }) : null;

export function requireDb() {
  if (!db) {
    const error = new Error("DATABASE_URL não está configurada.");
    Object.assign(error, { statusCode: 503, code: "DATABASE_NOT_CONFIGURED" });
    throw error;
  }
  return db;
}

