/** Bygger en kassaflödesserie (längd months+1) med ett konstant belopp för månad 1..months. */
export function buildConstantSeries(months, monthlyValue) {
  const series = new Array(months + 1).fill(-monthlyValue);
  series[0] = 0;
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
  if (running.fuelType === "el") {
    return (monthlyMileageKm / 10) * running.consumptionKwhPer10km * running.electricityPricePerKwh;
  }
  return (monthlyMileageKm / 10) * running.consumptionLPer10km * running.fuelPricePerLiter;
}
