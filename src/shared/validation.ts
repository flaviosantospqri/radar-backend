import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const centsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const identificationSchema = z.object({
  name: z.string().min(1).max(240),
  category: z.string().max(120).nullable(),
  subcategory: z.string().max(120).nullable(),
  brand: z.string().max(160).nullable(),
  model: z.string().max(160).nullable(),
  version: z.string().max(160).nullable(),
  description: z.string().max(1000).nullable(),
  attributes: z.record(z.string(), z.unknown()),
  visibleCondition: z.string().max(500).nullable(),
  visibleDefects: z.array(z.string().max(300)).max(30),
  confidence: z.number().min(0).max(1),
  identifiedInformation: z.array(z.string().max(300)).max(30),
  uncertainInformation: z.array(z.string().max(300)).max(30),
  verificationQuestions: z.array(z.string().max(300)).max(20),
  searchQueries: z.array(z.string().min(1).max(240)).max(5),
  warnings: z.array(z.string().max(300)).max(30),
});
export type IdentificationResult = z.infer<typeof identificationSchema>;

export const confirmationSchema = z.object({
  name: z.string().min(1).max(240),
  category: z.string().max(120).nullable().optional(),
  subcategory: z.string().max(120).nullable().optional(),
  brand: z.string().max(160).nullable().optional(),
  model: z.string().max(160).nullable().optional(),
  version: z.string().max(160).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  visibleCondition: z.string().max(500).nullable().optional(),
  functionalCondition: z.enum(["funcionando", "com_defeito", "nao_testado", "nao_aplicavel"]).optional(),
  accessories: z.array(z.string().max(120)).max(30).optional(),
});

export const simulateSchema = z.object({
  askingPriceCents: centsSchema,
  transportCostCents: centsSchema.default(0),
  maintenanceCostCents: centsSchema.default(0),
  preparationCostCents: centsSchema.default(0),
  additionalCostCents: centsSchema.default(0),
  sellingFeeBps: z.number().int().min(0).max(10000).optional(),
  scenario: z.enum(["conservador", "provavel", "otimista"]).default("provavel"),
});

export const settingsSchema = z.object({
  minimumProfitCents: centsSchema,
  minimumRoiBps: z.number().int().min(0).max(100000),
  defaultSellingFeeBps: z.number().int().min(0).max(10000),
  defaultTransportCostCents: centsSchema,
  additionalCosts: z.array(z.object({ name: z.string().min(1).max(80), amountCents: centsSchema })).max(20),
  preferredScenario: z.enum(["conservador", "provavel", "otimista"]),
});

