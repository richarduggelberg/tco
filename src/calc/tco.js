import { financingCashflow } from "./financing.js";
import { buildValueSeries } from "./depreciation.js";
import { simulateRiskPaths } from "./risk.js";
import { presentValue, levelMonthlyPayment, annualToMonthlyRate } from "./npv.js";
import { buildConstantSeries, buildResidualSeries, sumSeries, computeEnergyMonthly } from "./cashflow.js";

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Percentil (0-1) i en redan sorterad (stigande) array, linjär interpolation. */
function percentile(sortedArr, p) {
  const idx = p * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
}

/**
 * Beräknar jämförbar månadskostnad (nivålagd annuitet av nuvärdet) för ett fordon,
 * given finansieringsmetod och antaganden. Inkluderar en Monte Carlo-baserad
 * haveririsk om assumptions.risk.enabled är true.
 *
 * @param {object} input - { price, months, financingMethod, assumptions }
 * @returns {object} Resultat med kategoriuppdelad deterministisk månadskostnad och ev. riskstatistik
 */
export function computeTco({ price, months, financingMethod, assumptions }) {
  const monthlyDiscountRate = annualToMonthlyRate(assumptions.discountRateAnnual);
  const yearlyRates = assumptions.depreciation.yearlyRates;

  const financing = financingCashflow(financingMethod, price, months, assumptions.financing);
  const energyMonthly = computeEnergyMonthly(assumptions.annualMileageKm, assumptions.running);
  const energy = buildConstantSeries(months, energyMonthly);
  const tax = buildConstantSeries(months, assumptions.tax.annualAmount / 12);
  const insurance = buildConstantSeries(months, assumptions.running.insuranceMonthly);
  const service = buildConstantSeries(months, assumptions.running.serviceMonthly);

  // Deterministisk bas: ingen risk inträffar, bilen åldras utan avbrott.
  const baseValueSeries = buildValueSeries(price, months, yearlyRates, []);
  const residual = buildResidualSeries(months, baseValueSeries[months]);

  const categorySeries = { financing, energy, tax, insurance, service, residual };
  const categoryMonthly = {};
  for (const [name, series] of Object.entries(categorySeries)) {
    const npv = presentValue(series, monthlyDiscountRate);
    categoryMonthly[name] = levelMonthlyPayment(npv, monthlyDiscountRate, months);
  }
  const deterministicTotal = Object.values(categoryMonthly).reduce((a, b) => a + b, 0);

  let risk = null;
  if (assumptions.risk.enabled) {
    const paths = simulateRiskPaths(price, months, yearlyRates, assumptions.risk);
    const monthlyCosts = paths.map((path) => {
      const valueSeries = buildValueSeries(price, months, yearlyRates, path.resetMonths);
      const pathResidual = buildResidualSeries(months, valueSeries[months]);
      const total = sumSeries([financing, energy, tax, insurance, service, pathResidual, path.cashflow]);
      const npv = presentValue(total, monthlyDiscountRate);
      return levelMonthlyPayment(npv, monthlyDiscountRate, months);
    });
    monthlyCosts.sort((a, b) => a - b);
    const mean = average(monthlyCosts);
    risk = {
      mean,
      median: percentile(monthlyCosts, 0.5),
      p10: percentile(monthlyCosts, 0.1),
      p90: percentile(monthlyCosts, 0.9),
      riskPremium: mean - deterministicTotal,
      shareWithTotalLoss: paths.filter((p) => p.numTotalLosses > 0).length / paths.length,
    };
  }

  return { categoryMonthly, deterministicTotal, risk };
}
