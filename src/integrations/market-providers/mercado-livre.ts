import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import type { MarketResearchProvider, MarketSearchInput, RawMarketReference } from "./provider.js";

type MercadoLivreItem = { id?: string; title?: string; price?: number; currency_id?: string; condition?: string; permalink?: string; category_id?: string; seller?: { id?: number }; available_quantity?: number };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const mercadoLivreProvider: MarketResearchProvider = {
  getProviderName: () => "mercado_livre",
  async checkAvailability() {
    try {
      const response = await fetch(`${env.MERCADOLIVRE_API_BASE}/sites/MLB`, { signal: AbortSignal.timeout(5000) });
      return response.ok;
    } catch { return false; }
  },
  normalizeResults(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { results?: unknown }).results)) return [];
    const collectedAt = new Date();
    return ((raw as { results: MercadoLivreItem[] }).results).flatMap((item) => {
      if (!item.id || !item.title || !item.permalink || typeof item.price !== "number" || !Number.isFinite(item.price) || item.price <= 0 || item.currency_id !== "BRL") return [];
      let url: URL;
      try { url = new URL(item.permalink); } catch { return []; }
      if (!["mercadolivre.com.br", "mercadolibre.com.br", "produto.mercadolivre.com.br"].includes(url.hostname)) return [];
      return [{
        source: "mercado_livre", externalId: item.id, title: item.title, priceCents: Math.round(item.price * 100), currency: "BRL" as const,
        condition: item.condition ?? null, url: url.toString(), collectedAt,
        metadata: { categoryId: item.category_id ?? null, sellerId: item.seller?.id ?? null, activeListing: true, quantityIsNotSales: item.available_quantity ?? null },
      }];
    });
  },
  async searchProducts(input: MarketSearchInput) {
    const query = input.query.trim().slice(0, 180);
    if (!query) return [];
    const url = new URL(`${env.MERCADOLIVRE_API_BASE}/sites/MLB/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(Math.max(1, Math.min(input.limit ?? 50, 50))));
    url.searchParams.set("sort", "relevance");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (env.MERCADOLIVRE_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.MERCADOLIVRE_ACCESS_TOKEN}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          await delay(400);
          continue;
        }
        if (!response.ok) throw new AppError(`Mercado Livre respondeu HTTP ${response.status}.`, 502, "MARKET_PROVIDER_FAILED");
        return this.normalizeResults(await response.json());
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (attempt === 1) throw new AppError("Não foi possível consultar o Mercado Livre no momento.", 502, "MARKET_PROVIDER_TIMEOUT");
        await delay(400);
      }
    }
    throw new AppError("Pesquisa no Mercado Livre indisponível.", 502, "MARKET_PROVIDER_FAILED");
  },
};

