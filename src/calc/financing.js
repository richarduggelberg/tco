import { annualToMonthlyRate } from "./npv.js";

/**
 * Bygger finansieringsrelaterade kassaflöden (handpenning/lånebetalningar/kvarstående skuld).
 * Löpande driftskostnader och restvärde hanteras separat i cashflow.js.
 * Returnerar en array av längd months+1, cashflow[0] = kostnad vid köptillfället.
 */

export function kontantCashflow(price, months) {
  const cf = new Array(months + 1).fill(0);
  cf[0] = -price;
  return cf;
}

function billanSchedule(price, months, { downPaymentRatio, interestRateAnnual, termYears }) {
  const downPayment = price * downPaymentRatio;
  const loanAmount = price - downPayment;
  const monthlyRate = annualToMonthlyRate(interestRateAnnual);
  const termMonths = Math.round(termYears * 12);
  const payment =
    monthlyRate === 0
      ? loanAmount / termMonths
      : (loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));

  const balance = new Array(months + 1).fill(0);
  const interest = new Array(months + 1).fill(0);
  const principal = new Array(months + 1).fill(0);
  balance[0] = loanAmount;
  let bal = loanAmount;
  for (let t = 1; t <= months; t++) {
    if (t <= termMonths && bal > 0.01) {
      const int = bal * monthlyRate;
      const princ = Math.min(payment - int, bal);
      bal -= princ;
      interest[t] = int;
      principal[t] = princ;
    }
    balance[t] = bal;
  }
  return { downPayment, balance, interest, principal };
}

export function billanCashflow(price, months, params) {
  const { downPayment, balance, interest, principal } = billanSchedule(price, months, params);
  const cf = new Array(months + 1).fill(0);
  cf[0] = -downPayment;
  for (let t = 1; t <= months; t++) {
    cf[t] -= interest[t] + principal[t];
  }
  // Om lånet inte är slutbetalt när innehavsperioden tar slut måste resterande
  // skuld lösas (t.ex. ur försäljningslikviden) - räknas som en kostnad då.
  if (balance[months] > 0.01) {
    cf[months] -= balance[months];
  }
  return cf;
}

/**
 * Lånebalans och räntedel per månad, för att kunna räkna fram låneränta och kvarvarande
 * eget kapital separat (se tco.js). Balansen sätts till 0 vid periodens slut om lånet inte
 * hunnit amorteras klart, eftersom resterande skuld då löses i samband med försäljningen.
 */
export function billanLoanSeries(price, months, params) {
  const { balance, interest } = billanSchedule(price, months, params);
  const adjustedBalance = balance.slice();
  if (adjustedBalance[months] > 0.01) adjustedBalance[months] = 0;
  return { balance: adjustedBalance, interest };
}

function bolanSchedule(price, months, { downPaymentRatio, interestRateAnnual }) {
  const downPayment = price * downPaymentRatio;
  const loanAmount = price - downPayment;
  const monthlyRate = annualToMonthlyRate(interestRateAnnual);
  const monthlyInterest = loanAmount * monthlyRate;

  const balance = new Array(months + 1).fill(loanAmount);
  const interest = new Array(months + 1).fill(0);
  for (let t = 1; t <= months; t++) {
    interest[t] = monthlyInterest;
  }
  return { downPayment, balance, interest };
}

export function bolanCashflow(price, months, params) {
  const { downPayment, interest } = bolanSchedule(price, months, params);
  const cf = new Array(months + 1).fill(0);
  cf[0] = -downPayment;
  // Amortering är ingen verklig kostnad (den bygger bara upp eget kapital du behåller),
  // så lånet antas aldrig amorteras här - bara en platt ränta på hela lånebeloppet räknas.
  for (let t = 1; t <= months; t++) {
    cf[t] -= interest[t];
  }
  return cf;
}

/** Lånebalans (konstant, inget amorteras) och räntedel per månad för bolån. */
export function bolanLoanSeries(price, months, params) {
  const { balance, interest } = bolanSchedule(price, months, params);
  return { balance, interest };
}

/**
 * Lånebalans/räntedel per månad för given finansieringsmetod. Kontant/leasing har inget lån
 * (allt eget kapital = bilens värde), så balans och ränta är 0 för alla månader.
 */
export function loanSeries(method, price, months, financingAssumptions) {
  if (method === "billan") return billanLoanSeries(price, months, financingAssumptions.billan);
  if (method === "bolan") return bolanLoanSeries(price, months, financingAssumptions.bolan);
  return { balance: new Array(months + 1).fill(0), interest: new Array(months + 1).fill(0) };
}

/**
 * Privatleasing: fast månadsavgift, ingen handpenning (ev. förhöjd första avgift).
 * Användaren äger aldrig bilen - leasingbolaget bär värdeminsknings- och haveririsken,
 * vilket hanteras i tco.js genom att restvärde och risk exkluderas för denna metod.
 */
export function leasingCashflow(months, { monthlyFee, firstPaymentExtra }) {
  const cf = new Array(months + 1).fill(-monthlyFee);
  cf[0] = -firstPaymentExtra;
  return cf;
}

export function financingCashflow(method, price, months, financingAssumptions) {
  switch (method) {
    case "kontant":
      return kontantCashflow(price, months);
    case "billan":
      return billanCashflow(price, months, financingAssumptions.billan);
    case "bolan":
      return bolanCashflow(price, months, financingAssumptions.bolan);
    case "leasing":
      return leasingCashflow(months, financingAssumptions.leasing);
    default:
      throw new Error(`Okänd finansieringsmetod: ${method}`);
  }
}
