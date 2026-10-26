// Värdeminskningsmodell: stegvis årlig värdeminskning som blir mindre brant med åldern.

/**
 * Kumulativ andel av bilens värde (som nytillverkad, ålder 0) som återstår vid en
 * given kalenderålder. Används för att korrekt applicera rätt del av kurvan även
 * när bilen redan var begagnad vid köptillfället (se valueAtAge).
 * @param {number} totalAgeMonths - Kalenderålder i månader sedan tillverkning
 * @param {number[]} yearlyRates
 * @returns {number} Andel kvar av nyvärdet (1.0 = inget värdetapp än)
 */
function remainingValueFactor(totalAgeMonths, yearlyRates) {
  let factor = 1;
  let monthsRemaining = totalAgeMonths;
  let yearIndex = 0;

  while (monthsRemaining > 0) {
    const annualRate = yearlyRates[Math.min(yearIndex, yearlyRates.length - 1)];
    const monthlyRate = 1 - Math.pow(1 - annualRate, 1 / 12);
    const monthsThisYear = Math.min(12, monthsRemaining);
    factor *= Math.pow(1 - monthlyRate, monthsThisYear);
    monthsRemaining -= monthsThisYear;
    yearIndex++;
  }

  return factor;
}

/**
 * Räknar baklänges från ett känt pris vid en given kalenderålder till det implicita
 * nypriset, genom att invertera värdeminskningskurvan. Används för att visa ett
 * uppskattat "nypris" när användaren anger ett inköpspris för en redan begagnad bil.
 * @param {number} priceAtAge - Känt pris vid ageAtPurchaseMonths
 * @param {number} ageAtPurchaseMonths - Bilens kalenderålder vid det kända priset
 * @param {number[]} yearlyRates
 * @returns {number} Uppskattat pris vid ålder 0 (nypris)
 */
export function impliedNewPrice(priceAtAge, ageAtPurchaseMonths, yearlyRates) {
  if (ageAtPurchaseMonths <= 0) return priceAtAge;
  return priceAtAge / remainingValueFactor(ageAtPurchaseMonths, yearlyRates);
}

/**
 * Beräknar bilens värde vid en given ålder (i månader sedan referenspunkten), baserat
 * på en lista av årliga värdeminskningstakter (år 1, år 2, ... sedan TILLVERKNING).
 * Efter listans slut används det sista värdet för alla efterföljande år.
 * @param {number} initialValue - Bilens värde vid ageMonths=0 (t.ex. inköpspris)
 * @param {number} ageMonths - Antal månader sedan referenspunkten (köp eller senaste återköp)
 * @param {number[]} yearlyRates - Årlig värdeminskningstakt per år, t.ex. [0.20, 0.15, 0.12, ...]
 * @param {number} ageAtReferenceMonths - Bilens kalenderålder (sedan tillverkning) vid ageMonths=0.
 *   Används för att applicera rätt (flackare) del av kurvan om bilen redan var begagnad.
 * @returns {number} Bilens värde vid given ålder
 */
export function valueAtAge(initialValue, ageMonths, yearlyRates, ageAtReferenceMonths = 0) {
  if (ageAtReferenceMonths === 0) {
    return initialValue * remainingValueFactor(ageMonths, yearlyRates);
  }
  const factorAtReference = remainingValueFactor(ageAtReferenceMonths, yearlyRates);
  const factorAtTarget = remainingValueFactor(ageAtReferenceMonths + ageMonths, yearlyRates);
  return initialValue * (factorAtTarget / factorAtReference);
}

/**
 * Bygger en array med bilens värde för varje månad 0..months (inklusive), givet
 * att åldern nollställs till 0 vid varje index i `resetMonths` (t.ex. pga totalhaveri
 * där en likvärdig bil av samma ursprungliga värde och kalenderålder köps in igen).
 * @param {number} initialValue
 * @param {number} months
 * @param {number[]} yearlyRates
 * @param {number[]} resetMonths - Sorterad lista av månadsindex där åldern nollställs
 * @param {number} ageAtPurchaseMonths - Bilens kalenderålder vid ursprungligt köp (0 = nyköpt)
 * @param {number} ageRateMultiplier - Hur snabbt bilen "åldras" per kalendermånad (1 = normalt,
 *   >1 för en högkörd bil, <1 för en lågkörd bil - se vehicleAge-antagandena)
 * @returns {number[]} Längd months+1
 */
export function buildValueSeries(initialValue, months, yearlyRates, resetMonths = [], ageAtPurchaseMonths = 0, ageRateMultiplier = 1) {
  const series = new Array(months + 1);
  let lastReset = 0;
  let resetIdx = 0;
  for (let t = 0; t <= months; t++) {
    while (resetIdx < resetMonths.length && resetMonths[resetIdx] === t) {
      lastReset = t;
      resetIdx++;
    }
    series[t] = valueAtAge(initialValue, (t - lastReset) * ageRateMultiplier, yearlyRates, ageAtPurchaseMonths);
  }
  return series;
}

/** Högsta tillåtna årsvärdeminskningstakt efter justering (undviker att 1 - rate blir <= 0). */
const MAX_EFFECTIVE_ANNUAL_RATE = 0.99;

/**
 * Skalar värdeminskningskurvan med en konstant faktor. Alla bilar värdeminskar inte i samma
 * takt, så användaren kan snabba på eller bromsa HELA kurvan (t.ex. 1.5 = 50% snabbare
 * värdetapp, 0.7 = 30% långsammare) istället för att redigera varje årstakt.
 * @param {number[]} yearlyRates - Basens årliga värdeminskningstakter
 * @param {number} rateMultiplier - 0 = ingen värdeminskning, 1 = standardkurvan
 * @returns {number[]} Justerade årstakter
 */
export function scaledYearlyRates(yearlyRates, rateMultiplier = 1) {
  if (!(rateMultiplier >= 0) || rateMultiplier === 1) return yearlyRates;
  return yearlyRates.map((rate) => Math.min(Math.max(rate * rateMultiplier, 0), MAX_EFFECTIVE_ANNUAL_RATE));
}

/** Bilens värde vid slutet av en period om `months` månader, givet en viss kurva. */
function valueAfterMonths(initialValue, months, yearlyRates, ageAtPurchaseMonths, ageRateMultiplier) {
  const series = buildValueSeries(initialValue, months, yearlyRates, [], ageAtPurchaseMonths, ageRateMultiplier);
  return series[months];
}

/**
 * Räknar BAKLÄNGES från ett önskat restvärde till den justeringsfaktor på värdeminsknings-
 * kurvan som ger exakt det restvärdet vid ägandeperiodens slut. Kurvan behåller sin form
 * (dyrast värdetapp tidigt, flackare senare) men blir brantare eller flackare som helhet.
 *
 * Värdet vid periodens slut är monotont avtagande i faktorn, så lösningen tas fram med
 * bisektion: faktor 0 ger inköpspriset kvar, och ju högre faktor desto närmare noll går värdet.
 *
 * @param {object} input
 * @param {number} input.initialValue - Inköpspris (bilens värde vid köpet)
 * @param {number} input.months - Ägandeperiodens längd i månader
 * @param {number[]} input.yearlyRates - Basens årliga värdeminskningstakter
 * @param {number} input.targetResidual - Önskat restvärde (kr) vid periodens slut
 * @param {number} [input.ageAtPurchaseMonths] - Bilens kalenderålder vid köpet
 * @param {number} [input.ageRateMultiplier] - Körsträcke-viktad åldringsfaktor (1 = normalt)
 * @param {number} [input.maxMultiplier] - Tak för hur brant kurvan får bli
 * @returns {{rateMultiplier: number, feasible: boolean, residualValue: number}} Lösningen,
 *   om målet gick att nå och vilket restvärde kurvan faktiskt ger (samma som målet när
 *   `feasible` är true)
 */
export function solveRateMultiplierForResidual({
  initialValue,
  months,
  yearlyRates,
  targetResidual,
  ageAtPurchaseMonths = 0,
  ageRateMultiplier = 1,
  maxMultiplier = 100,
}) {
  const valueAt = (rateMultiplier) =>
    valueAfterMonths(initialValue, months, scaledYearlyRates(yearlyRates, rateMultiplier), ageAtPurchaseMonths, ageRateMultiplier);

  if (!(targetResidual > 0) || !(initialValue > 0) || !(months > 0)) {
    return { rateMultiplier: 1, feasible: false, residualValue: valueAt(1) };
  }
  // Ett restvärde över inköpspriset skulle kräva negativ värdeminskning (bilen blir värd mer).
  if (targetResidual >= initialValue) {
    return { rateMultiplier: 0, feasible: false, residualValue: valueAt(0) };
  }

  let lo = 0; // valueAt(lo) >= target (vid 0 är värdet kvar = inköpspriset)
  let hi = 1;
  while (hi < maxMultiplier && valueAt(hi) > targetResidual) hi *= 2;
  hi = Math.min(hi, maxMultiplier);
  if (valueAt(hi) > targetResidual) {
    // Även den brantaste tillåtna kurvan lämnar ett värde över målet - använd den ändå.
    return { rateMultiplier: hi, feasible: false, residualValue: valueAt(hi) };
  }

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (valueAt(mid) > targetResidual) lo = mid;
    else hi = mid;
  }
  const rateMultiplier = (lo + hi) / 2;
  return { rateMultiplier, feasible: true, residualValue: valueAt(rateMultiplier) };
}
