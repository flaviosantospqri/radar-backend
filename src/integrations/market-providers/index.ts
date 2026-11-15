import type { MarketResearchProvider } from "./provider.js";
import { mercadoLivreProvider } from "./mercado-livre.js";

export const marketProviders: MarketResearchProvider[] = [mercadoLivreProvider];

