import { financingCashflow, loanSeries } from "./financing.js";
import { buildValueSeries, scaledYearlyRates, solveRateMultiplierForResidual } from "./depreciation.js";
import { simulateRiskPaths, weibullHazard } from "./risk.js";
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

/** Felfunktionen (erf), Abramowitz & Stegun 7.1.26-approximation (|fel| < 1.5e-7). */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

/** Kumulativ fördelningsfunktion för standardnormalfördelningen. */
function standardNormalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Sannolikheter (fallande) som ska markeras på livscykeldiagrammets överlevnadskurva. */
const SURVIVAL_MILESTONES = [0.5, 0.25, 0.1, 0.05, 0.01];

/**
 * Hur snabbt bilen "åldras" per kalendermånad (1 = normalt), utifrån antagen körsträcka.
 * En högkörd bil åldras snabbare (värdemässigt OCH haverimässigt), en lågkörd långsammare.
 */
export function mileageAgeRateMultiplier(assumptions) {
  const { baselineAnnualMileageKm, mileageWeight } = assumptions.vehicleAge;
  const mileageRatio = assumptions.annualMileageKm / baselineAnnualMileageKm;
  return mileageWeight * mileageRatio + (1 - mileageWeight);
}

/**
 * Löser upp vilken värdeminskningskurva som ska användas för en kalkyl:
 * - Om ett restvärde angetts (assumptions.depreciation.residualTarget) räknas kurvans
 *   justeringsfaktor BAKLÄNGES så att värdet vid ägandeperiodens slut blir exakt det.
 * - Annars används användarens justeringsfaktor (assumptions.depreciation.rateMultiplier).
 * Returnerar den redan skalade kurvan plus uppgifter om kalibreringen, så att både
 * kalkylen och UI:t beskriver samma sak.
 * @param {object} input - { price, months, assumptions }
 * @returns {{yearlyRates: number[], rateMultiplier: number, calibrated: boolean,
 *   feasible: boolean, residualTarget: number|null, ageAtPurchaseMonths: number,
 *   ageRateMultiplier: number}}
 */
export function resolveDepreciation({ price, months, assumptions }) {
  const { yearlyRates, rateMultiplier = 1, residualTarget } = assumptions.depreciation;
  const ageAtPurchaseMonths = Math.round((assumptions.ageAtPurchaseYears ?? 0) * 12);
  const ageRateMultiplier = mileageAgeRateMultiplier(assumptions);
  const context = { ageAtPurchaseMonths, ageRateMultiplier };

  if (!(residualTarget > 0)) {
    return {
      ...context,
      yearlyRates: scaledYearlyRates(yearlyRates, rateMultiplier),
      rateMultiplier,
      calibrated: false,
      feasible: true,
      residualTarget: null,
    };
  }

  const solution = solveRateMultiplierForResidual({
    initialValue: price,
    months,
    yearlyRates,
    targetResidual: residualTarget,
    ageAtPurchaseMonths,
    ageRateMultiplier,
  });
  return {
    ...context,
    yearlyRates: scaledYearlyRates(yearlyRates, solution.rateMultiplier),
    rateMultiplier: solution.rateMultiplier,
    calibrated: true,
    feasible: solution.feasible,
    residualTarget,
  };
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
 * @returns {object} Resultat med kategoriuppdelad deterministisk månadskostnad, ev. riskstatistik
 *   samt (för ägda bilar) restvärde vid ägandeperiodens slut och förlorat värde sedan köpet
 */
export function computeTco({ price, months, financingMethod, assumptions }) {
  const monthlyDiscountRate = annualToMonthlyRate(assumptions.discountRateAnnual);
  // Värdeminskningskurvan: användarens justeringsfaktor, eller - om ett restvärde angetts -
  // den faktor som får kurvan att landa exakt på restvärdet vid ägandeperiodens slut.
  const depreciation = resolveDepreciation({ price, months, assumptions });
  const { yearlyRates, ageAtPurchaseMonths, ageRateMultiplier } = depreciation;
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
  // Restvärde och värdeminskning är bara meningsfulla när man äger bilen själv - vid leasing
  // bär leasingbolaget värdeminskningen och användaren har ingen bil att sälja vid periodens slut.
  let residualValue = null;
  let valueLost = null;
  if (isLeasing) {
    categorySeries.leasingavgift = financing;
  } else {
    // Deterministisk bas: ingen risk inträffar, bilen åldras utan avbrott. Kapitalkostnaden
    // räknas på eget kapital (bilens värde minus kvarvarande låneskuld), så den minskar
    // naturligt i takt med att bilen tappar värde och/eller lånet amorteras.
    const baseValueSeries = buildValueSeries(price, months, yearlyRates, [], ageAtPurchaseMonths, ageRateMultiplier);
    // Bilens marknadsvärde vid ägandeperiodens slut (det du kan sälja den för) och hur mycket
    // värde som gått förlorat sedan köpet (samma kurva som värdeminskningsposten bygger på).
    residualValue = baseValueSeries[months];
    valueLost = price - residualValue;
    const equity = baseValueSeries.map((value, t) => value - loan.balance[t]);

    const depreciation = new Array(months + 1).fill(0);
    const kapitalkostnad = new Array(months + 1).fill(0);
    const laneranta = new Array(months + 1).fill(0);
    for (let t = 1; t <= months; t++) {
      depreciation[t] = -(baseValueSeries[t - 1] - baseValueSeries[t]);
      // Negativt eget kapital (lånet större än bilens värde, t.ex. bolån utan kontantinsats)
      // är redan en kostnad via låneräntan - ska inte dessutom ge en negativ kapitalkostnad.
      kapitalkostnad[t] = -(monthlyDiscountRate * Math.max(equity[t - 1], 0));
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
        pathKapitalkostnad[t] = -(monthlyDiscountRate * Math.max(pathEquity[t - 1], 0));
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

  return {
    categoryMonthly,
    deterministicTotal,
    risk,
    residualValue,
    valueLost,
    // Hur värdeminskningskurvan kom till: om ett restvärde angetts och om det i så fall gick
    // att nå (ett restvärde över inköpspriset är inte möjligt). rateMultiplier = kurvans
    // justeringsfaktor mot standardkurvan (1 = oförändrad).
    depreciationModel: {
      rateMultiplier: depreciation.rateMultiplier,
      calibrated: depreciation.calibrated,
      feasible: depreciation.feasible,
    },
  };
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
 * Bygger bilens värde månad för månad sedan tillverkning (ankrat i det kända priset vid
 * ageAtPurchaseMonths), för en given total livslängd i månader.
 */
function buildLifeValue(totalLifeMonths, ageAtPurchaseMonths, price, yearlyRates, ageRateMultiplier) {
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
  return lifeValue;
}

/** Bilens "ekvivalenta" (körsträcke-viktade) ålder vid kalenderålder u sedan tillverkning. */
function equivalentAgeMonthsAt(u, ageAtPurchaseMonths, ageRateMultiplier) {
  if (u <= ageAtPurchaseMonths) return u;
  return ageAtPurchaseMonths + (u - ageAtPurchaseMonths) * ageRateMultiplier;
}

/**
 * Bygger två kurvor månad för månad, sedan tillverkning: dels sannolikheten att bilen ÄNNU
 * INTE haft ett ekonomiskt totalhaveri ("överlever" som fungerande bil), dels den förväntade
 * riskkostnaden den månaden. Båda bygger på samma hazard (Weibull, samma modell som i risk.js)
 * och samma sannolikhet att en reparationshändelse blir ett totalhaveri (reparationskostnad >
 * tröskel * bilens då aktuella värde, där reparationskostnaden antas log-normalfördelad kring
 * repairCostMedian). Vid ett totalhaveri ersätts bilen med en likvärdig bil till SAMMA pris som
 * angetts för denna simulering (som i risk.js: man köper en ny bil av det slag/ålder man
 * ursprungligen ville ha, inte en bil av bilens nuvarande - mer slitna - ålder).
 */
function buildSurvivalAndRiskCost(totalLifeMonths, lifeValue, price, ageAtPurchaseMonths, ageRateMultiplier, risk) {
  const survival = new Array(totalLifeMonths + 1);
  const expectedRiskMonthly = new Array(totalLifeMonths + 1).fill(0);
  survival[0] = 1;
  for (let t = 1; t <= totalLifeMonths; t++) {
    const equivalentAge = equivalentAgeMonthsAt(t, ageAtPurchaseMonths, ageRateMultiplier);
    const hazard = Math.min(Math.max(weibullHazard(equivalentAge, risk.weibullShape, risk.weibullScaleMonths) * risk.reliabilityFactor, 0), 1);
    const thresholdValue = risk.totalLossThreshold * Math.max(lifeValue[t], 1);
    const z = Math.log(thresholdValue / risk.repairCostMedian) / risk.repairCostSigma;
    const probTotalLoss = 1 - standardNormalCdf(z);
    // E[reparationskostnad; reparationskostnad <= tröskel] för log-normal (median M, sigma s) = M*exp(s^2/2)*Φ(z-s).
    const expectedRepairIfNotTotalLoss = risk.repairCostMedian * Math.exp((risk.repairCostSigma * risk.repairCostSigma) / 2) * standardNormalCdf(z - risk.repairCostSigma);
    const expectedCostGivenEvent = expectedRepairIfNotTotalLoss + probTotalLoss * price;
    const totalLossProb = Math.min(Math.max(hazard * probTotalLoss, 0), 1);
    survival[t] = survival[t - 1] * (1 - totalLossProb);
    expectedRiskMonthly[t] = hazard * expectedCostGivenEvent;
  }
  return { survival, expectedRiskMonthly };
}

/** Finner (via linjär interpolation) åldern i år där överlevnadskurvan först korsar en given sannolikhet. */
function findSurvivalAgeYears(survival, targetProbability) {
  for (let t = 1; t < survival.length; t++) {
    if (survival[t] <= targetProbability) {
      const prev = survival[t - 1];
      const frac = prev === survival[t] ? 0 : (prev - targetProbability) / (prev - survival[t]);
      return (t - 1 + frac) / 12;
    }
  }
  return null; // Nås inte inom den beräknade livslängden
}

/**
 * Bygger en nominell (ej nuvärdesberäknad) månadskostnadskurva över bilens HELA liv
 * (sedan tillverkning), uppdelad i sina beståndsdelar (components) så att den kan staplas
 * i grafen. Drift-/åldersrelaterade poster (bränsle/el, skatt, försäkring, service, däck,
 * värdeminskning, haveririsk) visas genom hela kurvan. Under den egna ägandeperioden (
 * markerad med de två brytpunkterna som returneras) används den valda finansieringsmetoden;
 * utanför den antas samma finansieringsmetod (utom leasing, som bara finns under
 * ägandetiden), så kapitalkostnaden speglar vald finansiering även för en hypotetisk ägare
 * vid den åldern.
 * @param {object} input - { price, months, financingMethod, assumptions }
 * @returns {{ ageYears: number[], monthlyCost: number[], riskMonthly: number[], components: object, purchaseAgeYears: number, endOfOwnershipAgeYears: number, survivalMilestones: object[], depreciationModel: object }}
 */
export function computeLifetimeMonthlyCosts({ price, months, financingMethod, assumptions }) {
  // Samma (ev. restvärde-kalibrerade) värdeminskningskurva som i computeTco, så att
  // livscykelkurvan och den jämförbara månadskostnaden bygger på samma antaganden.
  const depreciationModel = resolveDepreciation({ price, months, assumptions });
  const { yearlyRates, ageAtPurchaseMonths, ageRateMultiplier } = depreciationModel;
  const isLeasing = financingMethod === "leasing";
  const monthlyDiscountRate = annualToMonthlyRate(assumptions.discountRateAnnual);

  // Visa hela bilens liv, men inte längre än till DUBBLA den antagna livslängden
  // (weibullScaleMonths = "Förväntad livslängd" i UI:t) - längre än så är inte realistiskt.
  // Se dock till att ägandeperioden plus lite marginal efter försäljning alltid ryms.
  const assumedLifespanMonths = assumptions.risk.weibullScaleMonths;
  const totalLifeMonths = Math.max(2 * assumedLifespanMonths, ageAtPurchaseMonths + months + 24);
  const lifeValue = buildLifeValue(totalLifeMonths, ageAtPurchaseMonths, price, yearlyRates, ageRateMultiplier);
  const { survival, expectedRiskMonthly } = buildSurvivalAndRiskCost(totalLifeMonths, lifeValue, price, ageAtPurchaseMonths, ageRateMultiplier, assumptions.risk);
  const survivalMilestones = SURVIVAL_MILESTONES.map((probability) => ({
    probability,
    ageYears: findSurvivalAgeYears(survival, probability),
  })).filter((m) => m.ageYears !== null);

  const energyMonthly = computeEnergyMonthly(assumptions.annualMileageKm, assumptions.running);
  const winterIntervalMonths = Math.round(assumptions.tires.winterIntervalYears * 12);
  const summerIntervalMonths = Math.round(assumptions.tires.summerIntervalYears * 12);
  const winterTiresMonthly = winterIntervalMonths > 0 ? assumptions.tires.setCost / winterIntervalMonths : 0;
  // Leasingavgiften bakar ofta in service/vinterdäck - dubbelräkna inte dem under leasingperioden.
  const serviceBundled = isLeasing && assumptions.financing.leasing.serviceIncluded;
  const winterTiresBundled = isLeasing && assumptions.financing.leasing.winterTiresIncluded;

  const loan = isLeasing ? null : loanSeries(financingMethod, price, months, assumptions.financing);
  const leasingCf = isLeasing ? financingCashflow(financingMethod, price, months, assumptions.financing) : null;
  const summerTiresMonthly = summerIntervalMonths > 0 ? assumptions.tires.setCost / summerIntervalMonths : 0;

  // Kapitalkostnad utanför din ägandeperiod: samma finansieringsmetod som valts (utom leasing,
  // som bara finns under ägandetiden). Modelleras som en "färsk" finansiering av bilen vid den
  // åldern: kontant -> bara alternativkostnad; billån/bolån -> alternativkostnad på
  // kontantinsatsen plus ränta på den finansierade delen.
  const financingCapitalRate = (() => {
    if (financingMethod === "kontant" || isLeasing) return monthlyDiscountRate;
    const params = assumptions.financing[financingMethod];
    const downPaymentRatio = params.downPaymentRatio ?? 1;
    return (
      monthlyDiscountRate * downPaymentRatio +
      annualToMonthlyRate(params.interestRateAnnual) * (1 - downPaymentRatio)
    );
  })();

  const components = {
    energy: [],
    tax: [],
    insurance: [],
    service: [],
    tires: [],
    depreciation: [],
    capitalCost: [],
    risk: [],
    leasing: [],
  };
  const ageYears = [];
  const monthlyCost = [];
  const riskMonthly = [];
  for (let t = 1; t <= totalLifeMonths; t++) {
    const calendarAgeYears = t / 12;
    const valuePrev = lifeValue[t - 1];
    const depreciationCost = valuePrev - lifeValue[t];
    const capitalCostBaseline = monthlyDiscountRate * valuePrev;

    let energyC = energyMonthly;
    let taxC = taxMonthlyCost(calendarAgeYears, assumptions.tax);
    let insuranceC = insuranceMonthlyCost(calendarAgeYears, assumptions.insurance);
    let serviceC = assumptions.running.serviceMonthly;
    let tiresC = winterTiresMonthly + summerTiresMonthly;
    let depreciationC = depreciationCost;
    let capitalC = capitalCostBaseline;
    let riskC = expectedRiskMonthly[t];
    let leasingC = 0;

    const monthsSincePurchase = t - ageAtPurchaseMonths;
    const ownedThisMonth = monthsSincePurchase >= 1 && monthsSincePurchase <= months;
    if (ownedThisMonth) {
      if (isLeasing) {
        // Leasingavgiften ersätter värdeminskning, kapitalkostnad och haveririsk (som
        // leasingbolaget bär) samt ev. service/vinterdäck som ingår i avgiften.
        if (serviceBundled) serviceC = 0;
        if (winterTiresBundled) tiresC = summerTiresMonthly;
        leasingC = -leasingCf[monthsSincePurchase];
        depreciationC = 0;
        capitalC = 0;
        riskC = 0;
      } else {
        const equityPrev = valuePrev - loan.balance[monthsSincePurchase - 1];
        capitalC = monthlyDiscountRate * equityPrev + loan.interest[monthsSincePurchase];
      }
    } else if (!isLeasing) {
      // Utanför ägandeperioden: behåll vald finansiering istället för att falla tillbaka på kontant.
      capitalC = financingCapitalRate * valuePrev;
    }

    components.energy.push(energyC);
    components.tax.push(taxC);
    components.insurance.push(insuranceC);
    components.service.push(serviceC);
    components.tires.push(tiresC);
    components.depreciation.push(depreciationC);
    components.capitalCost.push(capitalC);
    components.risk.push(riskC);
    components.leasing.push(leasingC);

    ageYears.push(t / 12);
    monthlyCost.push(energyC + taxC + insuranceC + serviceC + tiresC + depreciationC + capitalC + riskC + leasingC);
    riskMonthly.push(expectedRiskMonthly[t]);
  }

  return {
    ageYears,
    monthlyCost,
    riskMonthly,
    components,
    purchaseAgeYears: ageAtPurchaseMonths / 12,
    endOfOwnershipAgeYears: (ageAtPurchaseMonths + months) / 12,
    survivalMilestones,
    depreciationModel,
  };
}
