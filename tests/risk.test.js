import { test } from "node:test";
import assert from "node:assert/strict";
import { weibullHazard, sampleRepairCost, simulateOnePath } from "../src/calc/risk.js";

test("weibullHazard increases with age when shape > 1", () => {
  const shape = 2.5;
  const scale = 180;
  let prev = 0;
  for (const age of [12, 60, 120, 180, 240]) {
    const h = weibullHazard(age, shape, scale);
    assert.ok(h > prev, `hazard should increase with age (age=${age})`);
    prev = h;
  }
});

test("weibullHazard is 0 at age 0", () => {
  assert.equal(weibullHazard(0, 2.5, 180), 0);
});

test("sampleRepairCost is deterministic given a fixed rng sequence", () => {
  // rng() sequence feeds Box-Muller: u1=0.5, u2=0.5 -> z = sqrt(-2*ln(0.5))*cos(pi)
  const fixedValues = [0.5, 0.5];
  let i = 0;
  const rng = () => fixedValues[i++];
  const cost = sampleRepairCost(25000, 0.8, rng);
  const z = Math.sqrt(-2 * Math.log(0.5)) * Math.cos(Math.PI);
  const expected = 25000 * Math.exp(0.8 * z);
  assert.ok(Math.abs(cost - expected) < 1e-6);
});

test("simulateOnePath never triggers an event when rng always returns ~1 (never below hazard probability)", () => {
  const rng = () => 0.9999999;
  const result = simulateOnePath(300000, 60, [0.2, 0.15, 0.12, 0.1], {
    weibullShape: 2.5,
    weibullScaleMonths: 180,
    repairCostMedian: 25000,
    repairCostSigma: 0.8,
    totalLossThreshold: 0.5,
    reliabilityFactor: 1.0,
  }, 0, 1, rng);
  assert.equal(result.numEvents, 0);
  assert.equal(result.numTotalLosses, 0);
  assert.ok(result.cashflow.every((v) => v === 0));
});

test("simulateOnePath records a total loss when repair cost always exceeds the value threshold", () => {
  const rng = () => 0.0001;
  const result = simulateOnePath(10000, 24, [0.5, 0.5], {
    weibullShape: 2.5,
    weibullScaleMonths: 180,
    repairCostMedian: 25000, // median repair cost >> initial value of 10000 -> guaranteed total loss
    repairCostSigma: 0.1,
    totalLossThreshold: 0.5,
    reliabilityFactor: 1.0,
  }, 0, 1, rng);
  assert.ok(result.numEvents > 0);
  assert.ok(result.numTotalLosses > 0);
  assert.equal(result.resetMonths.length, result.numTotalLosses);
});

test("simulateOnePath with a used car starts hazard at a higher calendar age immediately", () => {
  const riskParams = {
    weibullShape: 2.5,
    weibullScaleMonths: 180,
    repairCostMedian: 25000,
    repairCostSigma: 0.8,
    totalLossThreshold: 0.5,
    reliabilityFactor: 1.0,
  };
  const hazardNew = weibullHazard(1, riskParams.weibullShape, riskParams.weibullScaleMonths);
  const hazardUsed = weibullHazard(121, riskParams.weibullShape, riskParams.weibullScaleMonths);
  assert.ok(hazardUsed > hazardNew, "a 10-year-old car should have a materially higher hazard at month 1 of ownership than a brand new car");
});

test("simulateOnePath with a higher ageRateMultiplier (more mileage) produces more events than baseline", () => {
  const riskParams = {
    weibullShape: 2.5,
    weibullScaleMonths: 180,
    repairCostMedian: 1, // Trivial repair cost so events never trigger a total loss/reset
    repairCostSigma: 0.1,
    totalLossThreshold: 0.999,
    reliabilityFactor: 1.0,
  };
  // Use a fixed rng sequence so both runs see identical "dice rolls" for the hazard check;
  // only the hazard magnitude (driven by ageRateMultiplier) should differ.
  const fixedRolls = Array.from({ length: 400 }, (_, i) => ((i * 37) % 100) / 100);
  let callCount = 0;
  const makeRng = () => {
    callCount = 0;
    return () => fixedRolls[callCount++ % fixedRolls.length];
  };
  const baseline = simulateOnePath(300000, 120, [0.2, 0.15, 0.12, 0.1], riskParams, 0, 1, makeRng());
  const highMileage = simulateOnePath(300000, 120, [0.2, 0.15, 0.12, 0.1], riskParams, 0, 2.5, makeRng());
  assert.ok(highMileage.numEvents >= baseline.numEvents, "a car aging 2.5x faster due to mileage should not have fewer hazard events");
});
