import { z } from "zod";

const optional = z.string().trim().optional().transform((value) => value || undefined);
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: optional,
  JWT_SECRET: z.string().min(32).default("development-only-secret-change-this-before-deploying"),
  GEMINI_API_KEY: optional,
  GEMINI_LIVE_MODEL: z.string().default("gemini-3.1-flash-live-preview"),
  MERCADOLIVRE_ACCESS_TOKEN: optional,
  MERCADOLIVRE_API_BASE: z.string().url().default("https://api.mercadolibre.com"),
  MOBILE_ORIGINS: z.string().default("*"),
});

export const env = envSchema.parse(process.env);
export const allowedOrigins = env.MOBILE_ORIGINS === "*" ? true : env.MOBILE_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean);

