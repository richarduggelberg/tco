import { computeTco, computeLifetimeMonthlyCosts, resolveDepreciation } from "../calc/tco.js";
import { impliedNewPrice } from "../calc/depreciation.js";
import { defaultAssumptions, fuelTypeDefaults } from "../data/assumptions.js";
import { formatCurrency, categoryLabels, formatThousands, parseThousands } from "./format.js";

const form = document.getElementById("tco-form");
const fuelTypeSelect = document.getElementById("fuelType");
const financingMethodSelect = document.getElementById("financingMethod");
const billanFields = document.getElementById("billan-fields");
const bolanFields = document.getElementById("bolan-fields");
const leasingFields = document.getElementById("leasing-fields");
const impliedNewPriceNote = document.getElementById("implied-newprice-note");
const residualNote = document.getElementById("residual-note");

const resultsSection = document.getElementById("results");
const resultMonthlyEl = document.getElementById("result-monthly");
const resultIntervalEl = document.getElementById("result-interval");
const resultResidualEl = document.getElementById("result-residual");
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

function showNote(element, text) {
  element.textContent = text;
  element.classList.remove("hidden");
}

/** Månader som en läsbar ålder/period i år, t.ex. 60 -> "5", 42 -> "3,5". */
function formatYears(months) {
  return (months / 12).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
}

/** Uppdaterar de hjälptexter som beror på flera fält samtidigt (pris, restvärde, ålder m.m.). */
function updateDerivedNotes() {
  const input = readInputs();
  updateImpliedNewPriceNote(input);
  updateResidualNote(input);
}

/**
 * Visar uppskattat nypris, beräknat med SAMMA värdeminskningskurva som kalkylen använder
 * (dvs. inkl. ev. justerad takt och/eller restvärde-kalibrering).
 */
function updateImpliedNewPriceNote(input) {
  if (!input.price || !input.assumptions.ageAtPurchaseYears || !input.months) {
    impliedNewPriceNote.classList.add("hidden");
    return;
  }
  const { yearlyRates } = resolveDepreciation(input);
  const newPrice = impliedNewPrice(input.price, Math.round(input.assumptions.ageAtPurchaseYears * 12), yearlyRates);
  if (!Number.isFinite(newPrice)) {
    impliedNewPriceNote.classList.add("hidden");
    return;
  }
  showNote(impliedNewPriceNote, `Uppskattat nypris (baklängesräknat från värdeminskningskurvan): ~${formatCurrency(newPrice)}`);
}

/**
 * Förklarar hur värdeminskningskurvan styrs: tomt restvärde = kurvan som den är (ev. justerad
 * takt), angivet restvärde = kurvan kalibreras baklänges så att den landar på det värdet.
 */
function updateResidualNote(input) {
  if (input.financingMethod === "leasing") {
    showNote(residualNote, "Vid leasing ägs bilen av leasingbolaget - värdeminskning och restvärde används inte i kalkylen.");
    return;
  }
  if (!input.price || !input.months) {
    residualNote.classList.add("hidden");
    return;
  }

  const model = resolveDepreciation(input);
  const target = input.assumptions.depreciation.residualTarget;
  const ratePercent = Math.round(model.rateMultiplier * 100);

  if (!model.calibrated) {
    showNote(
      residualNote,
      `Tomt: värdeminskningen följer modellens kurva (${ratePercent}% av standardtakten). ` +
        "Fyll i ett restvärde du känner till för att låsa kurvan vid det värdet."
    );
    return;
  }

  if (!model.feasible) {
    showNote(
      residualNote,
      target >= input.price
        ? `Restvärdet (${formatCurrency(target)}) är högre än inköpspriset - ingen värdeminskning räknas, ` +
            "bilen antas vara värd inköpspriset hela innehavstiden."
        : `Restvärdet (${formatCurrency(target)}) går inte att nå med modellen - även en mycket brantare kurva ` +
            "lämnar ett högre värde."
    );
    return;
  }

  showNote(
    residualNote,
    `Kurvan kalibreras baklänges så att bilen är värd ${formatCurrency(target)} efter ` +
      `${formatYears(input.months)} år - det motsvarar ${ratePercent}% av standardvärdeminskningen.`
  );
}

// Fält som fylls i automatiskt utifrån drivmedel. Vi kommer ihåg vilka fält användaren
// själv har rört, så att ett byte av drivmedel inte skriver över manuellt angivna värden.
const fuelDerivedFieldIds = [
  "taxMalusAnnual",
  "taxNormalAnnual",
  "taxMalusYears",
  "expectedLifeYears",
  "repairCostMedian",
  "reliabilityFactor",
];
const manuallyEditedFields = new Set();
for (const id of fuelDerivedFieldIds) {
  document.getElementById(id)?.addEventListener("input", () => manuallyEditedFields.add(id));
}

/** Sätter ett fältvärde om användaren inte redan har ändrat fältet manuellt. */
function setFieldUnlessEdited(id, value) {
  if (manuallyEditedFields.has(id)) return;
  document.getElementById(id).value = value;
}

/** Fyller i rimliga standardvärden för skatt/haveririsk baserat på valt drivmedel. */
function applyFuelTypeDefaults() {
  const defaults = fuelTypeDefaults[fuelTypeSelect.value];
  if (!defaults) return;
  setFieldUnlessEdited("taxMalusAnnual", defaults.tax.malusAnnualAmount);
  setFieldUnlessEdited("taxNormalAnnual", defaults.tax.normalAnnualAmount);
  setFieldUnlessEdited("taxMalusYears", defaults.tax.malusYears);
  setFieldUnlessEdited("expectedLifeYears", Math.round(defaults.risk.weibullScaleMonths / 12));
  setFieldUnlessEdited("repairCostMedian", defaults.risk.repairCostMedian);
  setFieldUnlessEdited("reliabilityFactor", defaults.risk.reliabilityFactor);
}

fuelTypeSelect.addEventListener("change", () => {
  updateVisibility();
  applyFuelTypeDefaults();
  updateDerivedNotes();
});
financingMethodSelect.addEventListener("change", () => {
  updateVisibility();
  updateDerivedNotes();
});

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
enableThousandsInput("residualValue");

// Hjälptexterna (nypris, restvärde/kalibrering) beror på pris, restvärde, ålder, innehavstid
// och körsträcka - uppdatera dem direkt när något av de fälten ändras.
[
  "price",
  "residualValue",
  "ageAtPurchase",
  "holdingYears",
  "annualMileage",
  "baselineAnnualMileage",
  "mileageWeight",
  "depreciationMultiplier",
].forEach((id) => document.getElementById(id)?.addEventListener("input", updateDerivedNotes));

updateVisibility();
updateDerivedNotes();

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

/** Restvärdet från fältet, eller null när fältet är tomt (då används värdeminskningskurvan). */
function readResidualTarget() {
  const digits = document.getElementById("residualValue").value.replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

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

  // Värdeminskningsmodellen: justerbar takt, och ett frivilligt restvärde som - om det anges -
  // kalibrerar kurvan baklänges (se resolveDepreciation i calc/tco.js). Tomt fält = null.
  const multiplierRaw = document.getElementById("depreciationMultiplier").value.trim();
  assumptions.depreciation.rateMultiplier = multiplierRaw === "" ? 1 : Number(multiplierRaw) / 100;
  assumptions.depreciation.residualTarget = readResidualTarget();

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

  // Restvärde och värdeminskning är bara relevant när man äger bilen själv (ej leasing).
  if (result.residualValue != null) {
    // Anger användaren ett restvärde är det kurvan kalibrerats mot - visa det tydligt.
    const calibrated = result.depreciationModel?.calibrated
      ? " (enligt angivet restvärde)"
      : "";
    const impliedRate = result.depreciationModel?.calibrated && result.depreciationModel.feasible
      ? ` · Värdeminskningstakt: ${Math.round(result.depreciationModel.rateMultiplier * 100)}% av standard`
      : "";
    resultResidualEl.textContent =
      `Restvärde efter ägandetiden${calibrated}: ${formatCurrency(result.residualValue)} ` +
      `· Värdeminskning under ägandetiden: ${formatCurrency(result.valueLost)}${impliedRate}`;
    resultResidualEl.classList.remove("hidden");
  } else {
    resultResidualEl.classList.add("hidden");
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

// Ordning och färger för komponenterna i den staplade livscykel-grafen (nedifrån och upp).
const lifetimeComponentStyles = [
  { key: "energy", label: categoryLabels.energy, color: "#93c5fd" },
  { key: "tax", label: categoryLabels.tax, color: "#fcd34d" },
  { key: "insurance", label: categoryLabels.insurance, color: "#c4b5fd" },
  { key: "service", label: categoryLabels.service, color: "#6ee7b7" },
  { key: "tires", label: categoryLabels.tires, color: "#cbd5e1" },
  { key: "depreciation", label: categoryLabels.depreciation, color: "#f87171" },
  { key: "capitalCost", label: categoryLabels.kapitalkostnad, color: "#38bdf8" },
  { key: "risk", label: "Haveririsk (förväntad)", color: "#fb923c" },
  { key: "leasing", label: categoryLabels.leasingavgift, color: "#a78bfa" },
];

function renderLifetimeChart(input) {
  const lifetime = computeLifetimeMonthlyCosts(input);
  const totalPoints = lifetime.ageYears.map((y, i) => ({ x: y, y: Math.round(lifetime.monthlyCost[i]) }));

  // En staplad area per kostnadspost; den översta kanten av stapeln utgör totalkostnaden.
  const componentDatasets = lifetimeComponentStyles
    .filter((style) => lifetime.components[style.key].some((v) => Math.abs(v) > 0.5))
    .map((style) => ({
      label: style.label,
      data: lifetime.ageYears.map((y, i) => ({ x: y, y: Math.round(lifetime.components[style.key][i]) })),
      borderColor: style.color,
      backgroundColor: style.color,
      fill: true,
      pointRadius: 0,
      borderWidth: 1,
      tension: 0.1,
      stack: "cost",
    }));

  const totalDataset = {
    label: "Total månadskostnad",
    data: totalPoints,
    borderColor: "#0a6847",
    backgroundColor: "#0a6847",
    fill: false,
    pointRadius: 0,
    borderWidth: 2,
    tension: 0.1,
    stack: "total",
    order: -1,
  };

  const survivalMarkers = lifetime.survivalMilestones.map((m) => ({
    value: m.ageYears,
    color: survivalMarkerColors[m.probability] ?? "#60a5fa",
    label: `${Math.round(m.probability * 100)}%`,
  }));

  if (lifetimeChartInstance) lifetimeChartInstance.destroy();
  lifetimeChartInstance = new Chart(lifetimeChartCanvas, {
    type: "line",
    data: { datasets: [totalDataset, ...componentDatasets] },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "bottom" },
        verticalMarkers: {
          markers: [
            { value: lifetime.purchaseAgeYears, color: "#b33", label: "Köp" },
            { value: lifetime.endOfOwnershipAgeYears, color: "#555", label: "Säljs" },
            ...survivalMarkers,
          ],
        },
      },
            scales: {
        x: {
          type: "linear",
          min: 0,
          // Låt axeln sluta exakt där datat slutar (annars förlänger Chart.js den till
          // nästa "jämna" tick, t.ex. 35 när sista punkten ligger på 34).
          max: lifetime.ageYears[lifetime.ageYears.length - 1],
          title: { display: true, text: "Bilens ålder (år)" },
        },
        y: { beginAtZero: true, stacked: true, title: { display: true, text: "Kr/månad" } },
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
