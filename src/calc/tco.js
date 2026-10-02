import { financingCashflow } from "./financing.js";
import { buildValueSeries } from "./depreciation.js";
import { simulateRiskPaths } from "./risk.js";
import { presentValue, levelMonthlyPayment, annualToMonthlyRate } from "./npv.js";
import {
  buildConstantSeries,
  buildResidualSeries,
  buildSeriesFromFunction,
  buildPeriodicCostSeries,
  sumSeries,
  computeEnergyMonthly,
} from "./cashflow.js";

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
 * Försäkringskostnad för en given månad, baserat på bilens kalenderålder (sedan
 * tillverkning). Växlar mellan halv- och helförsäkring enligt insurance.helStartYears/helEndYears.
 */
function insuranceMonthlyCost(calendarAgeYears, insurance) {
  if (calendarAgeYears >= insurance.helStartYears && calendarAgeYears < insurance.helEndYears) {
    return insurance.helMonthly;
  }
  return insurance.halvMonthly;
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
  const ageAtPurchaseMonths = Math.round((assumptions.ageAtPurchaseYears ?? 0) * 12);
  // Vid leasing äger användaren aldrig bilen - leasingbolaget bär värdeminsknings-
  // och haveririsken, och tar normalt med fordonsskatt/service i leasingavgiften.
  const isLeasing = financingMethod === "leasing";
  const bundledInFee = isLeasing && assumptions.financing.leasing.taxAndServiceIncluded;
  const winterTiresBundled = isLeasing && assumptions.financing.leasing.winterTiresIncluded;

  const financing = financingCashflow(financingMethod, price, months, assumptions.financing);
  const energyMonthly = computeEnergyMonthly(assumptions.annualMileageKm, assumptions.running);
  const energy = buildConstantSeries(months, energyMonthly);
  const tax = buildConstantSeries(months, bundledInFee ? 0 : assumptions.tax.annualAmount / 12);
  const insurance = buildSeriesFromFunction(months, (t) =>
    insuranceMonthlyCost((ageAtPurchaseMonths + t) / 12, assumptions.insurance)
  );
  const service = buildConstantSeries(months, bundledInFee ? 0 : assumptions.running.serviceMonthly);

  const winterTires = winterTiresBundled
    ? buildPeriodicCostSeries(months, 0, 0)
    : buildPeriodicCostSeries(months, Math.round(assumptions.tires.winterIntervalYears * 12), assumptions.tires.setCost);
  const summerTires = buildPeriodicCostSeries(months, Math.round(assumptions.tires.summerIntervalYears * 12), assumptions.tires.setCost);
  const tires = sumSeries([winterTires, summerTires]);

  const categorySeries = { financing, energy, tax, insurance, service, tires };
  if (!isLeasing) {
    // Deterministisk bas: ingen risk inträffar, bilen åldras utan avbrott.
    const baseValueSeries = buildValueSeries(price, months, yearlyRates, [], ageAtPurchaseMonths);
    categorySeries.residual = buildResidualSeries(months, baseValueSeries[months]);
  }

  const categoryMonthly = {};
  for (const [name, series] of Object.entries(categorySeries)) {
    const npv = presentValue(series, monthlyDiscountRate);
    categoryMonthly[name] = levelMonthlyPayment(npv, monthlyDiscountRate, months);
  }
  const deterministicTotal = Object.values(categoryMonthly).reduce((a, b) => a + b, 0);

  let risk = null;
  if (assumptions.risk.enabled && !isLeasing) {
    const paths = simulateRiskPaths(price, months, yearlyRates, assumptions.risk, ageAtPurchaseMonths);
    const monthlyCosts = paths.map((path) => {
      const valueSeries = buildValueSeries(price, months, yearlyRates, path.resetMonths, ageAtPurchaseMonths);
      const pathResidual = buildResidualSeries(months, valueSeries[months]);
      const total = sumSeries([financing, energy, tax, insurance, service, tires, pathResidual, path.cashflow]);
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
