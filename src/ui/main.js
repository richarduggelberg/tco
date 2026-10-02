import { computeTco } from "../calc/tco.js";
import { defaultAssumptions } from "../data/assumptions.js";
import { fetchAverageSpotPrice } from "../data/elpris.js";
import { formatCurrency, categoryLabels } from "./format.js";

const form = document.getElementById("tco-form");
const fuelTypeSelect = document.getElementById("fuelType");
const elomradeField = document.getElementById("elomrade-field");
const financingMethodSelect = document.getElementById("financingMethod");
const billanFields = document.getElementById("billan-fields");
const bolanFields = document.getElementById("bolan-fields");
const leasingFields = document.getElementById("leasing-fields");
const elomradeSelect = document.getElementById("elomrade");

const resultsSection = document.getElementById("results");
const resultMonthlyEl = document.getElementById("result-monthly");
const resultIntervalEl = document.getElementById("result-interval");
const breakdownBody = document.getElementById("breakdown-body");
const chartCanvas = document.getElementById("breakdown-chart");

let chartInstance = null;
let liveElectricityPrice = null;

function updateVisibility() {
  elomradeField.classList.toggle("hidden", fuelTypeSelect.value !== "el");
  billanFields.classList.toggle("hidden", financingMethodSelect.value !== "billan");
  bolanFields.classList.toggle("hidden", financingMethodSelect.value !== "bolan");
  leasingFields.classList.toggle("hidden", financingMethodSelect.value !== "leasing");
}

async function refreshElectricityPrice() {
  liveElectricityPrice = await fetchAverageSpotPrice(elomradeSelect.value, defaultAssumptions.running.electricityPricePerKwh);
}

fuelTypeSelect.addEventListener("change", () => {
  updateVisibility();
  if (fuelTypeSelect.value === "el") refreshElectricityPrice();
});
elomradeSelect.addEventListener("change", () => {
  if (fuelTypeSelect.value === "el") refreshElectricityPrice();
});
financingMethodSelect.addEventListener("change", updateVisibility);
updateVisibility();

function readInputs() {
  const assumptions = JSON.parse(JSON.stringify(defaultAssumptions));

  const price = Number(document.getElementById("price").value);
  const holdingYears = Number(document.getElementById("holdingYears").value);
  const months = Math.round(holdingYears * 12);

  assumptions.annualMileageKm = Number(document.getElementById("annualMileage").value);
  assumptions.discountRateAnnual = Number(document.getElementById("discountRate").value) / 100;
  assumptions.ageAtPurchaseYears = Number(document.getElementById("ageAtPurchase").value);

  assumptions.running.fuelType = fuelTypeSelect.value;
  if (fuelTypeSelect.value === "el" && liveElectricityPrice !== null) {
    assumptions.running.electricityPricePerKwh = liveElectricityPrice;
  }
  assumptions.insurance.halvMonthly = Number(document.getElementById("insuranceHalv").value);
  assumptions.insurance.helMonthly = Number(document.getElementById("insuranceHel").value);
  assumptions.insurance.helStartYears = Number(document.getElementById("insuranceHelStart").value);
  assumptions.insurance.helEndYears = Number(document.getElementById("insuranceHelEnd").value);
  assumptions.running.serviceMonthly = Number(document.getElementById("serviceMonthly").value);
  assumptions.tax.annualAmount = Number(document.getElementById("taxAnnual").value);
  assumptions.tires.setCost = Number(document.getElementById("tireSetCost").value);
  assumptions.tires.winterIntervalYears = Number(document.getElementById("winterTireInterval").value);
  assumptions.tires.summerIntervalYears = Number(document.getElementById("summerTireInterval").value);

  const financingMethod = financingMethodSelect.value;
  assumptions.financing.billan.downPaymentRatio = Number(document.getElementById("billanDownPayment").value) / 100;
  assumptions.financing.billan.interestRateAnnual = Number(document.getElementById("billanRate").value) / 100;
  assumptions.financing.billan.termYears = Number(document.getElementById("billanTerm").value);
  assumptions.financing.bolan.downPaymentRatio = Number(document.getElementById("bolanDownPayment").value) / 100;
  assumptions.financing.bolan.interestRateAnnual = Number(document.getElementById("bolanRate").value) / 100;
  assumptions.financing.bolan.amortizationRateAnnual = Number(document.getElementById("bolanAmortization").value) / 100;
  assumptions.financing.leasing.monthlyFee = Number(document.getElementById("leasingFee").value);
  assumptions.financing.leasing.firstPaymentExtra = Number(document.getElementById("leasingFirstPayment").value);
  assumptions.financing.leasing.taxAndServiceIncluded = document.getElementById("leasingIncluded").value === "true";
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = readInputs();
  const result = computeTco(input);
  renderResults(result, input.financingMethod);
});
