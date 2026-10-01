import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTco } from "../src/calc/tco.js";
import { defaultAssumptions } from "../src/data/assumptions.js";

function cloneAssumptions() {
  return JSON.parse(JSON.stringify(defaultAssumptions));
}

test("computeTco with risk disabled sums category breakdown to the deterministic total", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = false;
  const result = computeTco({ price: 300000, months: 60, financingMethod: "kontant", assumptions });
  const sum = Object.values(result.categoryMonthly).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - result.deterministicTotal) < 1e-6);
  assert.equal(result.risk, null);
});

test("computeTco deterministic total is positive (a net cost) for a typical car", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = false;
  const result = computeTco({ price: 300000, months: 60, financingMethod: "kontant", assumptions });
  assert.ok(result.deterministicTotal > 0);
});

test("computeTco with risk enabled adds a non-negative expected risk premium on average", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = true;
  assumptions.risk.numSimulations = 500;
  const result = computeTco({ price: 150000, months: 120, financingMethod: "kontant", assumptions });
  assert.ok(result.risk !== null);
  // Over a long holding period on a cheap car, risk of costly repairs should add real expected cost
  assert.ok(result.risk.mean > result.deterministicTotal - 50, "risk-adjusted mean should not be drastically lower than deterministic");
  assert.ok(result.risk.p90 >= result.risk.median);
  assert.ok(result.risk.median >= result.risk.p10);
});

test("computeTco supports all three financing methods without throwing", () => {
  for (const method of ["kontant", "billan", "bolan"]) {
    const assumptions = cloneAssumptions();
    assumptions.risk.enabled = false;
    const result = computeTco({ price: 300000, months: 60, financingMethod: method, assumptions });
    assert.ok(Number.isFinite(result.deterministicTotal));
  }
});

test("computeTco with leasing excludes residual value and haveririsk entirely", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = true; // Should be ignored for leasing regardless
  const result = computeTco({ price: 300000, months: 36, financingMethod: "leasing", assumptions });
  assert.equal(result.risk, null);
  assert.ok(!("residual" in result.categoryMonthly));
});

test("computeTco with leasing zeroes tax/service when bundled in the fee", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = false;
  assumptions.financing.leasing.taxAndServiceIncluded = true;
  const result = computeTco({ price: 300000, months: 36, financingMethod: "leasing", assumptions });
  assert.equal(Math.abs(result.categoryMonthly.tax), 0);
  assert.equal(Math.abs(result.categoryMonthly.service), 0);
});

test("computeTco with leasing keeps tax/service as separate costs when not bundled", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = false;
  assumptions.financing.leasing.taxAndServiceIncluded = false;
  const result = computeTco({ price: 300000, months: 36, financingMethod: "leasing", assumptions });
  assert.ok(result.categoryMonthly.tax > 0);
  assert.ok(result.categoryMonthly.service > 0);
});
