import { financingCashflow, loanSeries } from "./financing.js";
import { buildValueSeries, impliedNewPrice } from "./depreciation.js";
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
 * Fordonsskatt för en given månad (bonus-malus): förhöjd skatt (malus) de första
 * tax.malusYears kalenderåren sedan tillverkning, därefter normalnivå.
 */
function taxMonthlyCost(calendarAgeYears, tax) {
  const annual = calendarAgeYears < tax.malusYears ? tax.malusAnnualAmount : tax.normalAnnualAmount;
  return annual / 12;
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
  // Körsträcka blandas in i bilens "åldrande" (värdeminskning OCH haveririsk): en bil som
  // körs mer än baslinjen åldras snabbare per kalendermånad, och en lågkörd bil långsammare.
  const { baselineAnnualMileageKm, mileageWeight } = assumptions.vehicleAge;
  const mileageRatio = assumptions.annualMileageKm / baselineAnnualMileageKm;
  const ageRateMultiplier = mileageWeight * mileageRatio + (1 - mileageWeight);
  // Vid leasing äger användaren aldrig bilen - leasingbolaget bär värdeminsknings-
  // och haveririsken, och tar normalt med service i leasingavgiften. Fordonsskatt
  // ingår däremot i princip aldrig i leasingavgiften utan betalas separat.
  const isLeasing = financingMethod === "leasing";
  const serviceBundled = isLeasing && assumptions.financing.leasing.serviceIncluded;
  const winterTiresBundled = isLeasing && assumptions.financing.leasing.winterTiresIncluded;

  const financing = financingCashflow(financingMethod, price, months, assumptions.financing);
  const energyMonthly = computeEnergyMonthly(assumptions.annualMileageKm, assumptions.running);
  const energy = buildConstantSeries(months, energyMonthly);
  const tax = buildSeriesFromFunction(months, (t) =>
    taxMonthlyCost((ageAtPurchaseMonths + t) / 12, assumptions.tax)
  );
  const insurance = buildSeriesFromFunction(months, (t) =>
    insuranceMonthlyCost((ageAtPurchaseMonths + t) / 12, assumptions.insurance)
  );
  const service = buildConstantSeries(months, serviceBundled ? 0 : assumptions.running.serviceMonthly);

  const winterTires = winterTiresBundled
    ? buildPeriodicCostSeries(months, 0, 0)
    : buildPeriodicCostSeries(months, Math.round(assumptions.tires.winterIntervalYears * 12), assumptions.tires.setCost);
  const summerTires = buildPeriodicCostSeries(months, Math.round(assumptions.tires.summerIntervalYears * 12), assumptions.tires.setCost);
  const tires = sumSeries([winterTires, summerTires]);

  const categorySeries = { energy, tax, insurance, service, tires };
  if (isLeasing) {
    categorySeries.leasingavgift = financing;
  } else {
    // Deterministisk bas: ingen risk inträffar, bilen åldras utan avbrott. Kapitalkostnaden
    // räknas på eget kapital (bilens värde minus kvarvarande låneskuld), så den minskar
    // naturligt i takt med att bilen tappar värde och/eller lånet amorteras.
    const baseValueSeries = buildValueSeries(price, months, yearlyRates, [], ageAtPurchaseMonths, ageRateMultiplier);
    const loan = loanSeries(financingMethod, price, months, assumptions.financing);
    const equity = baseValueSeries.map((value, t) => value - loan.balance[t]);

    const depreciation = new Array(months + 1).fill(0);
    const kapitalkostnad = new Array(months + 1).fill(0);
    const laneranta = new Array(months + 1).fill(0);
    for (let t = 1; t <= months; t++) {
      depreciation[t] = -(baseValueSeries[t - 1] - baseValueSeries[t]);
      kapitalkostnad[t] = -(monthlyDiscountRate * equity[t - 1]);
      laneranta[t] = -loan.interest[t];
    }
    categorySeries.depreciation = depreciation;
    categorySeries.kapitalkostnad = kapitalkostnad;
    if (financingMethod !== "kontant") categorySeries.laneranta = laneranta;
  }

  const categoryMonthly = {};
  for (const [name, series] of Object.entries(categorySeries)) {
    const npv = presentValue(series, monthlyDiscountRate);
    categoryMonthly[name] = levelMonthlyPayment(npv, monthlyDiscountRate, months);
  }
  const deterministicTotal = Object.values(categoryMonthly).reduce((a, b) => a + b, 0);

  let risk = null;
  if (assumptions.risk.enabled && !isLeasing) {
    const paths = simulateRiskPaths(price, months, yearlyRates, assumptions.risk, ageAtPurchaseMonths, ageRateMultiplier);
    const monthlyCosts = paths.map((path) => {
      const valueSeries = buildValueSeries(price, months, yearlyRates, path.resetMonths, ageAtPurchaseMonths, ageRateMultiplier);
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

/**
 * Bygger en nominell (ej nuvärdesberäknad) månadskostnadskurva över bilens HELA liv
 * (sedan tillverkning), för att visualisera hur kostnaden varierar med bilens ålder -
 * oavsett vem som äger den. Drift-/åldersrelaterade poster (skatt, försäkring, bränsle/el,
 * service, däck, värdeminskning) visas genom hela kurvan, medan finansieringsrelaterade
 * poster (kapitalkostnad/låneränta/leasingavgift) bara läggs på under den egna
 * ägandeperioden (markerad med de två brytpunkterna som returneras).
 * @param {object} input - { price, months, financingMethod, assumptions }
 * @returns {{ ageYears: number[], monthlyCost: number[], purchaseAgeYears: number, endOfOwnershipAgeYears: number }}
 */
export function computeLifetimeMonthlyCosts({ price, months, financingMethod, assumptions }) {
  const yearlyRates = assumptions.depreciation.yearlyRates;
  const ageAtPurchaseMonths = Math.round((assumptions.ageAtPurchaseYears ?? 0) * 12);
  const { baselineAnnualMileageKm, mileageWeight } = assumptions.vehicleAge;
  const mileageRatio = assumptions.annualMileageKm / baselineAnnualMileageKm;
  const ageRateMultiplier = mileageWeight * mileageRatio + (1 - mileageWeight);
  const isLeasing = financingMethod === "leasing";
  const monthlyDiscountRate = annualToMonthlyRate(assumptions.discountRateAnnual);

  const totalLifeMonths = Math.max(ageAtPurchaseMonths + months + 24, 48);

  // Bilens värde sedan tillverkning: kalenderåldrande fram till köpet (körsträckan dessförinnan
  // är okänd och antas vara baslinjen), sedan samma körsträckeviktade åldrande som i computeTco.
  const preOwnershipValue = buildValueSeries(impliedNewPrice(price, ageAtPurchaseMonths, yearlyRates), ageAtPurchaseMonths, yearlyRates, [], 0, 1);
  const postOwnershipValue = buildValueSeries(price, totalLifeMonths - ageAtPurchaseMonths, yearlyRates, [], ageAtPurchaseMonths, ageRateMultiplier);
  const lifeValue = new Array(totalLifeMonths + 1);
  for (let u = 0; u <= totalLifeMonths; u++) {
    lifeValue[u] = u <= ageAtPurchaseMonths ? preOwnershipValue[u] : postOwnershipValue[u - ageAtPurchaseMonths];
  }

  const energyMonthly = computeEnergyMonthly(assumptions.annualMileageKm, assumptions.running);
  const winterIntervalMonths = Math.round(assumptions.tires.winterIntervalYears * 12);
  const summerIntervalMonths = Math.round(assumptions.tires.summerIntervalYears * 12);

  const loan = isLeasing ? null : loanSeries(financingMethod, price, months, assumptions.financing);
  const leasingCf = isLeasing ? financingCashflow(financingMethod, price, months, assumptions.financing) : null;

  const ageYears = [];
  const monthlyCost = [];
  for (let t = 1; t <= totalLifeMonths; t++) {
    const calendarAgeYears = t / 12;
    let cost =
      energyMonthly +
      taxMonthlyCost(calendarAgeYears, assumptions.tax) +
      insuranceMonthlyCost(calendarAgeYears, assumptions.insurance) +
      assumptions.running.serviceMonthly +
      (winterIntervalMonths > 0 && t % winterIntervalMonths === 0 ? assumptions.tires.setCost : 0) +
      (summerIntervalMonths > 0 && t % summerIntervalMonths === 0 ? assumptions.tires.setCost : 0) +
      (lifeValue[t - 1] - lifeValue[t]);

    const monthsSincePurchase = t - ageAtPurchaseMonths;
    const ownedThisMonth = monthsSincePurchase >= 1 && monthsSincePurchase <= months;
    if (ownedThisMonth) {
      if (isLeasing) {
        cost += -leasingCf[monthsSincePurchase];
      } else {
        const equityPrev = lifeValue[t - 1] - loan.balance[monthsSincePurchase - 1];
        cost += monthlyDiscountRate * equityPrev + loan.interest[monthsSincePurchase];
      }
    }

    ageYears.push(t / 12);
    monthlyCost.push(cost);
  }

  return {
    ageYears,
    monthlyCost,
    purchaseAgeYears: ageAtPurchaseMonths / 12,
    endOfOwnershipAgeYears: (ageAtPurchaseMonths + months) / 12,
  };
}
