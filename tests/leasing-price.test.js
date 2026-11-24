import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTco, computeLifetimeMonthlyCosts } from "../src/calc/tco.js";
import { defaultAssumptions } from "../src/data/assumptions.js";

function cloneAssumptions(mutate) {
  const assumptions = JSON.parse(JSON.stringify(defaultAssumptions));
  assumptions.risk.enabled = false;
  if (mutate) mutate(assumptions);
  return assumptions;
}

function ownedTco(overrides = {}) {
  return { price: 300000, months: 60, financingMethod: "kontant", assumptions: cloneAssumptions(), ...overrides };
}

function extrasSum(leasingPrice) {
  return Object.values(leasingPrice.extras).reduce((a, b) => a + b, 0);
}

// --- Det jämförbara leasingpriset -----------------------------------------------------------

test("computeTco has no comparable leasing price when leasing is the selected method", () => {
  const result = computeTco({ ...ownedTco(), financingMethod: "leasing" });
  assert.equal(result.leasingPrice, null);
});

test("the comparable leasing price is värdeminskning + kapitalkostnad + risk + helförsäkringstillägg + service + sommardäck", () => {
  const result = computeTco(ownedTco());
  const { monthly, items } = result.leasingPrice;
  const assumptions = defaultAssumptions;
  const summerTires = assumptions.tires.setCost / (assumptions.tires.summerIntervalYears * 12);

  // Vinterdäcken ingår inte i priset med standardantagandena, så bara sommardäcken ligger i det.
  assert.ok(Math.abs(items.tires - summerTires) < 1e-9);
  assert.ok(Math.abs(items.service - assumptions.running.serviceMonthly) < 1e-9);
  assert.ok(Math.abs(items.depreciation - result.categoryMonthly.depreciation) < 1e-9);
  // Kontantköp: ingen låneränta, så kapitalkostnaden är kalkylens egen kapitalkostnad.
  assert.ok(Math.abs(items.capital - result.categoryMonthly.kapitalkostnad) < 1e-9);
  // Vinterdäcken ligger utanför priset (och i parentesen) med standardantagandena.
  assert.ok(Math.abs(result.leasingPrice.extras.tires - assumptions.tires.setCost / (assumptions.tires.winterIntervalYears * 12)) < 1e-9);
  // Bilen köps ny och ägs i 5 år, så den hinner in i helförsäkringsperioden: mellanskillnaden mot
  // halvförsäkringen ligger då i priset, medan halvförsäkringen ligger kvar i parentesen.
  assert.ok(items.insurance > 0);
  assert.ok(result.leasingPrice.extras.insurance > 0);
  const composition = items.depreciation + items.capital + items.risk + items.insurance + items.service + items.tires;
  assert.ok(Math.abs(monthly - composition) < 1e-9);
});

test("only the helförsäkring surcharge over halvförsäkring moves into the price", () => {
  // En 4 år gammal bil som ligger i helförsäkring hela innehavstiden, 600 kr mot 400 kr halv.
  // Det är mellanskillnaden (200 kr) som hör till listpriset - halvförsäkringen betalas vid sidan
  // av i vilket leasingavtal som helst, så den ska inte flyttas in.
  const assumptions = cloneAssumptions((a) => {
    a.ageAtPurchaseYears = 4;
    a.insurance.helMonthly = 600;
    a.insurance.halvMonthly = 400;
  });
  const result = computeTco(ownedTco({ months: 12, assumptions }));
  const { items, extras } = result.leasingPrice;
  assert.ok(Math.abs(items.insurance - 200) < 1e-9, `tillägg i priset: ${items.insurance}`);
  assert.ok(Math.abs(extras.insurance - 400) < 1e-9, `halvförsäkring i parentesen: ${extras.insurance}`);
  // Kalkylen räknar fortfarande med den faktiska försäkringen (600), inte med differenten.
  assert.ok(Math.abs(result.categoryMonthly.insurance - 600) < 1e-9);
  assert.ok(Math.abs(items.insurance + extras.insurance - result.categoryMonthly.insurance) < 1e-9);
});

test("a lease-sized car that never reaches helförsäkring keeps the whole insurance in the parenthesis", () => {
  // Ny bil ägd i 2 år: hela innehavstiden ligger i halvförsäkringen (vagnskadegarantin).
  const result = computeTco(ownedTco({ months: 24 }));
  const { items, extras } = result.leasingPrice;
  assert.equal(items.insurance, 0);
  assert.ok(Math.abs(extras.insurance - result.categoryMonthly.insurance) < 1e-9);
});

test("a car held entirely inside the helförsäkring period still pays halvförsäkring on the side", () => {
  // Uppdelningen följer försäkringsnivån, inte perioden: även en bil som bara har helförsäkring
  // betalar halvförsäkringen vid sidan av, och bara mellanskillnaden ligger i priset.
  const assumptions = cloneAssumptions((a) => {
    a.ageAtPurchaseYears = 4; // kalenderålder 4 -> 7 år under innehavstiden, helt inom 3-8 år
    a.insurance.helMonthly = 600;
    a.insurance.halvMonthly = 400;
  });
  const result = computeTco(ownedTco({ months: 36, assumptions }));
  const { items, extras } = result.leasingPrice;
  assert.ok(Math.abs(items.insurance - 200) < 1e-9);
  assert.ok(Math.abs(extras.insurance - 400) < 1e-9);
  assert.ok(Math.abs(items.insurance + extras.insurance - result.categoryMonthly.insurance) < 1e-9);
});

test("the helförsäkring surcharge is levelized over the whole holding period", () => {
  // Ny bil ägd i 60 månader: 250 kr/mån i 24 av 60 månader, alltså ska tillägget sprida ut sig
  // över hela perioden i stället för att klumpa sig till de månaderna.
  const result = computeTco(ownedTco({ months: 60 }));
  const { items, extras } = result.leasingPrice;
  assert.ok(Math.abs(extras.insurance - defaultAssumptions.insurance.halvMonthly) < 1e-9);
  assert.ok(items.insurance > 0);
  assert.ok(items.insurance < 250);
});

test("the comparable leasing price plus its parenthesis equals the headline monthly cost", () => {
  for (const riskEnabled of [false, true]) {
    for (const financingMethod of ["kontant", "billan", "bolan"]) {
      const assumptions = cloneAssumptions((a) => {
        a.risk.enabled = riskEnabled;
      });
      const result = computeTco(ownedTco({ financingMethod, assumptions }));
      const headline = result.risk ? result.risk.mean : result.deterministicTotal;
      const { monthly } = result.leasingPrice;
      assert.ok(
        Math.abs(monthly + extrasSum(result.leasingPrice) - headline) < 1e-6,
        `${financingMethod} (risk ${riskEnabled}): ${monthly} + extras != ${headline}`
      );
    }
  }
});

test("the comparable leasing price covers the loan interest for a financed car", () => {
  const assumptions = cloneAssumptions();
  const cash = computeTco(ownedTco({ assumptions }));
  const loan = computeTco(ownedTco({ financingMethod: "billan", assumptions: JSON.parse(JSON.stringify(assumptions)) }));

  // Kapitalkostnaden är alternativkostnaden på eget kapital i båda fallen, men för billånet
  // tillkommer räntan - priset ska alltså vara högre (samma bil, samma kurva).
  assert.ok(loan.leasingPrice.items.capital > cash.leasingPrice.items.capital);
  assert.ok(
    Math.abs(loan.leasingPrice.items.capital - (loan.categoryMonthly.kapitalkostnad + loan.categoryMonthly.laneranta)) < 1e-9
  );
});

test("the comparable leasing price ignores the leasing fee in the Privatleasing field", () => {
  const cheap = computeTco(ownedTco({ assumptions: cloneAssumptions((a) => { a.financing.leasing.monthlyFee = 2000; }) }));
  const dear = computeTco(ownedTco({ assumptions: cloneAssumptions((a) => { a.financing.leasing.monthlyFee = 12000; }) }));
  assert.equal(cheap.leasingPrice.monthly, dear.leasingPrice.monthly);
});

test("winter tires move from the parenthesis into the price when the leasing profile includes them", () => {
  const winterTiresMonthly = defaultAssumptions.tires.setCost / (defaultAssumptions.tires.winterIntervalYears * 12);
  const without = computeTco(ownedTco()).leasingPrice;
  const withTires = computeTco(
    ownedTco({ assumptions: cloneAssumptions((a) => { a.financing.leasing.winterTiresIncluded = true; }) })
  ).leasingPrice;

  assert.ok(Math.abs(without.extras.tires - winterTiresMonthly) < 1e-9);
  assert.equal(withTires.extras.tires, 0);
  assert.ok(Math.abs(withTires.items.tires - without.items.tires - winterTiresMonthly) < 1e-9);
  // Posten byter bara plats: helheten (pris + parentes) är oförändrad.
  assert.ok(Math.abs(withTires.monthly + extrasSum(withTires) - (without.monthly + extrasSum(without))) < 1e-9);
});

test("service moves from the price into the parenthesis when the leasing profile excludes it", () => {
  const serviceMonthly = defaultAssumptions.running.serviceMonthly;
  const without = computeTco(ownedTco()).leasingPrice;
  const excluded = computeTco(
    ownedTco({ assumptions: cloneAssumptions((a) => { a.financing.leasing.serviceIncluded = false; }) })
  ).leasingPrice;

  assert.ok(Math.abs(without.items.service - serviceMonthly) < 1e-9);
  assert.equal(excluded.items.service, 0);
  assert.ok(Math.abs(excluded.extras.service - serviceMonthly) < 1e-9);
  assert.ok(Math.abs(excluded.monthly + extrasSum(excluded) - (without.monthly + extrasSum(without))) < 1e-9);
});

test("the comparable leasing price reports the tire sets it splits between price and parenthesis", () => {
  const { tireMonthly, items, extras } = computeTco(ownedTco()).leasingPrice;
  assert.ok(Math.abs(tireMonthly.summer - defaultAssumptions.tires.setCost / (defaultAssumptions.tires.summerIntervalYears * 12)) < 1e-9);
  assert.ok(Math.abs(tireMonthly.winter - defaultAssumptions.tires.setCost / (defaultAssumptions.tires.winterIntervalYears * 12)) < 1e-9);
  // De två däckposterna är tillsammans hela däckkostnaden i uppdelningen.
  const result = computeTco(ownedTco());
  assert.ok(Math.abs(items.tires + extras.tires - result.categoryMonthly.tires) < 1e-9);
});

test("the tires category matches the average the lifetime chart draws", () => {
  const input = ownedTco();
  const tco = computeTco(input);
  const lifetime = computeLifetimeMonthlyCosts(input);
  const drawn = lifetime.components.tires;
  assert.ok(drawn.length > 0);
  for (const value of drawn) {
    assert.ok(Math.abs(value - tco.categoryMonthly.tires) < 1e-9, `${value} != ${tco.categoryMonthly.tires}`);
  }
});
