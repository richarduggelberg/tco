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
 * @returns {number[]} Längd months+1
 */
export function buildValueSeries(initialValue, months, yearlyRates, resetMonths = [], ageAtPurchaseMonths = 0) {
  const series = new Array(months + 1);
  let lastReset = 0;
  let resetIdx = 0;
  for (let t = 0; t <= months; t++) {
    while (resetIdx < resetMonths.length && resetMonths[resetIdx] === t) {
      lastReset = t;
      resetIdx++;
    }
    series[t] = valueAtAge(initialValue, t - lastReset, yearlyRates, ageAtPurchaseMonths);
  }
  return series;
}
