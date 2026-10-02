import { computeTco, computeLifetimeMonthlyCosts } from "../calc/tco.js";
import { impliedNewPrice } from "../calc/depreciation.js";
import { defaultAssumptions, fuelTypeDefaults } from "../data/assumptions.js";
import { formatCurrency, categoryLabels, formatThousands, parseThousands } from "./format.js";

const form = document.getElementById("tco-form");
const fuelTypeSelect = document.getElementById("fuelType");
const financingMethodSelect = document.getElementById("financingMethod");
const billanFields = document.getElementById("billan-fields");
const bolanFields = document.getElementById("bolan-fields");
const leasingFields = document.getElementById("leasing-fields");
const priceInput = document.getElementById("price");
const ageAtPurchaseInput = document.getElementById("ageAtPurchase");
const impliedNewPriceNote = document.getElementById("implied-newprice-note");

const resultsSection = document.getElementById("results");
const resultMonthlyEl = document.getElementById("result-monthly");
const resultIntervalEl = document.getElementById("result-interval");
const breakdownBody = document.getElementById("breakdown-body");
const chartCanvas = document.getElementById("breakdown-chart");
const lifetimeChartCanvas = document.getElementById("lifetime-chart");

let chartInstance = null;
let lifetimeChartInstance = null;

// Ritar lodräta markörlinjer (utan att behöva Chart.js annotation-pluginet) för köpålder
// och slutet av ägandeperioden ovanpå livscykel-grafen.
const verticalMarkerPlugin = {
  id: "verticalMarkers",
  afterDraw(chart, _args, opts) {
    const markers = opts?.markers ?? [];
    if (!markers.length) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    ctx.save();
    for (const marker of markers) {
      const xPixel = xScale.getPixelForValue(marker.value);
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = marker.color;
      ctx.moveTo(xPixel, chartArea.top);
      ctx.lineTo(xPixel, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = marker.color;
      ctx.font = "11px sans-serif";
      ctx.fillText(marker.label, xPixel + 4, chartArea.top + 12);
    }
    ctx.restore();
  },
};

function updateVisibility() {
  billanFields.classList.toggle("hidden", financingMethodSelect.value !== "billan");
  bolanFields.classList.toggle("hidden", financingMethodSelect.value !== "bolan");
  leasingFields.classList.toggle("hidden", financingMethodSelect.value !== "leasing");
}

function updateImpliedNewPriceNote() {
  const price = parseThousands(priceInput.value);
  const ageYears = Number(ageAtPurchaseInput.value);
  if (!ageYears || !price) {
    impliedNewPriceNote.classList.add("hidden");
    return;
  }
  const newPrice = impliedNewPrice(price, Math.round(ageYears * 12), defaultAssumptions.depreciation.yearlyRates);
  impliedNewPriceNote.textContent = `Uppskattat nypris (baklängesräknat från värdeminskningskurvan): ~${formatCurrency(newPrice)}`;
  impliedNewPriceNote.classList.remove("hidden");
}

/** Fyller i rimliga standardvärden för skatt/haveririsk baserat på valt drivmedel. */
function applyFuelTypeDefaults() {
  const defaults = fuelTypeDefaults[fuelTypeSelect.value];
  if (!defaults) return;
  document.getElementById("taxMalusAnnual").value = defaults.tax.malusAnnualAmount;
  document.getElementById("taxNormalAnnual").value = defaults.tax.normalAnnualAmount;
  document.getElementById("taxMalusYears").value = defaults.tax.malusYears;
  document.getElementById("expectedLifeYears").value = Math.round(defaults.risk.weibullScaleMonths / 12);
  document.getElementById("repairCostMedian").value = defaults.risk.repairCostMedian;
  document.getElementById("reliabilityFactor").value = defaults.risk.reliabilityFactor;
}

fuelTypeSelect.addEventListener("change", () => {
  updateVisibility();
  applyFuelTypeDefaults();
});
financingMethodSelect.addEventListener("change", updateVisibility);

// Formaterar om inköpspris-fältet med mellanslag som tusentalsavgränsare medan man skriver,
// och återställer textmarkören till motsvarande siffer-position efter omformateringen.
function enableThousandsInput(id) {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener("input", () => {
    const digitsBeforeCursor = input.value.slice(0, input.selectionStart).replace(/\D/g, "").length;
    const formatted = formatThousands(input.value);
    input.value = formatted;
    let digitsSeen = 0;
    let newPos = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (digitsSeen === digitsBeforeCursor) {
        newPos = i;
        break;
      }
      if (/\d/.test(formatted[i])) digitsSeen++;
    }
    input.setSelectionRange(newPos, newPos);
  });
}
enableThousandsInput("price");

priceInput.addEventListener("input", updateImpliedNewPriceNote);
ageAtPurchaseInput.addEventListener("input", updateImpliedNewPriceNote);
updateVisibility();
updateImpliedNewPriceNote();

// Chrome/Edge filter datalist suggestions to only those matching the current value, so a
// field already holding e.g. "15000" only shows that one match instead of all presets.
// Clearing the value on focus (and restoring it on blur if nothing was picked) works around this.
function enableDatalistBrowsing(id) {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener("focus", () => {
    input.dataset.previousValue = input.value;
    input.value = "";
  });
  input.addEventListener("blur", () => {
    if (input.value === "" && input.dataset.previousValue) {
      input.value = input.dataset.previousValue;
    }
  });
}
["price", "ageAtPurchase", "holdingYears", "annualMileage"].forEach(enableDatalistBrowsing);

function readInputs() {
  const assumptions = JSON.parse(JSON.stringify(defaultAssumptions));

  const price = parseThousands(document.getElementById("price").value);
  const holdingYears = Number(document.getElementById("holdingYears").value);
  const months = Math.round(holdingYears * 12);

  assumptions.annualMileageKm = Number(document.getElementById("annualMileage").value) * 10;
  assumptions.discountRateAnnual = Number(document.getElementById("discountRate").value) / 100;
  assumptions.ageAtPurchaseYears = Number(document.getElementById("ageAtPurchase").value);
  assumptions.vehicleAge.baselineAnnualMileageKm = Number(document.getElementById("baselineAnnualMileage").value) * 10;
  assumptions.vehicleAge.mileageWeight = Number(document.getElementById("mileageWeight").value) / 100;

  assumptions.running.fuelType = fuelTypeSelect.value;
  assumptions.running.bensin.pricePerLiter = Number(document.getElementById("bensinPrice").value);
  assumptions.running.bensin.consumptionLPer100km = Number(document.getElementById("bensinConsumption").value);
  assumptions.running.diesel.pricePerLiter = Number(document.getElementById("dieselPrice").value);
  assumptions.running.diesel.consumptionLPer100km = Number(document.getElementById("dieselConsumption").value);
  assumptions.running.el.pricePerKwh = Number(document.getElementById("elPrice").value);
  assumptions.running.el.consumptionKwhPer100km = Number(document.getElementById("elConsumption").value);
  assumptions.insurance.halvMonthly = Number(document.getElementById("insuranceHalv").value);
  assumptions.insurance.helMonthly = Number(document.getElementById("insuranceHel").value);
  assumptions.insurance.helStartYears = Number(document.getElementById("insuranceHelStart").value);
  assumptions.insurance.helEndYears = Number(document.getElementById("insuranceHelEnd").value);
  assumptions.running.serviceMonthly = Number(document.getElementById("serviceMonthly").value);
  assumptions.tax.malusAnnualAmount = Number(document.getElementById("taxMalusAnnual").value);
  assumptions.tax.normalAnnualAmount = Number(document.getElementById("taxNormalAnnual").value);
  assumptions.tax.malusYears = Number(document.getElementById("taxMalusYears").value);
  assumptions.tires.setCost = Number(document.getElementById("tireSetCost").value);
  assumptions.tires.winterIntervalYears = Number(document.getElementById("winterTireInterval").value);
  assumptions.tires.summerIntervalYears = Number(document.getElementById("summerTireInterval").value);

  const financingMethod = financingMethodSelect.value;
  assumptions.financing.billan.downPaymentRatio = Number(document.getElementById("billanDownPayment").value) / 100;
  assumptions.financing.billan.interestRateAnnual = Number(document.getElementById("billanRate").value) / 100;
  assumptions.financing.billan.termYears = Number(document.getElementById("billanTerm").value);
  assumptions.financing.bolan.downPaymentRatio = Number(document.getElementById("bolanDownPayment").value) / 100;
  assumptions.financing.bolan.interestRateAnnual = Number(document.getElementById("bolanRate").value) / 100;
  assumptions.financing.leasing.monthlyFee = Number(document.getElementById("leasingFee").value);
  assumptions.financing.leasing.firstPaymentExtra = Number(document.getElementById("leasingFirstPayment").value);
  assumptions.financing.leasing.serviceIncluded = document.getElementById("leasingServiceIncluded").value === "true";
  assumptions.financing.leasing.winterTiresIncluded = document.getElementById("leasingWinterTires").value === "true";

  assumptions.risk.enabled = document.getElementById("riskEnabled").value === "true";
  assumptions.risk.weibullScaleMonths = Number(document.getElementById("expectedLifeYears").value) * 12;
  assumptions.risk.repairCostMedian = Number(document.getElementById("repairCostMedian").value);
  assumptions.risk.totalLossThreshold = Number(document.getElementById("totalLossThreshold").value) / 100;
  assumptions.risk.reliabilityFactor = Number(document.getElementById("reliabilityFactor").value);

  return { price, months, financingMethod, assumptions };
}

function renderResults(result, financingMethod) {
  resultsSection.classList.remove("hidden");

  const headline = result.risk ? result.risk.mean : result.deterministicTotal;
  resultMonthlyEl.textContent = formatCurrency(headline);

  if (result.risk) {
    resultIntervalEl.textContent =
      `80% av scenarierna hamnar mellan ${formatCurrency(result.risk.p10)} och ${formatCurrency(result.risk.p90)} / mån ` +
      `(${Math.round(result.risk.shareWithTotalLoss * 100)}% risk för minst ett totalhaveri under perioden)`;
  } else if (financingMethod === "leasing") {
    resultIntervalEl.textContent = "Vid leasing bärs värdeminsknings- och haveririsken av leasingbolaget.";
  } else {
    resultIntervalEl.textContent = "Haveririsk är avstängd i beräkningen.";
  }

  breakdownBody.innerHTML = "";
  const labels = [];
  const values = [];
  for (const [key, value] of Object.entries(result.categoryMonthly)) {
    const row = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.textContent = categoryLabels[key] ?? key;
    const tdValue = document.createElement("td");
    tdValue.textContent = formatCurrency(value);
    row.append(tdLabel, tdValue);
    breakdownBody.appendChild(row);
    labels.push(categoryLabels[key] ?? key);
    values.push(Math.round(value));
  }
  if (result.risk) {
    const row = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.textContent = "Förväntad risktillägg (haveri/totalhaveri)";
    const tdValue = document.createElement("td");
    tdValue.textContent = formatCurrency(result.risk.riskPremium);
    row.append(tdLabel, tdValue);
    breakdownBody.appendChild(row);
    labels.push("Risktillägg");
    values.push(Math.round(result.risk.riskPremium));
  }

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(chartCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Kr/månad", data: values, backgroundColor: "#0a6847" }],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } },
    },
  });
}

// Färgskala (ljusare = mindre sannolikt) för överlevnadsmarkörerna, nyckel = sannolikhet.
const survivalMarkerColors = {
  0.5: "#1d4ed8",
  0.25: "#2563eb",
  0.1: "#3b82f6",
  0.05: "#60a5fa",
  0.01: "#93c5fd",
};

function renderLifetimeChart(input) {
  const lifetime = computeLifetimeMonthlyCosts(input);
  const points = lifetime.ageYears.map((y, i) => ({ x: y, y: Math.round(lifetime.monthlyCost[i]) }));

  const survivalMarkers = lifetime.survivalMilestones.map((m) => ({
    value: m.ageYears,
    color: survivalMarkerColors[m.probability] ?? "#60a5fa",
    label: `${Math.round(m.probability * 100)}%`,
  }));

  if (lifetimeChartInstance) lifetimeChartInstance.destroy();
  lifetimeChartInstance = new Chart(lifetimeChartCanvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Kr/månad",
          data: points,
          borderColor: "#0a6847",
          backgroundColor: "#0a6847",
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.1,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        verticalMarkers: {
          markers: [
            { value: lifetime.purchaseAgeYears, color: "#b33", label: "Köp" },
            { value: lifetime.endOfOwnershipAgeYears, color: "#555", label: "Säljs" },
            ...survivalMarkers,
          ],
        },
      },
      scales: {
        x: { type: "linear", title: { display: true, text: "Bilens ålder (år)" } },
        y: { beginAtZero: true, title: { display: true, text: "Kr/månad" } },
      },
    },
    plugins: [verticalMarkerPlugin],
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  document.activeElement?.blur(); // Ensure a focused-and-cleared datalist field restores its value first
  const input = readInputs();
  const result = computeTco(input);
  renderResults(result, input.financingMethod);
  renderLifetimeChart(input);
});
