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

export function billanCashflow(price, months, { downPaymentRatio, interestRateAnnual, termYears }) {
  const cf = new Array(months + 1).fill(0);
  const downPayment = price * downPaymentRatio;
  const loanAmount = price - downPayment;
  const monthlyRate = annualToMonthlyRate(interestRateAnnual);
  const termMonths = Math.round(termYears * 12);

  cf[0] = -downPayment;

  const payment =
    monthlyRate === 0
      ? loanAmount / termMonths
      : (loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));

  let balance = loanAmount;
  for (let t = 1; t <= months; t++) {
    if (t <= termMonths && balance > 0.01) {
      const interest = balance * monthlyRate;
      const principal = Math.min(payment - interest, balance);
      balance -= principal;
      cf[t] -= interest + principal;
    }
  }
  // Om lånet inte är slutbetalt när innehavsperioden tar slut måste resterande
  // skuld lösas (t.ex. ur försäljningslikviden) - räknas som en kostnad då.
  if (balance > 0.01) {
    cf[months] -= balance;
  }
  return cf;
}

export function bolanCashflow(price, months, { downPaymentRatio, interestRateAnnual, amortizationRateAnnual }) {
  const cf = new Array(months + 1).fill(0);
  const downPayment = price * downPaymentRatio;
  const loanAmount = price - downPayment;
  const monthlyRate = annualToMonthlyRate(interestRateAnnual);
  const monthlyAmortization = (loanAmount * amortizationRateAnnual) / 12;

  cf[0] = -downPayment;

  let balance = loanAmount;
  for (let t = 1; t <= months; t++) {
    if (balance > 0.01) {
      const interest = balance * monthlyRate;
      const amortization = Math.min(monthlyAmortization, balance);
      balance -= amortization;
      cf[t] -= interest + amortization;
    }
  }
  // Bolån amorteras ofta långsamt - kvarstående skuld vid periodens slut är en
  // reell kostnad som fortsätter att belasta låntagaren efter att bilen sålts.
  if (balance > 0.01) {
    cf[months] -= balance;
  }
  return cf;
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
