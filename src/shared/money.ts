export function parseCents(value: unknown, field = "valor"): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim())) {
    const [whole, fraction = ""] = value.trim().split(".");
    const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
    const number = Number(cents);
    if (Number.isSafeInteger(number)) return number;
  }
  throw new Error(`${field} deve ser informado em centavos inteiros ou reais com até duas casas.`);
}

export function calculateProfitability(input: {
  purchasePriceCents: number | null;
  resalePriceCents: number;
  sellingFeeBps: number;
  transportCostCents: number;
  maintenanceCostCents: number;
  preparationCostCents: number;
  additionalCostCents: number;
  minimumProfitCents: number;
  minimumRoiBps: number;
}) {
  const sellingFeesCents = Math.round(input.resalePriceCents * input.sellingFeeBps / 10_000);
  const fixedCosts = input.transportCostCents + input.maintenanceCostCents + input.preparationCostCents + input.additionalCostCents;
  const totalCostCents = input.purchasePriceCents === null ? null : input.purchasePriceCents + fixedCosts;
  const estimatedProfitCents = totalCostCents === null ? null : input.resalePriceCents - sellingFeesCents - totalCostCents;
  const roiBps = totalCostCents === null || totalCostCents <= 0 || estimatedProfitCents === null
    ? null : Math.round(estimatedProfitCents * 10_000 / totalCostCents);
  const marginBps = input.resalePriceCents <= 0 || estimatedProfitCents === null
    ? null : Math.round(estimatedProfitCents * 10_000 / input.resalePriceCents);

  const afterFeeAndFixed = input.resalePriceCents - sellingFeesCents - fixedCosts;
  const maxByProfit = afterFeeAndFixed - input.minimumProfitCents;
  const maxByRoi = input.minimumRoiBps < 0
    ? Number.MAX_SAFE_INTEGER
    : Math.floor(afterFeeAndFixed * 10_000 / (10_000 + input.minimumRoiBps));
  const maximumPurchasePriceCents = Math.max(0, Math.min(maxByProfit, maxByRoi));

  return { sellingFeesCents, totalCostCents, estimatedProfitCents, roiBps, marginBps, maximumPurchasePriceCents };
}

