export function scoreOpportunity(input: {
  askingPriceCents: number | null;
  estimatedProfitCents: number | null;
  roiBps: number | null;
  maximumPurchasePriceCents: number | null;
  minimumProfitCents: number;
  minimumRoiBps: number;
  identificationConfidenceBps: number | null;
  comparableCount: number;
  liquidity: "ALTA" | "MEDIA" | "BAIXA" | "INSUFICIENTE";
  functionalCondition: string | null;
}) {
  const reasons: string[] = [];
  if (!input.comparableCount) reasons.push("Não há anúncios compatíveis suficientes para estimar a revenda.");
  if (input.comparableCount > 0 && input.comparableCount < 3) reasons.push("Há menos de três referências compatíveis; a estimativa tem baixa sustentação.");
  if ((input.identificationConfidenceBps ?? 0) < 7000) reasons.push("A identificação visual ainda tem incerteza relevante.");
  if (!input.functionalCondition || input.functionalCondition === "nao_testado") reasons.push("O funcionamento ainda precisa ser verificado presencialmente.");
  if (input.liquidity === "INSUFICIENTE") reasons.push("Os dados disponíveis não permitem estimar liquidez.");
  if (input.liquidity === "BAIXA") reasons.push("A quantidade de anúncios sugere baixa disponibilidade de referências; isso não mede velocidade de venda.");
  if (input.askingPriceCents === null) reasons.push("Informe o preço pedido para concluir a análise financeira.");
  if (input.comparableCount < 3 || input.askingPriceCents === null || (input.identificationConfidenceBps ?? 0) < 5000) {
    return { recommendation: "INVESTIGAR" as const, reasons };
  }
  if ((input.estimatedProfitCents ?? -1) <= 0 || (input.roiBps ?? -1) < 0) {
    reasons.push("No cenário selecionado, os custos superam o preço estimado de revenda.");
    return { recommendation: "EVITAR" as const, reasons };
  }
  if (input.maximumPurchasePriceCents !== null && input.askingPriceCents > input.maximumPurchasePriceCents) {
    reasons.push(`O preço pedido está ${formatCents(input.askingPriceCents - input.maximumPurchasePriceCents)} acima do máximo recomendado.`);
    reasons.push("Há potencial de lucro somente se o preço ou os custos forem negociados.");
    return { recommendation: "NEGOCIAR" as const, reasons };
  }
  if ((input.estimatedProfitCents ?? 0) < input.minimumProfitCents || (input.roiBps ?? 0) < input.minimumRoiBps) {
    reasons.push("Lucro ou ROI abaixo dos parâmetros mínimos configurados.");
    return { recommendation: "EVITAR" as const, reasons };
  }
  if (input.liquidity === "INSUFICIENTE" || input.liquidity === "BAIXA") {
    reasons.push("A quantidade de referências não sustenta uma recomendação definitiva de compra.");
    return { recommendation: "INVESTIGAR" as const, reasons };
  }
  reasons.push("Preço dentro do limite calculado, com margem acima dos parâmetros configurados e referências suficientes.");
  return { recommendation: "COMPRAR" as const, reasons };
}

function formatCents(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

