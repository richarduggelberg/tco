import { test } from "node:test";
import assert from "node:assert/strict";
import { presentValue, levelMonthlyPayment, annualToMonthlyRate } from "../src/calc/npv.js";

test("presentValue of a single cashflow at t=0 equals that cashflow", () => {
  assert.equal(presentValue([-1000], 0.01), -1000);
});

test("presentValue discounts future cashflows (less negative impact further out)", () => {
  const nearNpv = presentValue([0, -1000], 0.01);
  const farNpv = presentValue([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1000], 0.01);
  assert.ok(farNpv > nearNpv, "a cost further in the future should have a smaller (less negative) NPV");
});

test("levelMonthlyPayment on a simple loan matches standard annuity formula", () => {
  // Lån 100 000 kr, 1% månadsränta, 12 månader -> jämför med manuell annuitetsformel
  const principal = 100000;
  const rate = 0.01;
  const months = 12;
  const npv = -principal;
  const payment = levelMonthlyPayment(npv, rate, months);
  const expected = (principal * rate) / (1 - Math.pow(1 + rate, -months));
  assert.ok(Math.abs(payment - expected) < 1e-9);
});

test("levelMonthlyPayment with zero rate is a simple division", () => {
  const payment = levelMonthlyPayment(-1200, 0, 12);
  assert.equal(payment, 100);
});

test("annualToMonthlyRate compounds correctly over a year", () => {
  const annual = 0.12;
  const monthly = annualToMonthlyRate(annual);
  const compounded = Math.pow(1 + monthly, 12) - 1;
  assert.ok(Math.abs(compounded - annual) < 1e-9);
});
