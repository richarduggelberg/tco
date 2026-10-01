// Värdeminskningsmodell: stegvis årlig värdeminskning som blir mindre brant med åldern.

/**
 * Beräknar bilens värde vid en given ålder (i månader), baserat på en lista
 * av årliga värdeminskningstakter (år 1, år 2, ...). Efter listans slut används
 * det sista värdet för alla efterföljande år.
 * @param {number} initialValue - Bilens värde vid ålder 0 (inköpspris eller nuvärde vid "återköp")
 * @param {number} ageMonths - Bilens ålder i månader
 * @param {number[]} yearlyRates - Årlig värdeminskningstakt per år, t.ex. [0.20, 0.15, 0.12, ...]
 * @returns {number} Bilens värde vid given ålder
 */
export function valueAtAge(initialValue, ageMonths, yearlyRates) {
  let value = initialValue;
  let monthsRemaining = ageMonths;
  let yearIndex = 0;

  while (monthsRemaining > 0) {
    const annualRate = yearlyRates[Math.min(yearIndex, yearlyRates.length - 1)];
    const monthlyRate = 1 - Math.pow(1 - annualRate, 1 / 12);
    const monthsThisYear = Math.min(12, monthsRemaining);
    for (let m = 0; m < monthsThisYear; m++) {
      value *= 1 - monthlyRate;
    }
    monthsRemaining -= monthsThisYear;
    yearIndex++;
  }

  return value;
}

/**
 * Bygger en array med bilens värde för varje månad 0..months (inklusive), givet
 * att åldern nollställs till 0 vid varje index i `resetMonths` (t.ex. pga totalhaveri
 * där en "ny" bil av samma ursprungliga värde köps in).
 * @param {number} initialValue
 * @param {number} months
 * @param {number[]} yearlyRates
 * @param {number[]} resetMonths - Sorterad lista av månadsindex där åldern nollställs
 * @returns {number[]} Längd months+1
 */
export function buildValueSeries(initialValue, months, yearlyRates, resetMonths = []) {
  const series = new Array(months + 1);
  let lastReset = 0;
  let resetIdx = 0;
  for (let t = 0; t <= months; t++) {
    while (resetIdx < resetMonths.length && resetMonths[resetIdx] === t) {
      lastReset = t;
      resetIdx++;
    }
    series[t] = valueAtAge(initialValue, t - lastReset, yearlyRates);
  }
  return series;
}
