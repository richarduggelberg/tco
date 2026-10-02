/** Bygger en kassaflödesserie (längd months+1) med ett konstant belopp för månad 1..months. */
export function buildConstantSeries(months, monthlyValue) {
  const series = new Array(months + 1).fill(-monthlyValue);
  series[0] = 0;
  return series;
}

/**
 * Bygger en kassaflödesserie där kostnaden för varje månad 1..months beräknas av en
 * funktion av månadsindex (t.ex. försäkringspremie som beror på bilens ålder den månaden).
 */
export function buildSeriesFromFunction(months, costFn) {
  const series = new Array(months + 1).fill(0);
  for (let t = 1; t <= months; t++) {
    series[t] = -costFn(t);
  }
  return series;
}

/**
 * Bygger en kassaflödesserie med en återkommande klumpsummekostnad var `intervalMonths`:e
 * månad (t.ex. byte av däckuppsättning). Ingen kostnad om intervallet eller kostnaden är 0.
 */
export function buildPeriodicCostSeries(months, intervalMonths, cost) {
  const series = new Array(months + 1).fill(0);
  if (!intervalMonths || intervalMonths <= 0 || !cost) return series;
  for (let t = intervalMonths; t <= months; t += intervalMonths) {
    series[t] -= cost;
  }
  return series;
}

/** Bygger en kassaflödesserie där restvärdet betalas ut (positivt) vid periodens sista månad. */
export function buildResidualSeries(months, residualValue) {
  const series = new Array(months + 1).fill(0);
  series[months] = residualValue;
  return series;
}

/** Summerar flera kassaflödesserier av samma längd elementvis. */
export function sumSeries(seriesList) {
  const length = seriesList[0].length;
  const result = new Array(length).fill(0);
  for (const series of seriesList) {
    for (let t = 0; t < length; t++) {
      result[t] += series[t];
    }
  }
  return result;
}

/** Beräknar månatlig drivmedels-/elkostnad baserat på årlig körsträcka och förbrukning. */
export function computeEnergyMonthly(annualMileageKm, running) {
  const monthlyMileageKm = annualMileageKm / 12;
  const per100km = monthlyMileageKm / 100;
  if (running.fuelType === "el") {
    return per100km * running.el.consumptionKwhPer100km * running.el.pricePerKwh;
  }
  const fuel = running[running.fuelType];
  return per100km * fuel.consumptionLPer100km * fuel.pricePerLiter;
}
