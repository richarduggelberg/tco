import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTco, computeLifetimeMonthlyCosts } from "../src/calc/tco.js";
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
  assert.ok(!("depreciation" in result.categoryMonthly));
  assert.ok(!("kapitalkostnad" in result.categoryMonthly));
  assert.ok(!("laneranta" in result.categoryMonthly));
  assert.ok("leasingavgift" in result.categoryMonthly);
});

test("computeTco with leasing never bundles tax, but zeroes service when bundled in the fee", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = false;
  assumptions.financing.leasing.serviceIncluded = true;
  const result = computeTco({ price: 300000, months: 36, financingMethod: "leasing", assumptions });
  assert.ok(result.categoryMonthly.tax > 0, "tax should always be a separate cost under leasing");
  assert.equal(Math.abs(result.categoryMonthly.service), 0);
});

test("computeTco with leasing keeps service as a separate cost when not bundled", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = false;
  assumptions.financing.leasing.serviceIncluded = false;
  const result = computeTco({ price: 300000, months: 36, financingMethod: "leasing", assumptions });
  assert.ok(result.categoryMonthly.tax > 0);
  assert.ok(result.categoryMonthly.service > 0);
});

test("computeTco includes a tires category with a positive cost", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = false;
  const result = computeTco({ price: 300000, months: 60, financingMethod: "kontant", assumptions });
  assert.ok(result.categoryMonthly.tires > 0);
});

test("computeTco with leasing and winterTiresIncluded reduces the tires cost vs. not included", () => {
  const withoutIncluded = cloneAssumptions();
  withoutIncluded.risk.enabled = false;
  withoutIncluded.financing.leasing.winterTiresIncluded = false;
  const resultWithout = computeTco({ price: 300000, months: 60, financingMethod: "leasing", assumptions: withoutIncluded });

  const withIncluded = cloneAssumptions();
  withIncluded.risk.enabled = false;
  withIncluded.financing.leasing.winterTiresIncluded = true;
  const resultWith = computeTco({ price: 300000, months: 60, financingMethod: "leasing", assumptions: withIncluded });

  assert.ok(resultWith.categoryMonthly.tires < resultWithout.categoryMonthly.tires);
});

test("computeTco applies helförsäkring once the car crosses helStartYears", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = false;
  assumptions.insurance.halvMonthly = 400;
  assumptions.insurance.helMonthly = 650;
  assumptions.insurance.helStartYears = 1;
  assumptions.insurance.helEndYears = 10;
  // A car bought at calendar age 0, held 6 months: entirely in the halv period (< 1 year).
  const halvOnly = computeTco({ price: 300000, months: 6, financingMethod: "kontant", assumptions });
  // A car bought at calendar age 2 years, held 6 months: entirely in the hel period.
  const assumptionsUsed = cloneAssumptions();
  assumptionsUsed.risk.enabled = false;
  assumptionsUsed.insurance.halvMonthly = 400;
  assumptionsUsed.insurance.helMonthly = 650;
  assumptionsUsed.insurance.helStartYears = 1;
  assumptionsUsed.insurance.helEndYears = 10;
  assumptionsUsed.ageAtPurchaseYears = 2;
  const helOnly = computeTco({ price: 300000, months: 6, financingMethod: "kontant", assumptions: assumptionsUsed });
  assert.ok(Math.abs(helOnly.categoryMonthly.insurance) > Math.abs(halvOnly.categoryMonthly.insurance));
});

test("computeTco with a higher ageAtPurchaseYears retains a larger share of value (flatter later-year depreciation curve)", () => {
  const newCar = cloneAssumptions();
  newCar.risk.enabled = false;
  newCar.ageAtPurchaseYears = 0;
  const resultNew = computeTco({ price: 300000, months: 24, financingMethod: "kontant", assumptions: newCar });

  const usedCar = cloneAssumptions();
  usedCar.risk.enabled = false;
  usedCar.ageAtPurchaseYears = 5;
  const resultUsed = computeTco({ price: 300000, months: 24, financingMethod: "kontant", assumptions: usedCar });

  // A used car (already past the steepest depreciation years) retains a higher share of its
  // purchase price over the next 24 months than a brand new car does, so it loses less value
  // (smaller depreciation cost) over the period.
  assert.ok(Math.abs(resultUsed.categoryMonthly.depreciation) < Math.abs(resultNew.categoryMonthly.depreciation));
});

test("computeTco applies the malus tax rate for the first malusYears, then the lower normal rate", () => {
  const assumptions = cloneAssumptions();
  assumptions.risk.enabled = false;
  assumptions.tax.malusAnnualAmount = 12000;
  assumptions.tax.normalAnnualAmount = 2400;
  assumptions.tax.malusYears = 1;
  // Entirely within the malus period (< 1 year held, bought new)
  const duringMalus = computeTco({ price: 300000, months: 6, financingMethod: "kontant", assumptions });
  // Bought already past the malus period
  const afterMalus = cloneAssumptions();
  afterMalus.risk.enabled = false;
  afterMalus.tax.malusAnnualAmount = 12000;
  afterMalus.tax.normalAnnualAmount = 2400;
  afterMalus.tax.malusYears = 1;
  afterMalus.ageAtPurchaseYears = 2;
  const afterMalusResult = computeTco({ price: 300000, months: 6, financingMethod: "kontant", assumptions: afterMalus });
  assert.ok(Math.abs(duringMalus.categoryMonthly.tax) > Math.abs(afterMalusResult.categoryMonthly.tax));
});

test("computeTco: higher annual mileage than baseline depreciates the car faster (smaller residual deduction)", () => {
  const lowMileage = cloneAssumptions();
  lowMileage.risk.enabled = false;
  lowMileage.annualMileageKm = 5000;
  const resultLow = computeTco({ price: 300000, months: 24, financingMethod: "kontant", assumptions: lowMileage });

  const highMileage = cloneAssumptions();
  highMileage.risk.enabled = false;
  highMileage.annualMileageKm = 30000;
  const resultHigh = computeTco({ price: 300000, months: 24, financingMethod: "kontant", assumptions: highMileage });

  // A high-mileage car ages faster and loses more value, so its depreciation cost is larger
  // in magnitude than for a low-mileage car.
  assert.ok(Math.abs(resultHigh.categoryMonthly.depreciation) > Math.abs(resultLow.categoryMonthly.depreciation));
});

test("computeTco: with mileageWeight=0, annual mileage has no effect on depreciation (pure calendar aging)", () => {
  const lowMileage = cloneAssumptions();
  lowMileage.risk.enabled = false;
  lowMileage.vehicleAge.mileageWeight = 0;
  lowMileage.annualMileageKm = 5000;
  const resultLow = computeTco({ price: 300000, months: 24, financingMethod: "kontant", assumptions: lowMileage });

  const highMileage = cloneAssumptions();
  highMileage.risk.enabled = false;
  highMileage.vehicleAge.mileageWeight = 0;
  highMileage.annualMileageKm = 30000;
  const resultHigh = computeTco({ price: 300000, months: 24, financingMethod: "kontant", assumptions: highMileage });

  assert.ok(Math.abs(resultHigh.categoryMonthly.depreciation - resultLow.categoryMonthly.depreciation) < 1e-6);
});

test("computeTco: higher annual mileage than baseline increases the risk of a total loss over the holding period", () => {
  const lowMileage = cloneAssumptions();
  lowMileage.risk.enabled = true;
  lowMileage.risk.numSimulations = 800;
  lowMileage.annualMileageKm = 3000;
  const resultLow = computeTco({ price: 150000, months: 120, financingMethod: "kontant", assumptions: lowMileage });

  const highMileage = cloneAssumptions();
  highMileage.risk.enabled = true;
  highMileage.risk.numSimulations = 800;
  highMileage.annualMileageKm = 40000;
  const resultHigh = computeTco({ price: 150000, months: 120, financingMethod: "kontant", assumptions: highMileage });

  // Driving more than baseline ages the car faster (higher equivalent hazard age), so a total
  // loss (haveri) is more likely to occur at some point during the holding period.
  assert.ok(resultHigh.risk.shareWithTotalLoss > resultLow.risk.shareWithTotalLoss);
});

test("computeLifetimeMonthlyCosts returns a finite cost series spanning the whole car life", () => {
  const assumptions = cloneAssumptions();
  const result = computeLifetimeMonthlyCosts({ price: 300000, months: 60, financingMethod: "billan", assumptions });
  assert.ok(result.monthlyCost.length > 0);
  assert.equal(result.monthlyCost.length, result.ageYears.length);
  assert.ok(result.monthlyCost.every((v) => Number.isFinite(v)));
});

test("computeLifetimeMonthlyCosts marks purchase/end-of-ownership ages consistently with the inputs", () => {
  const assumptions = cloneAssumptions();
  assumptions.ageAtPurchaseYears = 2;
  const result = computeLifetimeMonthlyCosts({ price: 300000, months: 36, financingMethod: "kontant", assumptions });
  assert.equal(result.purchaseAgeYears, 2);
  assert.equal(result.endOfOwnershipAgeYears, 5);
});

test("computeLifetimeMonthlyCosts shows a higher monthly cost during ownership than right after selling (financing drops away)", () => {
  const assumptions = cloneAssumptions();
  assumptions.ageAtPurchaseYears = 0;
  const result = computeLifetimeMonthlyCosts({ price: 300000, months: 36, financingMethod: "billan", assumptions });
  const lastOwnedIdx = Math.round(result.endOfOwnershipAgeYears * 12) - 1;
  const firstUnownedIdx = lastOwnedIdx + 1;
  assert.ok(result.monthlyCost[lastOwnedIdx] > result.monthlyCost[firstUnownedIdx]);
});
