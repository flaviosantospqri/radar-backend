import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import type { RawMarketReference } from "./provider.js";

const groundedSearchSchema = {
  type: Type.OBJECT,
  properties: {
    listings: {
      type: Type.ARRAY,
      maxItems: 12,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          priceBRL: { type: Type.NUMBER, minimum: 0, maximum: 1000000 },
          condition: { type: Type.STRING },
          sourceUrl: { type: Type.STRING },
          matchQuality: { type: Type.STRING, enum: ["exact", "similar"] },
        },
        required: ["title", "priceBRL", "condition", "sourceUrl", "matchQuality"],
      },
    },
    estimate: {
      type: Type.OBJECT,
      properties: {
        lowBRL: { type: Type.NUMBER, minimum: 0, maximum: 1000000 },
        averageBRL: { type: Type.NUMBER, minimum: 0, maximum: 1000000 },
        highBRL: { type: Type.NUMBER, minimum: 0, maximum: 1000000 },
        confidence: { type: Type.STRING, enum: ["low", "medium", "high", "none"] },
        note: { type: Type.STRING },
      },
      required: ["lowBRL", "averageBRL", "highBRL", "confidence", "note"],
    },
  },
  required: ["listings", "estimate"],
} as const;

const responseSchema = z.object({
  listings: z.array(z.object({
    title: z.string().trim().min(4).max(300),
    priceBRL: z.number().finite().positive().max(1_000_000),
    condition: z.string().trim().max(120),
    sourceUrl: z.string().url(),
    matchQuality: z.enum(["exact", "similar"]),
  })).max(12),
  estimate: z.object({
    lowBRL: z.number().finite().min(0).max(1_000_000),
    averageBRL: z.number().finite().min(0).max(1_000_000),
    highBRL: z.number().finite().min(0).max(1_000_000),
    confidence: z.enum(["low", "medium", "high", "none"]),
    note: z.string().trim().max(500),
  }),
});

export type GroundedPriceEstimate = {
  lowPriceCents: number;
  averagePriceCents: number;
  highPriceCents: number;
  confidenceBps: number;
  note: string;
  sources: Array<{ title: string; url: string }>;
};

export type GroundedMarketSearch = {
  references: RawMarketReference[];
  estimate: GroundedPriceEstimate | null;
  searchTerms: string[];
};

export type GroundedSearchProduct = {
  name: string;
  brand: string | null;
  model: string | null;
  version: string | null;
  category: string | null;
  condition: string | null;
  searchQueries: string[];
};

const promptFor = (product: GroundedSearchProduct) => [
  "Pesquise preços atuais de revenda no Brasil para o produto identificado abaixo. Use a Busca Google deste modelo para obter fontes públicas recentes; pesquise marketplaces e lojas brasileiras e dê preferência ao mesmo produto, marca e versão.",
  "Retorne no JSON somente anúncios individuais cujo preço em reais esteja visível em uma página ou resultado de busca citado. Cada sourceUrl deve ser exatamente a URL de uma fonte incluída nos resultados de busca usados por você. Não invente anúncios, preços, links, vendas concluídas nem use preço de frete ou parcela como preço total. Exclua peças, acessórios, serviços, kits incompatíveis e duplicados.",
  "Para cada anúncio, marque exact para o mesmo produto/versão ou similar para um substituto próximo. Não confunda similares com compatíveis exatos.",
  "Além dos anúncios, informe uma estimativa de revenda low/average/high em BRL. Calcule-a principalmente com preços de anúncios observados. Se só houver itens similares ou evidência limitada, estime com cautela e indique essa limitação no note; confidence deve ser low. Se não houver nenhuma evidência de preço ou produto suficientemente próximo, retorne zeros e confidence none. Nunca use somente memória do modelo como se fosse preço pesquisado.",
  "Identificação:",
  JSON.stringify(product),
].join("\n");

export async function searchGroundedMarketPrices(product: GroundedSearchProduct): Promise<GroundedMarketSearch> {
  if (!env.GEMINI_API_KEY) throw new AppError("GEMINI_API_KEY não está configurada para pesquisa de mercado.", 503, "GEMINI_NOT_CONFIGURED");

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1beta" } });
  let response;
  try {
    response = await ai.models.generateContent({
      model: env.GEMINI_MARKET_MODEL,
      contents: promptFor(product),
      config: {
        temperature: 0.1,
        maxOutputTokens: 1800,
        responseMimeType: "application/json",
        responseSchema: groundedSearchSchema,
        tools: [{ googleSearch: {} }],
        abortSignal: AbortSignal.timeout(22_000),
      },
    });
  } catch {
    throw new AppError("A pesquisa de preços com Gemini e Google Search não foi concluída.", 502, "GEMINI_MARKET_SEARCH_FAILED");
  }

  const candidate = response.candidates?.[0];
  let output: unknown = null;
  try { output = response.text ? JSON.parse(response.text) : null; } catch { /* Treat malformed model output as unavailable. */ }
  const parsed = responseSchema.safeParse(output);
  if (!candidate || !parsed.success) throw new AppError("A pesquisa não retornou preços em um formato válido.", 502, "GEMINI_MARKET_RESPONSE_INVALID");

  const sourceByUrl = new Map<string, { title: string; url: string }>();
  for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
    const url = chunk.web?.uri;
    const title = chunk.web?.title;
    if (!url || !title) continue;
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") continue;
      sourceByUrl.set(parsedUrl.toString(), { title: title.slice(0, 240), url: parsedUrl.toString() });
    } catch { /* Ignore malformed grounding links. */ }
  }
  const sources = [...sourceByUrl.values()].slice(0, 12);
  const references = parsed.data.listings.flatMap((listing, index) => {
    let url: string;
    try { url = new URL(listing.sourceUrl).toString(); } catch { return []; }
    const groundedSource = sourceByUrl.get(url);
    if (!groundedSource) return [];
    const priceCents = Math.round(listing.priceBRL * 100);
    if (priceCents <= 0) return [];
    return [{
      source: "google_search_grounding",
      externalId: `grounded-${index}-${priceCents}`,
      title: listing.title,
      priceCents,
      currency: "BRL" as const,
      condition: listing.condition || null,
      url,
      collectedAt: new Date(),
      metadata: { priceEvidence: "grounded_search_result", matchQuality: listing.matchQuality, sourceTitle: groundedSource.title },
    }];
  });

  const estimate = parsed.data.estimate;
  const estimateIsAvailable = estimate.confidence !== "none"
    && estimate.averageBRL > 0
    && sources.length > 0
    && estimate.lowBRL <= estimate.averageBRL
    && estimate.averageBRL <= estimate.highBRL;
  const confidenceBps = estimate.confidence === "high" ? 5000 : estimate.confidence === "medium" ? 3500 : 2000;
  return {
    references,
    estimate: estimateIsAvailable ? {
      lowPriceCents: Math.round(estimate.lowBRL * 100),
      averagePriceCents: Math.round(estimate.averageBRL * 100),
      highPriceCents: Math.round(estimate.highBRL * 100),
      confidenceBps,
      note: estimate.note || "Faixa indicativa baseada em resultados públicos da web.",
      sources,
    } : null,
    searchTerms: candidate.groundingMetadata?.webSearchQueries ?? [],
  };
}
