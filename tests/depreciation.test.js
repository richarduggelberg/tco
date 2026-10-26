import { test } from "node:test";
import assert from "node:assert/strict";
import { valueAtAge, buildValueSeries, impliedNewPrice, scaledYearlyRates, solveRateMultiplierForResidual } from "../src/calc/depreciation.js";

test("valueAtAge at age 0 equals initial value", () => {
  assert.equal(valueAtAge(300000, 0, [0.2, 0.15]), 300000);
});

test("valueAtAge decreases monotonically with age", () => {
  const rates = [0.2, 0.15, 0.12, 0.1];
  let prev = valueAtAge(300000, 0, rates);
  for (let m = 1; m <= 48; m++) {
    const v = valueAtAge(300000, m, rates);
    assert.ok(v < prev, `value should decrease at month ${m}`);
    prev = v;
  }
});

test("valueAtAge approximates annual rate after exactly one year", () => {
  const value = valueAtAge(100000, 12, [0.2]);
  assert.ok(Math.abs(value - 80000) < 1, `expected ~80000, got ${value}`);
});

test("valueAtAge uses last rate in list once past its length", () => {
  const rates = [0.2, 0.1];
  const atYear2 = valueAtAge(100000, 24, rates);
  const atYear3 = valueAtAge(100000, 36, rates);
  // Year 3 should use the same 0.1 rate as year 2 (last rate repeats)
  const expectedYear3 = atYear2 * 0.9;
  assert.ok(Math.abs(atYear3 - expectedYear3) < 1);
});

test("buildValueSeries resets age at specified reset months", () => {
  const rates = [0.2, 0.15];
  const series = buildValueSeries(100000, 24, rates, [12]);
  // At month 12, value resets to 100000 (bought an equivalent car again)
  assert.equal(series[12], 100000);
  // At month 24 (12 months after reset), should equal valueAtAge(100000, 12, rates)
  assert.ok(Math.abs(series[24] - valueAtAge(100000, 12, rates)) < 1e-6);
});

test("valueAtAge with ageAtReferenceMonths=0 is unchanged from the simple case", () => {
  const rates = [0.2, 0.15, 0.12, 0.1];
  assert.equal(valueAtAge(100000, 18, rates, 0), valueAtAge(100000, 18, rates));
});

test("valueAtAge for a used car applies the flatter later-year depreciation curve from month 0", () => {
  const rates = [0.2, 0.15, 0.12, 0.1, 0.08];
  // A car bought at calendar age 24 months should depreciate at year-3 rates immediately,
  // not restart at the steep year-1 rate.
  const usedCarValue = valueAtAge(100000, 12, rates, 24);
  // Equivalent to: value of a new car at month 36 relative to its value at month 24
  const newCarAt24 = valueAtAge(100000, 24, rates);
  const newCarAt36 = valueAtAge(100000, 36, rates);
  const expectedRatio = newCarAt36 / newCarAt24;
  assert.ok(Math.abs(usedCarValue / 100000 - expectedRatio) < 1e-9);
});

test("buildValueSeries threads ageAtPurchaseMonths through resets (rebuying the same age car)", () => {
  const rates = [0.2, 0.15, 0.12, 0.1];
  const ageAtPurchaseMonths = 24;
  const series = buildValueSeries(100000, 24, rates, [12], ageAtPurchaseMonths);
  // After a reset at month 12, the car's value resets to the value of a car bought used
  // at the same original calendar age (not a brand new car).
  assert.ok(Math.abs(series[12] - valueAtAge(100000, 0, rates, ageAtPurchaseMonths)) < 1e-6);
  assert.ok(Math.abs(series[24] - valueAtAge(100000, 12, rates, ageAtPurchaseMonths)) < 1e-6);
});

test("buildValueSeries with ageRateMultiplier=1 is unchanged from the default", () => {
  const rates = [0.2, 0.15, 0.12, 0.1];
  const withDefault = buildValueSeries(100000, 24, rates, [12], 0);
  const withExplicitOne = buildValueSeries(100000, 24, rates, [12], 0, 1);
  assert.deepEqual(withExplicitOne, withDefault);
});

test("buildValueSeries with a higher ageRateMultiplier (more mileage) depreciates faster", () => {
  const rates = [0.2, 0.15, 0.12, 0.1];
  const baseline = buildValueSeries(100000, 24, rates, [], 0, 1);
  const highMileage = buildValueSeries(100000, 24, rates, [], 0, 1.5);
  assert.ok(highMileage[24] < baseline[24], "a car driven more than baseline should be worth less at the same calendar age");
});

test("impliedNewPrice returns the input price unchanged when ageAtPurchaseMonths is 0", () => {
  const rates = [0.2, 0.15, 0.12, 0.1];
  assert.equal(impliedNewPrice(100000, 0, rates), 100000);
});

test("impliedNewPrice inverts valueAtAge (round-trip)", () => {
  const rates = [0.2, 0.15, 0.12, 0.1, 0.08];
  const newPrice = 300000;
  const ageAtPurchaseMonths = 36;
  const priceAtAge = valueAtAge(newPrice, ageAtPurchaseMonths, rates);
  const recoveredNewPrice = impliedNewPrice(priceAtAge, ageAtPurchaseMonths, rates);
  assert.ok(Math.abs(recoveredNewPrice - newPrice) < 1e-6);
});

test("scaledYearlyRates with multiplier 1 returns the curve unchanged", () => {
  const rates = [0.2, 0.15, 0.12];
  assert.equal(scaledYearlyRates(rates, 1), rates);
});

test("scaledYearlyRates scales every yearly loss rate by the multiplier", () => {
  const scaled = scaledYearlyRates([0.2, 0.15, 0.1], 1.5);
  const expected = [0.3, 0.225, 0.15];
  scaled.forEach((rate, i) => assert.ok(Math.abs(rate - expected[i]) < 1e-12, `rate ${i}: expected ~${expected[i]}, got ${rate}`));
  const halved = scaledYearlyRates([0.2, 0.15, 0.1], 0.5);
  const expectedHalved = [0.1, 0.075, 0.05];
  halved.forEach((rate, i) => assert.ok(Math.abs(rate - expectedHalved[i]) < 1e-12, `rate ${i}: expected ~${expectedHalved[i]}, got ${rate}`));
});

test("scaledYearlyRates with multiplier 0 stops depreciation entirely", () => {
  const rates = scaledYearlyRates([0.2, 0.15, 0.1], 0);
  assert.deepEqual(rates, [0, 0, 0]);
  assert.equal(buildValueSeries(100000, 60, rates)[60], 100000);
});

test("scaledYearlyRates clamps the annual rate below 100% so the value never goes negative", () => {
  const rates = scaledYearlyRates([0.8], 5);
  assert.ok(rates[0] < 1, `expected a rate below 1, got ${rates[0]}`);
  const value = buildValueSeries(100000, 120, rates)[120];
  assert.ok(value >= 0 && Number.isFinite(value), `expected a non-negative finite value, got ${value}`);
});

test("scaledYearlyRates ignores a non-numeric multiplier and returns the base curve", () => {
  const rates = [0.2, 0.15];
  assert.equal(scaledYearlyRates(rates, NaN), rates);
});

test("solveRateMultiplierForResidual lands exactly on the requested residual value", () => {
  const yearlyRates = [0.2, 0.15, 0.12, 0.1, 0.1, 0.08, 0.08, 0.08, 0.08, 0.08];
  const solution = solveRateMultiplierForResidual({ initialValue: 300000, months: 60, yearlyRates, targetResidual: 150000 });
  assert.ok(solution.feasible);
  const value = buildValueSeries(300000, 60, scaledYearlyRates(yearlyRates, solution.rateMultiplier))[60];
  assert.ok(Math.abs(value - 150000) < 0.01, `expected ~150000, got ${value}`);
});

test("solveRateMultiplierForResidual returns ~1 when the target is the curve's own residual", () => {
  const yearlyRates = [0.2, 0.15, 0.12];
  const modelResidual = buildValueSeries(200000, 36, yearlyRates)[36];
  const solution = solveRateMultiplierForResidual({ initialValue: 200000, months: 36, yearlyRates, targetResidual: modelResidual });
  assert.ok(Math.abs(solution.rateMultiplier - 1) < 1e-6, `expected ~1, got ${solution.rateMultiplier}`);
});

test("solveRateMultiplierForResidual depreciates slower for a high residual and faster for a low one", () => {
  const yearlyRates = [0.2, 0.15, 0.12];
  const high = solveRateMultiplierForResidual({ initialValue: 200000, months: 36, yearlyRates, targetResidual: 160000 });
  const low = solveRateMultiplierForResidual({ initialValue: 200000, months: 36, yearlyRates, targetResidual: 80000 });
  assert.ok(high.rateMultiplier < 1, `a well-holding car should need a slower curve, got ${high.rateMultiplier}`);
  assert.ok(low.rateMultiplier > 1, `a fast-depreciating car should need a steeper curve, got ${low.rateMultiplier}`);
  assert.ok(high.residualValue > low.residualValue);
});

test("solveRateMultiplierForResidual accounts for the mileage-weighted age rate", () => {
  const yearlyRates = [0.2, 0.15, 0.12];
  const solution = solveRateMultiplierForResidual({
    initialValue: 200000,
    months: 36,
    yearlyRates,
    targetResidual: 120000,
    ageAtPurchaseMonths: 36,
    ageRateMultiplier: 1.4,
  });
  const value = buildValueSeries(200000, 36, scaledYearlyRates(yearlyRates, solution.rateMultiplier), [], 36, 1.4)[36];
  assert.ok(Math.abs(value - 120000) < 0.01, `expected ~120000, got ${value}`);
});

test("solveRateMultiplierForResidual reports infeasible (and no depreciation) when the target exceeds the purchase price", () => {
  const solution = solveRateMultiplierForResidual({
    initialValue: 200000,
    months: 36,
    yearlyRates: [0.2, 0.15, 0.12],
    targetResidual: 250000,
  });
  assert.equal(solution.feasible, false);
  assert.equal(solution.rateMultiplier, 0);
  assert.equal(solution.residualValue, 200000);
});

test("solveRateMultiplierForResidual with a target at or below zero falls back to the unscaled curve", () => {
  const yearlyRates = [0.2, 0.15, 0.12];
  for (const target of [0, -5000]) {
    const solution = solveRateMultiplierForResidual({ initialValue: 200000, months: 36, yearlyRates, targetResidual: target });
    assert.equal(solution.feasible, false);
    assert.equal(solution.rateMultiplier, 1);
  }
});
