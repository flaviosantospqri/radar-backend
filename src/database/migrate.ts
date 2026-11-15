import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../config/env.js";

if (!env.DATABASE_URL) throw new Error("DATABASE_URL é obrigatória para aplicar migrations.");
const client = postgres(env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
try {
  await migrate(drizzle(client), { migrationsFolder: "./src/database/migrations" });
  console.log("Migrations aplicadas.");
} finally {
  await client.end({ timeout: 5 });
}

