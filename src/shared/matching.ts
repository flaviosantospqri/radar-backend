export type ProductIdentity = { name: string; brand?: string | null; model?: string | null; version?: string | null };
export type MatchResult = { type: "EXATA" | "ALTA" | "PARCIAL" | "INCOMPATIVEL"; confidenceBps: number; compatible: boolean };

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const containsPhrase = (haystack: string, needle: string) => needle.length > 0 && (` ${haystack} `).includes(` ${needle} `);

export function classifyMatch(product: ProductIdentity, title: string): MatchResult {
  const normalizedTitle = normalize(title);
  const brand = product.brand ? normalize(product.brand) : "";
  const model = product.model ? normalize(product.model) : "";
  const version = product.version ? normalize(product.version) : "";
  const nameTokens = normalize(product.name).split(" ").filter((token) => token.length > 2 && !["com", "para", "usado", "usada", "produto"].includes(token));
  const brandMatch = containsPhrase(normalizedTitle, brand);
  const modelMatch = containsPhrase(normalizedTitle, model);
  const versionMatch = containsPhrase(normalizedTitle, version);
  const matchedNameTokens = nameTokens.filter((token) => containsPhrase(normalizedTitle, token)).length;

  if (modelMatch && (!brand || brandMatch) && (!version || versionMatch)) return { type: "EXATA", confidenceBps: 9800, compatible: true };
  if (modelMatch || (brandMatch && matchedNameTokens >= 2)) return { type: "ALTA", confidenceBps: 8000, compatible: true };
  if (brandMatch || matchedNameTokens >= 1) return { type: "PARCIAL", confidenceBps: 5000, compatible: false };
  return { type: "INCOMPATIVEL", confidenceBps: 0, compatible: false };
}

