import { test } from "node:test";
import assert from "node:assert/strict";
import { valueAtAge, buildValueSeries } from "../src/calc/depreciation.js";

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
