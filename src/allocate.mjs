const finite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || Object.is(number, -0)) throw new TypeError(`${label}-invalid`);
  return number;
};

export function allocateMandatePortfolio({ scores, uncertainty = {}, currentWeights = {}, mandate } = {}) {
  if (!scores || typeof scores !== "object" || Array.isArray(scores) || !mandate || mandate.type !== "PortfolioAllocationMandate") throw new TypeError("scores-and-allocation-mandate-required");
  const maximumWeight = finite(mandate.maximumWeight, "maximum-weight"), grossLimit = finite(mandate.grossLimit, "gross-limit");
  if (maximumWeight <= 0 || maximumWeight > 1 || grossLimit <= 0 || grossLimit > Number(mandate.leverageLimit ?? 1) || mandate.shorting === true) throw new RangeError("allocation-mandate-invalid");
  const adjusted = Object.fromEntries(Object.entries(scores).map(([entity, score]) => {
    const risk = Math.max(0, finite(uncertainty[entity] ?? 0, `uncertainty-${entity}`));
    return [entity, Math.max(0, finite(score, `score-${entity}`)) / (1 + risk)];
  }));
  const weights = Object.fromEntries(Object.keys(adjusted).map((entity) => [entity, 0]));
  let active = Object.entries(adjusted).filter(([, score]) => score > 0), remaining = grossLimit;
  while (active.length && remaining > 1e-12) {
    const total = active.reduce((sum, [, score]) => sum + score, 0), next = [];
    let assignedThisRound = 0;
    for (const [entity, score] of active) {
      const assigned = Math.min(maximumWeight - weights[entity], remaining * score / total);
      weights[entity] += assigned; assignedThisRound += assigned;
      if (weights[entity] < maximumWeight - 1e-12) next.push([entity, score]);
    }
    if (assignedThisRound < 1e-12) break;
    remaining -= assignedThisRound; active = next;
  }
  const turnover = Object.keys(weights).reduce((sum, entity) => sum + Math.abs(weights[entity] - finite(currentWeights[entity] ?? 0, `current-weight-${entity}`)), 0);
  return Object.freeze({ type: "MandatePortfolioAllocation", version: 1, mandate: mandate.id ?? null, weights: Object.freeze(weights), cashWeight: Math.max(0, 1 - Object.values(weights).reduce((sum, weight) => sum + weight, 0)), grossExposure: Object.values(weights).reduce((sum, weight) => sum + Math.abs(weight), 0), turnover, effect: "target-weights-only" });
}
