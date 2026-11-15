import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const analysisStatus = pgEnum("analysis_status", [
  "pending", "uploading", "identifying", "awaiting_confirmation", "researching",
  "calculating", "completed", "partial", "failed", "cancelled",
]);
export const recommendationType = pgEnum("recommendation_type", ["COMPRAR", "NEGOCIAR", "INVESTIGAR", "EVITAR"]);
export const liquidityType = pgEnum("liquidity_type", ["ALTA", "MEDIA", "BAIXA", "INSUFICIENTE"]);
export const matchType = pgEnum("match_type", ["EXATA", "ALTA", "PARCIAL", "INCOMPATIVEL"]);
export const opportunityStatus = pgEnum("opportunity_status", ["ANALISADO", "FAVORITO", "COMPRADO", "VENDIDO", "DESCARTADO"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const cents = (name: string) => bigint(name, { mode: "number" });

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

export const analyses = pgTable("analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientRequestId: varchar("client_request_id", { length: 100 }),
  status: analysisStatus("status").notNull().default("pending"),
  productId: uuid("product_id"),
  askingPriceCents: cents("asking_price_cents"),
  recommendation: recommendationType("recommendation"),
  identificationConfidenceBps: integer("identification_confidence_bps"),
  researchConfidenceBps: integer("research_confidence_bps"),
  liquidityLevel: liquidityType("liquidity_level"),
  recommendationReasons: jsonb("recommendation_reasons").$type<string[]>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("analyses_user_created_idx").on(t.userId, t.createdAt),
  index("analyses_user_status_idx").on(t.userId, t.status),
  uniqueIndex("analyses_user_request_uq").on(t.userId, t.clientRequestId),
]);

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 240 }).notNull(),
  category: varchar("category", { length: 120 }),
  subcategory: varchar("subcategory", { length: 120 }),
  brand: varchar("brand", { length: 160 }),
  model: varchar("model", { length: 160 }),
  version: varchar("version", { length: 160 }),
  description: text("description"),
  visibleCondition: text("visible_condition"),
  functionalCondition: varchar("functional_condition", { length: 80 }),
  confirmedByUser: boolean("confirmed_by_user").notNull().default(false),
  confidenceBps: integer("confidence_bps"),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
  visibleDefects: jsonb("visible_defects").$type<string[]>().notNull().default([]),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  identifiedInformation: jsonb("identified_information").$type<string[]>().notNull().default([]),
  uncertainInformation: jsonb("uncertain_information").$type<string[]>().notNull().default([]),
  verificationQuestions: jsonb("verification_questions").$type<string[]>().notNull().default([]),
  searchQueries: jsonb("search_queries").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("products_analysis_uq").on(t.analysisId)]);

export const marketReferences = pgTable("market_references", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 80 }).notNull(),
  externalId: varchar("external_id", { length: 120 }),
  title: text("title").notNull(),
  priceCents: cents("price_cents").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("BRL"),
  condition: varchar("condition", { length: 80 }),
  url: text("url").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  matchConfidenceBps: integer("match_confidence_bps").notNull(),
  matchType: matchType("match_type").notNull(),
  isCompatible: boolean("is_compatible").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("market_references_analysis_idx").on(t.analysisId, t.isCompatible, t.collectedAt), uniqueIndex("market_references_analysis_url_uq").on(t.analysisId, t.url)]);

export const profitability = pgTable("profitability", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  purchasePriceCents: cents("purchase_price_cents"),
  resalePriceCents: cents("resale_price_cents"),
  sellingFeeBps: integer("selling_fee_bps").notNull().default(0),
  sellingFeesCents: cents("selling_fees_cents").notNull().default(0),
  transportCostCents: cents("transport_cost_cents").notNull().default(0),
  maintenanceCostCents: cents("maintenance_cost_cents").notNull().default(0),
  preparationCostCents: cents("preparation_cost_cents").notNull().default(0),
  additionalCostCents: cents("additional_cost_cents").notNull().default(0),
  totalCostCents: cents("total_cost_cents"),
  estimatedProfitCents: cents("estimated_profit_cents"),
  roiBps: integer("roi_bps"),
  marginBps: integer("margin_bps"),
  maximumPurchasePriceCents: cents("maximum_purchase_price_cents"),
  scenarios: jsonb("scenarios").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("profitability_analysis_uq").on(t.analysisId)]);

export const opportunities = pgTable("opportunities", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: opportunityStatus("status").notNull().default("ANALISADO"),
  actualPurchasePriceCents: cents("actual_purchase_price_cents"),
  actualSalePriceCents: cents("actual_sale_price_cents"),
  actualTransportCostCents: cents("actual_transport_cost_cents"),
  actualMaintenanceCostCents: cents("actual_maintenance_cost_cents"),
  actualPreparationCostCents: cents("actual_preparation_cost_cents"),
  actualSellingFeesCents: cents("actual_selling_fees_cents"),
  actualAdditionalCostsCents: cents("actual_additional_costs_cents"),
  realizedProfitCents: cents("realized_profit_cents"),
  realizedRoiBps: integer("realized_roi_bps"),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }),
  soldAt: timestamp("sold_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("opportunities_analysis_uq").on(t.analysisId), index("opportunities_user_status_idx").on(t.userId, t.status, t.updatedAt)]);

export const settings = pgTable("settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  minimumProfitCents: cents("minimum_profit_cents").notNull().default(0),
  minimumRoiBps: integer("minimum_roi_bps").notNull().default(2000),
  defaultSellingFeeBps: integer("default_selling_fee_bps").notNull().default(0),
  defaultTransportCostCents: cents("default_transport_cost_cents").notNull().default(0),
  additionalCosts: jsonb("additional_costs").$type<Array<{ name: string; amountCents: number }>>().notNull().default([]),
  preferredScenario: varchar("preferred_scenario", { length: 20 }).notNull().default("provavel"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("settings_user_uq").on(t.userId)]);

export const researchLogs = pgTable("research_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 100 }).notNull(),
  status: varchar("status", { length: 40 }).notNull(),
  query: text("query").notNull(),
  resultCount: integer("result_count").notNull().default(0),
  errorMessage: text("error_message"),
  executionTimeMs: integer("execution_time_ms"),
  createdAt: createdAt(),
}, (t) => [index("research_logs_analysis_idx").on(t.analysisId, t.createdAt)]);

export const aiUsageLogs = pgTable("ai_usage_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => analyses.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 80 }).notNull(),
  model: varchar("model", { length: 160 }).notNull(),
  operation: varchar("operation", { length: 80 }).notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCostUsd: varchar("estimated_cost_usd", { length: 32 }),
  status: varchar("status", { length: 40 }).notNull(),
  errorMessage: text("error_message"),
  createdAt: createdAt(),
}, (t) => [index("ai_usage_analysis_idx").on(t.analysisId, t.createdAt)]);

export const schema = { users, sessions, analyses, products, marketReferences, profitability, opportunities, settings, researchLogs, aiUsageLogs };

