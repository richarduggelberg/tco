import { test } from "node:test";
import assert from "node:assert/strict";
import { kontantCashflow, billanCashflow, bolanCashflow, leasingCashflow } from "../src/calc/financing.js";

test("kontantCashflow pays full price at t=0 and nothing else", () => {
  const cf = kontantCashflow(300000, 24);
  assert.equal(cf[0], -300000);
  assert.ok(cf.slice(1).every((v) => v === 0));
  assert.equal(cf.length, 25);
});

test("billanCashflow pays down payment at t=0 and amortizes to ~0 by end of term", () => {
  const months = 60;
  const cf = billanCashflow(300000, months, { downPaymentRatio: 0.2, interestRateAnnual: 0.07, termYears: 5 });
  assert.equal(cf[0], -60000);
  // All monthly payments should be roughly equal (annuity) and negative
  const payments = cf.slice(1);
  assert.ok(payments.every((p) => p < 0));
  const first = payments[0];
  const mid = payments[30];
  assert.ok(Math.abs(first - mid) < 1, "annuity payments should stay level");
});

test("billanCashflow settles remaining balance if holding period shorter than loan term", () => {
  const cf = billanCashflow(300000, 24, { downPaymentRatio: 0.2, interestRateAnnual: 0.07, termYears: 5 });
  // After 24 of 60 months, substantial balance remains and should be paid off at the end
  const lastPayment = cf[24];
  const regularPayment = cf[12];
  assert.ok(lastPayment < regularPayment, "final cashflow should include lump-sum remaining balance");
});

test("bolanCashflow applies interest-only-like low amortization, leaving balance at end", () => {
  const cf = bolanCashflow(300000, 24, { downPaymentRatio: 0, interestRateAnnual: 0.035, amortizationRateAnnual: 0.01 });
  assert.equal(Math.abs(cf[0]), 0);
  // With only 1%/year amortization over 2 years, most of the loan remains -> balance paid at t=months
  assert.ok(cf[24] < cf[12], "bolan cashflow at final month should include remaining debt settlement");
});

test("leasingCashflow charges a level monthly fee with no residual/ownership cashflow", () => {
  const cf = leasingCashflow(36, { monthlyFee: 4500, firstPaymentExtra: 0 });
  assert.equal(cf.length, 37);
  assert.equal(Math.abs(cf[0]), 0);
  assert.ok(cf.slice(1).every((v) => v === -4500));
});

test("leasingCashflow applies an extra first payment on top of the regular fee", () => {
  const cf = leasingCashflow(12, { monthlyFee: 4000, firstPaymentExtra: 15000 });
  assert.equal(cf[0], -15000);
  assert.equal(cf[1], -4000);
});
