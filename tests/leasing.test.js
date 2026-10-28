import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTco, computeLifetimeMonthlyCosts, resolveVehiclePrice } from "../src/calc/tco.js";
import { computeEnergyMonthly } from "../src/calc/cashflow.js";
import { defaultAssumptions } from "../src/data/assumptions.js";

function cloneAssumptions(mutate) {
  const assumptions = JSON.parse(JSON.stringify(defaultAssumptions));
  assumptions.risk.enabled = false;
  if (mutate) mutate(assumptions);
  return assumptions;
}

/** Seedad slumptalgenerator, så att en körning går att upprepa exakt. */
function reseed(seed = 1234) {
  let state = seed;
  Math.random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

// --- Priset vid leasing ---------------------------------------------------------------------

test("resolveVehiclePrice passes the entered price through for every owned method", () => {
  for (const method of ["kontant", "billan", "bolan"]) {
    assert.deepEqual(resolveVehiclePrice({ price: 300000, financingMethod: method, assumptions: cloneAssumptions() }), {
      price: 300000,
      source: "input",
    });
  }
});

test("resolveVehiclePrice assumes the leasing price from the fee times the ratio", () => {
  const assumptions = cloneAssumptions((a) => {
    a.financing.leasing.monthlyFee = 3000;
    a.financing.leasing.priceToFeeRatio = 100;
  });
  assert.deepEqual(resolveVehiclePrice({ price: 999999, financingMethod: "leasing", assumptions }), {
    price: 300000,
    source: "leasingavgift",
  });
});

test("resolveVehiclePrice follows the ratio, so a different factor scales the assumed price", () => {
  const assumptions = cloneAssumptions((a) => {
    a.financing.leasing.monthlyFee = 3000;
    a.financing.leasing.priceToFeeRatio = 140;
  });
  assert.equal(resolveVehiclePrice({ price: 0, financingMethod: "leasing", assumptions }).price, 420000);
});

test("resolveVehiclePrice prefers an entered nypris over the fee assumption", () => {
  const assumptions = cloneAssumptions((a) => {
    a.ageAtPurchaseYears = 3;
    a.financing.leasing.monthlyFee = 3000;
    a.depreciation.newPrice = 420000;
  });
  assert.deepEqual(resolveVehiclePrice({ price: 0, financingMethod: "leasing", assumptions }), {
    price: 420000,
    source: "nypris",
  });
});

test("resolveVehiclePrice falls back to the entered price if the assumption yields nothing", () => {
  const assumptions = cloneAssumptions((a) => {
    a.financing.leasing.monthlyFee = 0;
    a.financing.leasing.priceToFeeRatio = 100;
  });
  assert.deepEqual(resolveVehiclePrice({ price: 275000, financingMethod: "leasing", assumptions }), {
    price: 275000,
    source: "input",
  });
});

// --- Leasingkalkylen är oberoende av ett ifyllt pris ----------------------------------------

test("computeTco with leasing ignores the purchase price entirely (the fee drives the cost)", () => {
  const cheap = computeTco({ price: 100000, months: 60, financingMethod: "leasing", assumptions: cloneAssumptions() });
  const dear = computeTco({ price: 900000, months: 60, financingMethod: "leasing", assumptions: cloneAssumptions() });

  assert.equal(cheap.vehiclePrice, dear.vehiclePrice, "both fall back to the assumed price");
  assert.equal(cheap.priceSource, "leasingavgift");
  assert.equal(cheap.deterministicTotal, dear.deterministicTotal, "the leasing cost does not depend on the price");
  assert.equal(cheap.vehiclePrice, 450000, "the default fee of 4500 times 100");
});

test("computeTco with leasing reports the assumed price so the UI can explain it", () => {
  const assumptions = cloneAssumptions((a) => {
    a.financing.leasing.monthlyFee = 3200;
    a.financing.leasing.priceToFeeRatio = 100;
  });
  const result = computeTco({ price: 0, months: 36, financingMethod: "leasing", assumptions });
  assert.equal(result.vehiclePrice, 320000);
  assert.equal(result.priceSource, "leasingavgift");
  assert.equal(result.residualValue, null);
});

test("computeTco with leasing and an entered nypris uses it as the price without reporting an impossible curve", () => {
  const assumptions = cloneAssumptions((a) => {
    a.ageAtPurchaseYears = 4;
    a.depreciation.newPrice = 380000;
  });
  const result = computeTco({ price: 0, months: 60, financingMethod: "leasing", assumptions });

  assert.equal(result.vehiclePrice, 380000);
  assert.equal(result.priceSource, "nypris");
  // The nypris doubles as the price here, so it must not be used to calibrate a history as well
  assert.equal(result.depreciationModel.calibrated, false);
  assert.equal(result.depreciationModel.feasible, true, "must not be reported as an unusable nypris");
  assert.equal(result.depreciationModel.source, "multiplier");
});

// --- Jämförelsen mellan finansieringssätten -------------------------------------------------

test("computeTco compares against every other financing method, never the selected one", () => {
  const result = computeTco({ price: 300000, months: 60, financingMethod: "kontant", assumptions: cloneAssumptions() });
  assert.deepEqual(result.comparison.map((row) => row.method), ["billan", "bolan", "leasing"]);

  const leasing = computeTco({ price: 300000, months: 60, financingMethod: "leasing", assumptions: cloneAssumptions() });
  assert.deepEqual(leasing.comparison.map((row) => row.method), ["kontant", "billan", "bolan"]);
});

test("computeTco comparison rows equal a standalone calculation at the same price", () => {
  const assumptions = cloneAssumptions();
  const primary = computeTco({ price: 300000, months: 60, financingMethod: "kontant", assumptions });

  for (const row of primary.comparison) {
    const standalone = computeTco({
      price: row.price,
      months: 60,
      financingMethod: row.method,
      assumptions: cloneAssumptions(),
    });
    assert.ok(
      Math.abs(row.deterministicTotal - standalone.deterministicTotal) < 1e-9,
      `${row.method}: comparison ${row.deterministicTotal} vs standalone ${standalone.deterministicTotal}`
    );
  }
});

test("computeTco comparison for a leased car uses the assumed price for the owned methods", () => {
  const assumptions = cloneAssumptions((a) => {
    a.financing.leasing.monthlyFee = 3000;
  });
  const leasing = computeTco({ price: 123456, months: 60, financingMethod: "leasing", assumptions });

  const kontantRow = leasing.comparison.find((row) => row.method === "kontant");
  assert.equal(kontantRow.price, 300000, "the assumed price, not the hidden input field");

  const standalone = computeTco({ price: 300000, months: 60, financingMethod: "kontant", assumptions: cloneAssumptions() });
  assert.ok(Math.abs(kontantRow.deterministicTotal - standalone.deterministicTotal) < 1e-9);
});

test("computeTco comparison gives every owned method the same risk treatment", () => {
  reseed();
  const assumptions = cloneAssumptions((a) => {
    a.risk.enabled = true;
    a.risk.numSimulations = 200;
  });
  const result = computeTco({ price: 300000, months: 60, financingMethod: "leasing", assumptions });

  for (const row of result.comparison) {
    assert.ok(Number.isFinite(row.monthlyCost));
    assert.equal(row.monthlyCost, row.risk ? row.risk.mean : row.deterministicTotal);
    assert.notEqual(row.risk, null, `${row.method} should carry a risk premium, the simulation is shared`);
  }
});

test("computeTco does not let the comparison disturb the primary result", () => {
  const withComparison = (() => {
    reseed(99);
    return computeTco({ price: 300000, months: 60, financingMethod: "billan", assumptions: cloneAssumptions((a) => { a.risk.enabled = true; a.risk.numSimulations = 200; }) });
  })();
  const withoutComparison = (() => {
    reseed(99);
    return computeTco({ price: 300000, months: 60, financingMethod: "billan", assumptions: cloneAssumptions((a) => { a.risk.enabled = true; a.risk.numSimulations = 200; }), compareMethods: false });
  })();

  assert.equal(withComparison.risk.mean, withoutComparison.risk.mean);
  assert.equal(withComparison.deterministicTotal, withoutComparison.deterministicTotal);
  assert.equal(withoutComparison.comparison, null);
});

// --- Livscykeldiagrammet: kontantköp som bas + streckad leasinglinje ------------------------

test("computeLifetimeMonthlyCosts shows a cash purchase as the base curve when leasing", () => {
  const leasingAssumptions = cloneAssumptions((a) => {
    a.financing.leasing.monthlyFee = 3000;
  });
  const leasing = computeLifetimeMonthlyCosts({ price: 0, months: 60, financingMethod: "leasing", assumptions: leasingAssumptions });
  const kontant = computeLifetimeMonthlyCosts({ price: 300000, months: 60, financingMethod: "kontant", assumptions: cloneAssumptions() });

  assert.equal(leasing.vehiclePrice, 300000);
  assert.equal(leasing.monthlyCost.length, kontant.monthlyCost.length);
  leasing.monthlyCost.forEach((value, i) => {
    assert.ok(Math.abs(value - kontant.monthlyCost[i]) < 1e-9, `month ${i + 1}: ${value} vs ${kontant.monthlyCost[i]}`);
  });
  for (const key of Object.keys(kontant.components)) {
    assert.ok(leasing.components[key], `component ${key} should be present when leasing`);
    leasing.components[key].forEach((value, i) => {
      assert.ok(Math.abs(value - kontant.components[key][i]) < 1e-9, `${key} month ${i + 1}`);
    });
  }
  assert.equal(leasing.components.leasing, undefined, "the leasing fee is no longer part of the stacked curve");
});

test("the leasing line covers the fee plus everything the fee does not include", () => {
  const assumptions = cloneAssumptions((a) => {
    a.financing.leasing.monthlyFee = 3000;
    a.financing.leasing.serviceIncluded = true;
    a.financing.leasing.winterTiresIncluded = false;
  });
  const lifetime = computeLifetimeMonthlyCosts({ price: 0, months: 60, financingMethod: "leasing", assumptions });

  const energy = computeEnergyMonthly(assumptions.annualMileageKm, assumptions.running);
  const taxMonth1 = assumptions.tax.malusAnnualAmount / 12; // ny bil -> malus
  const insuranceMonth1 = assumptions.insurance.halvMonthly; // ung bil -> halvförsäkring
  const tiresMonthly =
    assumptions.tires.setCost / (assumptions.tires.winterIntervalYears * 12) +
    assumptions.tires.setCost / (assumptions.tires.summerIntervalYears * 12);
  const expected = 3000 + energy + taxMonth1 + insuranceMonth1 + tiresMonthly;

  assert.ok(Math.abs(lifetime.leasingMonthlyCost[1] - expected) < 1e-6, `expected ${expected}, got ${lifetime.leasingMonthlyCost[1]}`);
});

test("the leasing line exists only during the ownership window", () => {
  const lifetime = computeLifetimeMonthlyCosts({ price: 0, months: 36, financingMethod: "leasing", assumptions: cloneAssumptions() });
  assert.equal(lifetime.leasingMonthlyCost[0], 0);
  for (let t = 1; t <= 36; t++) assert.ok(lifetime.leasingMonthlyCost[t] > 0, `month ${t} should have a leasing cost`);
  for (let t = 37; t <= lifetime.ageYears.length; t++) {
    assert.equal(lifetime.leasingMonthlyCost[t], 0, `month ${t} is outside the ownership window`);
  }
});

test("the leasing line grows when service or winter tires stop being included", () => {
  const included = computeLifetimeMonthlyCosts({
    price: 0, months: 60, financingMethod: "leasing",
    assumptions: cloneAssumptions((a) => { a.financing.leasing.serviceIncluded = true; a.financing.leasing.winterTiresIncluded = true; }),
  });
  const notIncluded = computeLifetimeMonthlyCosts({
    price: 0, months: 60, financingMethod: "leasing",
    assumptions: cloneAssumptions((a) => { a.financing.leasing.serviceIncluded = false; a.financing.leasing.winterTiresIncluded = false; }),
  });
  assert.ok(
    notIncluded.leasingMonthlyCost[1] > included.leasingMonthlyCost[1],
    "a less inclusive fee must show up as a higher total cost"
  );
  // Without winter tires in the fee the lessee still buys summer tires
  const difference = notIncluded.leasingMonthlyCost[1] - included.leasingMonthlyCost[1];
  const expected = 400 + 125; // service per month + winter tires per month
  assert.ok(Math.abs(difference - expected) < 1e-6, `expected a difference of ${expected}, got ${difference}`);
});

test("the leasing line includes an extra first payment in its first month", () => {
  const withExtra = computeLifetimeMonthlyCosts({
    price: 0, months: 36, financingMethod: "leasing",
    assumptions: cloneAssumptions((a) => { a.financing.leasing.firstPaymentExtra = 9000; }),
  });
  const without = computeLifetimeMonthlyCosts({ price: 0, months: 36, financingMethod: "leasing", assumptions: cloneAssumptions() });
  assert.ok(Math.abs(withExtra.leasingMonthlyCost[1] - without.leasingMonthlyCost[1] - 9000) < 1e-6);
  assert.ok(Math.abs(withExtra.leasingMonthlyCost[2] - without.leasingMonthlyCost[2]) < 1e-6, "a one-off, so only the first month");
});

test("computeLifetimeMonthlyCosts keeps financing the owned curve when not leasing", () => {
  const lifetime = computeLifetimeMonthlyCosts({ price: 300000, months: 60, financingMethod: "billan", assumptions: cloneAssumptions() });
  assert.equal(lifetime.priceSource, "input");
  assert.ok(lifetime.leasingMonthlyCost.every((value) => value === 0), "no leasing line for an owned car");
  assert.ok(lifetime.components.capitalCost.length > 0);
});
