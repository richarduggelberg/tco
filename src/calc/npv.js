// Nuvärdesberäkning och konvertering till jämförbar (nivålagd) månadskostnad.

/**
 * Beräknar nuvärdet (NPV) av en serie kassaflöden.
 * @param {number[]} cashflows - cashflows[0] är vid tidpunkt 0 (idag), cashflows[i] vid månad i.
 *   Negativa värden = kostnad, positiva = inbetalning (t.ex. restvärde vid försäljning).
 * @param {number} monthlyRate - diskonteringsränta per månad (decimal, t.ex. 0.05/12).
 * @returns {number} NPV
 */
export function presentValue(cashflows, monthlyRate) {
  let npv = 0;
  for (let t = 0; t < cashflows.length; t++) {
    npv += cashflows[t] / Math.pow(1 + monthlyRate, t);
  }
  return npv;
}

/**
 * Konverterar ett nuvärde till en nivålagd (konstant) kostnad per månad över n månader,
 * dvs den "jämförbara månadskostnaden" (equivalent annual/monthly cost).
 * @param {number} npv - Nuvärde av kassaflödena (negativt för en kostnad)
 * @param {number} monthlyRate - diskonteringsränta per månad
 * @param {number} months - antal månader kostnaden ska spridas över
 * @returns {number} Månadskostnad (positiv siffra = kostnad)
 */
export function levelMonthlyPayment(npv, monthlyRate, months) {
  const cost = -npv; // Vi vill uttrycka kostnad som ett positivt tal
  if (monthlyRate === 0) {
    return cost / months;
  }
  const factor = monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
  return cost * factor;
}

/** Konverterar en årsränta till motsvarande månadsränta (compound, inte linjär delning). */
export function annualToMonthlyRate(annualRate) {
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}
