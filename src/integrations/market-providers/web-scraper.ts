import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { RawMarketReference } from "./provider.js";

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const allowedSearchHosts = new Set(["www.google.com", "www.bing.com", "www.zoom.com.br", "www.carrefour.com.br", "www.amazon.com.br"]);
const maxHtmlBytes = 3_000_000;

export type WebScrapeProduct = {
  name: string;
  brand: string | null;
  model: string | null;
  version: string | null;
  category: string | null;
  description?: string | null;
  searchQueries: string[];
};

export type WebScrapeResult = {
  references: RawMarketReference[];
  query: string;
  sourcesAttempted: string[];
};

function makeQuery(product: WebScrapeProduct) {
  const identity = [product.brand, product.model, product.version, product.name, product.category]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
  const geminiQuery = product.searchQueries.find((query) => query.trim().length >= 6)?.trim() ?? "";
  const descriptionTerms = (product.description ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-zA-Z0-9]+/).filter((word) => word.length >= 4).slice(0, 5).join(" ");
  const seen = new Set<string>();
  const tokens = [identity, geminiQuery, descriptionTerms].filter(Boolean).flatMap((part) => part.split(/\s+/)).filter((word) => {
    const key = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return tokens.join(" ").slice(0, 180);
}

function parsePriceCents(value: string) {
  const match = value.replace(/\u00a0/g, " ").match(/R\$\s*([0-9][0-9.,]*)/i);
  if (!match) return null;
  const raw = match[1];
  let normalized: string;
  if (raw.includes(",")) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{2}$/.test(raw)) normalized = raw;
  else normalized = raw.replace(/\./g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return null;
  return Math.round(amount * 100);
}

function cleanTitle(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s*R\$.*$/i, "").trim().slice(0, 300);
}

function productUrl(href: string | undefined, baseUrl: string, searchHost: string, allowSearchHost = false) {
  if (!href) return null;
  try {
    let url = new URL(href, baseUrl);
    if (url.hostname === searchHost) {
      const target = url.searchParams.get("q") ?? url.searchParams.get("url");
      if (target) url = new URL(target);
    }
    if (url.protocol !== "https:" || !url.hostname || (!allowSearchHost && url.hostname === searchHost) || url.hostname.endsWith(".google.com") || url.hostname.endsWith(".bing.com")) return null;
    return url.toString();
  } catch { return null; }
}

function makeReference(source: string, title: string, priceCents: number | null, url: string | null, searchQuery: string): RawMarketReference | null {
  if (!title || title.length < 4 || !priceCents || !url) return null;
  const externalId = createHash("sha256").update(`${source}|${url}|${priceCents}`).digest("hex").slice(0, 32);
  return {
    source,
    externalId,
    title,
    priceCents,
    currency: "BRL",
    condition: null,
    url,
    collectedAt: new Date(),
    metadata: {
      priceEvidence: "scraped_public_listing",
      activeListing: source !== "Google Search" && source !== "Bing Search",
      searchQuery,
    },
  };
}

async function fetchHtml(url: string) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!allowedSearchHosts.has(current.hostname)) return null;
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch { return null; }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) return null;
      try { current = new URL(location, current); } catch { return null; }
      continue;
    }
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("text/html")) return null;
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > maxHtmlBytes || !response.body) return null;

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxHtmlBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return null;
}

function googleResults(html: string, query: string): RawMarketReference[] {
  const $ = load(html);
  const results: RawMarketReference[] = [];
  $(".MjjYud, .sh-dgr__content").each((index, element) => {
    if (index >= 30) return false;
    const card = $(element);
    const title = cleanTitle(card.find("h3").first().text() || card.find(".tAxDx").first().text());
    const snippet = card.find(".VwiC3b, .aCOpRe, .sh-dgr__content").first().text() || card.text();
    const price = parsePriceCents(snippet);
    const href = card.find("a[href]").filter((_, anchor) => $(anchor).find("h3").length > 0).first().attr("href") ?? card.find("a[href]").first().attr("href");
    const url = productUrl(href, "https://www.google.com", "www.google.com");
    const reference = makeReference("Google Search", title, price, url, query);
    if (reference) results.push(reference);
  });
  return results;
}

function decodeBingUrl(href: string | undefined) {
  if (!href) return null;
  try {
    const url = new URL(href, "https://www.bing.com");
    if (url.hostname !== "www.bing.com") return url.toString();
    const encoded = url.searchParams.get("u");
    if (!encoded?.startsWith("a1")) return null;
    const decoded = Buffer.from(encoded.slice(2), "base64url").toString("utf8");
    return new URL(decoded).toString();
  } catch { return null; }
}

function bingResults(html: string, query: string): RawMarketReference[] {
  const $ = load(html);
  const results: RawMarketReference[] = [];
  $("li.b_algo").each((index, element) => {
    if (index >= 30) return false;
    const card = $(element);
    const title = cleanTitle(card.find("h2").first().text());
    const snippet = card.find(".b_caption p").first().text() || card.find("p").first().text();
    const price = parsePriceCents(snippet);
    const destination = decodeBingUrl(card.find("h2 a[href]").first().attr("href"));
    const url = destination ? productUrl(destination, "https://www.bing.com", "www.bing.com") : null;
    const reference = makeReference("Bing Search", title, price, url, query);
    if (reference) results.push(reference);
  });
  return results;
}

function zoomResults(html: string, query: string): RawMarketReference[] {
  const $ = load(html);
  const results: RawMarketReference[] = [];
  $("[data-testid='product-card']").each((index, element) => {
    if (index >= 30) return false;
    const card = $(element);
    const title = cleanTitle(card.find("[data-testid='product-card::name']").first().text());
    const price = parsePriceCents(card.find("[data-testid='product-card::price']").first().text());
    const href = card.find("a[href]").first().attr("href");
    const url = productUrl(href, "https://www.zoom.com.br", "www.zoom.com.br", true);
    const reference = makeReference("Zoom", title, price, url, query);
    if (reference) results.push(reference);
  });
  return results;
}

function carrefourResults(html: string, query: string): RawMarketReference[] {
  const $ = load(html);
  const results: RawMarketReference[] = [];
  $("[data-testid='search-product-card']").each((index, element) => {
    if (index >= 30) return false;
    const card = $(element);
    const anchor = card.find("a[href]").first();
    const title = cleanTitle(anchor.text());
    const price = parsePriceCents(card.text());
    const url = productUrl(anchor.attr("href"), "https://www.carrefour.com.br", "www.carrefour.com.br", true);
    const reference = makeReference("Carrefour", title, price, url, query);
    if (reference) results.push(reference);
  });
  return results;
}

function amazonResults(html: string, query: string): RawMarketReference[] {
  const $ = load(html);
  const results: RawMarketReference[] = [];
  $("[data-component-type='s-search-result']").each((index, element) => {
    if (index >= 30) return false;
    const card = $(element);
    const title = cleanTitle(card.find("h2").first().text());
    const price = parsePriceCents(card.find(".a-price:not(.a-text-price) .a-offscreen").first().text());
    const asin = card.attr("data-asin");
    const href = card.find("h2 a[href]").first().attr("href");
    const url = asin ? `https://www.amazon.com.br/dp/${encodeURIComponent(asin)}` : productUrl(href, "https://www.amazon.com.br", "www.amazon.com.br", true);
    const reference = makeReference("Amazon", title, price, url, query);
    if (reference) results.push(reference);
  });
  return results;
}

function deduplicate(references: RawMarketReference[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const titleKey = reference.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = `${titleKey}|${reference.priceCents}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
}

export async function scrapePublicMarketPrices(product: WebScrapeProduct): Promise<WebScrapeResult> {
  const query = makeQuery(product);
  if (!query) return { references: [], query, sourcesAttempted: [] };
  const encoded = encodeURIComponent(query);
  const requests = [
    { source: "Google Search", url: `https://www.google.com/search?hl=pt-BR&gl=br&num=20&q=${encoded}`, parse: googleResults },
    { source: "Bing Search", url: `https://www.bing.com/search?setlang=pt-br&cc=br&q=${encoded}`, parse: bingResults },
    { source: "Zoom", url: `https://www.zoom.com.br/search?q=${encoded}`, parse: zoomResults },
    { source: "Carrefour", url: `https://www.carrefour.com.br/busca/${encoded}`, parse: carrefourResults },
    { source: "Amazon", url: `https://www.amazon.com.br/s?k=${encoded}`, parse: amazonResults },
  ];
  const responses = await Promise.all(requests.map(async (request) => {
    try {
      const html = await fetchHtml(request.url);
      return { source: request.source, references: html ? request.parse(html, query) : [] };
    } catch {
      return { source: request.source, references: [] };
    }
  }));
  return {
    references: deduplicate(responses.flatMap((response) => response.references)),
    query,
    sourcesAttempted: requests.map((request) => request.source),
  };
}
