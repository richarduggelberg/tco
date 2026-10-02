import { financingCashflow, loanSeries } from "./financing.js";
import { buildValueSeries } from "./depreciation.js";
import { simulateRiskPaths } from "./risk.js";
import { presentValue, levelMonthlyPayment, annualToMonthlyRate } from "./npv.js";
import {
  buildConstantSeries,
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

  const loan = isLeasing ? null : loanSeries(financingMethod, price, months, assumptions.financing);
  const categorySeries = { energy, tax, insurance, service, tires };
  if (isLeasing) {
    categorySeries.leasingavgift = financing;
  } else {
    // Deterministisk bas: ingen risk inträffar, bilen åldras utan avbrott. Kapitalkostnaden
    // räknas på eget kapital (bilens värde minus kvarvarande låneskuld), så den minskar
    // naturligt i takt med att bilen tappar värde och/eller lånet amorteras.
    const baseValueSeries = buildValueSeries(price, months, yearlyRates, [], ageAtPurchaseMonths, ageRateMultiplier);
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
      // Samma kapitalkostnad/värdeminskning/låneränta-nedbrytning som den deterministiska
      // basen, fast på den här banans (ev. återställda) värdeserie - annars skulle en
      // bana utan haverier inte exakt reproducera deterministicTotal, och en bolåne-
      // liknande metod (där lånet aldrig amorteras) skulle kunna ge en negativ risktillägg
      // eftersom restvärdet krediterades fullt ut utan att netta mot kvarvarande låneskuld.
      const valueSeries = buildValueSeries(price, months, yearlyRates, path.resetMonths, ageAtPurchaseMonths, ageRateMultiplier);
      const pathEquity = valueSeries.map((value, t) => value - loan.balance[t]);
      const pathDepreciation = new Array(months + 1).fill(0);
      const pathKapitalkostnad = new Array(months + 1).fill(0);
      const pathLaneranta = new Array(months + 1).fill(0);
      for (let t = 1; t <= months; t++) {
        pathDepreciation[t] = -(valueSeries[t - 1] - valueSeries[t]);
        pathKapitalkostnad[t] = -(monthlyDiscountRate * pathEquity[t - 1]);
        pathLaneranta[t] = -loan.interest[t];
      }
      const pathSeries = [energy, tax, insurance, service, tires, pathDepreciation, pathKapitalkostnad, path.cashflow];
      if (financingMethod !== "kontant") pathSeries.push(pathLaneranta);
      const total = sumSeries(pathSeries);
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
 * Linjärt interpolerad årlig värdeminskningstakt mellan det år som innehåller
 * `ageYears` och nästa år, för att undvika ett abrupt hopp i takten vid varje årsskifte.
 */
function interpolatedAnnualRate(ageYears, yearlyRates) {
  const yearIdx = Math.max(Math.floor(ageYears), 0);
  const frac = ageYears - yearIdx;
  const rateCurrent = yearlyRates[Math.min(yearIdx, yearlyRates.length - 1)];
  const rateNext = yearlyRates[Math.min(yearIdx + 1, yearlyRates.length - 1)];
  return rateCurrent * (1 - frac) + rateNext * frac;
}

/** Andel av värdet som finns kvar efter en månad, vid given ålder (i år) mitt i den månaden. */
function smoothMonthlySurvivalFactor(ageYearsAtMidpoint, yearlyRates) {
  const annualRate = interpolatedAnnualRate(ageYearsAtMidpoint, yearlyRates);
  return Math.pow(1 - annualRate, 1 / 12);
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

  // Visa hela bilens liv (en rimlig totallivslängd), men förläng vid behov så att
  // ägandeperioden plus lite marginal efter försäljning alltid ryms.
  const fullLifeMonths = 18 * 12;
  const totalLifeMonths = Math.max(fullLifeMonths, ageAtPurchaseMonths + months + 24);

  // Bilens värde sedan tillverkning, byggt månad för månad och ankrat exakt i det kända
  // inköpspriset vid köpmånaden. Årstakten (yearlyRates) interpoleras linjärt mellan
  // intilliggande år istället för att växla abrupt vid varje årsskifte, så att kurvan
  // (och därmed värdeminskningen per månad) blir mjuk istället för att göra ett hopp var 12:e månad.
  const lifeValue = new Array(totalLifeMonths + 1);
  lifeValue[ageAtPurchaseMonths] = price;
  let forwardValue = price;
  for (let u = ageAtPurchaseMonths + 1; u <= totalLifeMonths; u++) {
    const effectiveAgePrev = ageAtPurchaseMonths + (u - 1 - ageAtPurchaseMonths) * ageRateMultiplier;
    const effectiveAgeCur = ageAtPurchaseMonths + (u - ageAtPurchaseMonths) * ageRateMultiplier;
    forwardValue *= smoothMonthlySurvivalFactor((effectiveAgePrev + effectiveAgeCur) / 2 / 12, yearlyRates);
    lifeValue[u] = forwardValue;
  }
  let backwardValue = price;
  for (let u = ageAtPurchaseMonths - 1; u >= 0; u--) {
    backwardValue /= smoothMonthlySurvivalFactor((u + u + 1) / 2 / 12, yearlyRates);
    lifeValue[u] = backwardValue;
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
      (winterIntervalMonths > 0 ? assumptions.tires.setCost / winterIntervalMonths : 0) +
      (summerIntervalMonths > 0 ? assumptions.tires.setCost / summerIntervalMonths : 0) +
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
