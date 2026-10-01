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
  }, rng);
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
  }, rng);
  assert.ok(result.numEvents > 0);
  assert.ok(result.numTotalLosses > 0);
  assert.equal(result.resetMonths.length, result.numTotalLosses);
});
