CREATE TYPE "public"."analysis_status" AS ENUM('pending', 'uploading', 'identifying', 'awaiting_confirmation', 'researching', 'calculating', 'completed', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."liquidity_type" AS ENUM('ALTA', 'MEDIA', 'BAIXA', 'INSUFICIENTE');--> statement-breakpoint
CREATE TYPE "public"."match_type" AS ENUM('EXATA', 'ALTA', 'PARCIAL', 'INCOMPATIVEL');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('ANALISADO', 'FAVORITO', 'COMPRADO', 'VENDIDO', 'DESCARTADO');--> statement-breakpoint
CREATE TYPE "public"."recommendation_type" AS ENUM('COMPRAR', 'NEGOCIAR', 'INVESTIGAR', 'EVITAR');--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"provider" varchar(80) NOT NULL,
	"model" varchar(160) NOT NULL,
	"operation" varchar(80) NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" varchar(32),
	"status" varchar(40) NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_request_id" varchar(100),
	"status" "analysis_status" DEFAULT 'pending' NOT NULL,
	"product_id" uuid,
	"asking_price_cents" bigint,
	"recommendation" "recommendation_type",
	"identification_confidence_bps" integer,
	"research_confidence_bps" integer,
	"liquidity_level" "liquidity_type",
	"recommendation_reasons" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"source" varchar(80) NOT NULL,
	"external_id" varchar(120),
	"title" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'BRL' NOT NULL,
	"condition" varchar(80),
	"url" text NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"match_confidence_bps" integer NOT NULL,
	"match_type" "match_type" NOT NULL,
	"is_compatible" boolean NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "opportunity_status" DEFAULT 'ANALISADO' NOT NULL,
	"actual_purchase_price_cents" bigint,
	"actual_sale_price_cents" bigint,
	"actual_transport_cost_cents" bigint,
	"actual_maintenance_cost_cents" bigint,
	"actual_preparation_cost_cents" bigint,
	"actual_selling_fees_cents" bigint,
	"actual_additional_costs_cents" bigint,
	"realized_profit_cents" bigint,
	"realized_roi_bps" integer,
	"purchased_at" timestamp with time zone,
	"sold_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"name" varchar(240) NOT NULL,
	"category" varchar(120),
	"subcategory" varchar(120),
	"brand" varchar(160),
	"model" varchar(160),
	"version" varchar(160),
	"description" text,
	"visible_condition" text,
	"functional_condition" varchar(80),
	"confirmed_by_user" boolean DEFAULT false NOT NULL,
	"confidence_bps" integer,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visible_defects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"identified_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertain_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profitability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"purchase_price_cents" bigint,
	"resale_price_cents" bigint,
	"selling_fee_bps" integer DEFAULT 0 NOT NULL,
	"selling_fees_cents" bigint DEFAULT 0 NOT NULL,
	"transport_cost_cents" bigint DEFAULT 0 NOT NULL,
	"maintenance_cost_cents" bigint DEFAULT 0 NOT NULL,
	"preparation_cost_cents" bigint DEFAULT 0 NOT NULL,
	"additional_cost_cents" bigint DEFAULT 0 NOT NULL,
	"total_cost_cents" bigint,
	"estimated_profit_cents" bigint,
	"roi_bps" integer,
	"margin_bps" integer,
	"maximum_purchase_price_cents" bigint,
	"scenarios" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"provider" varchar(100) NOT NULL,
	"status" varchar(40) NOT NULL,
	"query" text NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"execution_time_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"minimum_profit_cents" bigint DEFAULT 0 NOT NULL,
	"minimum_roi_bps" integer DEFAULT 2000 NOT NULL,
	"default_selling_fee_bps" integer DEFAULT 0 NOT NULL,
	"default_transport_cost_cents" bigint DEFAULT 0 NOT NULL,
	"additional_costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_scenario" varchar(20) DEFAULT 'provavel' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_references" ADD CONSTRAINT "market_references_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profitability" ADD CONSTRAINT "profitability_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_logs" ADD CONSTRAINT "research_logs_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_analysis_idx" ON "ai_usage_logs" USING btree ("analysis_id","created_at");--> statement-breakpoint
CREATE INDEX "analyses_user_created_idx" ON "analyses" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "analyses_user_status_idx" ON "analyses" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_user_request_uq" ON "analyses" USING btree ("user_id","client_request_id");--> statement-breakpoint
CREATE INDEX "market_references_analysis_idx" ON "market_references" USING btree ("analysis_id","is_compatible","collected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_references_analysis_url_uq" ON "market_references" USING btree ("analysis_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_analysis_uq" ON "opportunities" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "opportunities_user_status_idx" ON "opportunities" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_analysis_uq" ON "products" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profitability_analysis_uq" ON "profitability" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "research_logs_analysis_idx" ON "research_logs" USING btree ("analysis_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_user_uq" ON "settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");