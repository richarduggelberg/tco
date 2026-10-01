import { valueAtAge } from "./depreciation.js";

/**
 * Weibull-hazardfunktion: sannolikhet per månad för en "betydande reparationshändelse",
 * ökande med bilens ålder (badtub-kurvans stigande del).
 * @param {number} ageMonths
 * @param {number} shape - k, formparameter (>1 ger ökande hazard med åldern)
 * @param {number} scaleMonths - lambda, karaktäristisk livslängd i månader
 */
export function weibullHazard(ageMonths, shape, scaleMonths) {
  if (ageMonths <= 0) return 0;
  return (shape / scaleMonths) * Math.pow(ageMonths / scaleMonths, shape - 1);
}

/** Standard normalfördelad slumpvariabel via Box-Muller, given en uniform rng() i [0,1). */
function sampleStandardNormal(rng) {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Log-normalfördelad reparationskostnad kring en given medianskostnad. */
export function sampleRepairCost(median, sigma, rng) {
  const z = sampleStandardNormal(rng);
  return median * Math.exp(sigma * z);
}

/**
 * Simulerar en enskild "livshistoria" för haveri/reparationer över innehavsperioden.
 * Vid ett ekonomiskt totalhaveri (reparationskostnad > tröskel * bilens aktuella värde)
 * antas en likvärdig bil köpas in till dess marknadsvärde, och åldern nollställs.
 * @returns {{cashflow: number[], resetMonths: number[], numEvents: number, numTotalLosses: number}}
 */
export function simulateOnePath(initialValue, months, yearlyRates, riskParams, rng = Math.random) {
  const cf = new Array(months + 1).fill(0);
  const resetMonths = [];
  let age = 0;
  let numEvents = 0;
  let numTotalLosses = 0;

  for (let t = 1; t <= months; t++) {
    age += 1;
    const hazard = weibullHazard(age, riskParams.weibullShape, riskParams.weibullScaleMonths) * riskParams.reliabilityFactor;
    const p = Math.min(Math.max(hazard, 0), 1);
    if (rng() < p) {
      numEvents++;
      const repairCost = sampleRepairCost(riskParams.repairCostMedian, riskParams.repairCostSigma, rng);
      const currentValue = valueAtAge(initialValue, age, yearlyRates);
      if (repairCost > riskParams.totalLossThreshold * currentValue) {
        numTotalLosses++;
        cf[t] -= currentValue; // Köp av likvärdig bil till dåvarande marknadsvärde
        resetMonths.push(t);
        age = 0;
      } else {
        cf[t] -= repairCost;
      }
    }
  }

  return { cashflow: cf, resetMonths, numEvents, numTotalLosses };
}

/**
 * Kör Monte Carlo-simulering med N oberoende livshistorier.
 * @returns {Array<{cashflow: number[], resetMonths: number[], numEvents: number, numTotalLosses: number}>}
 */
export function simulateRiskPaths(initialValue, months, yearlyRates, riskParams, rng = Math.random) {
  const paths = [];
  for (let i = 0; i < riskParams.numSimulations; i++) {
    paths.push(simulateOnePath(initialValue, months, yearlyRates, riskParams, rng));
  }
  return paths;
}
