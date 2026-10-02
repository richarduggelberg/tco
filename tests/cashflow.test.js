import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEnergyMonthly } from "../src/calc/cashflow.js";
import { defaultAssumptions } from "../src/data/assumptions.js";

function cloneRunning() {
  return JSON.parse(JSON.stringify(defaultAssumptions.running));
}

test("computeEnergyMonthly computes bensin cost from price per liter and consumption per 100km", () => {
  const running = cloneRunning();
  running.fuelType = "bensin";
  running.bensin = { pricePerLiter: 18, consumptionLPer100km: 7 };
  const monthly = computeEnergyMonthly(15000, running);
  // 15000km/year -> 1250km/month -> 12.5 * (7/100) liter * 18 kr
  assert.ok(Math.abs(monthly - 1250 * (7 / 100) * 18) < 1e-6);
});

test("computeEnergyMonthly computes diesel cost from its own price/consumption fields", () => {
  const running = cloneRunning();
  running.fuelType = "diesel";
  running.diesel = { pricePerLiter: 21, consumptionLPer100km: 5.5 };
  const monthly = computeEnergyMonthly(12000, running);
  assert.ok(Math.abs(monthly - (12000 / 12) * (5.5 / 100) * 21) < 1e-6);
});

test("computeEnergyMonthly computes electricity cost from kWh price/consumption fields", () => {
  const running = cloneRunning();
  running.fuelType = "el";
  running.el = { pricePerKwh: 2, consumptionKwhPer100km: 18 };
  const monthly = computeEnergyMonthly(18000, running);
  assert.ok(Math.abs(monthly - (18000 / 12) * (18 / 100) * 2) < 1e-6);
});
