const currencyFormatter = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("sv-SE", {
  maximumFractionDigits: 0,
});

export function formatCurrency(value) {
  return currencyFormatter.format(value === 0 ? 0 : value);
}

export function formatNumber(value) {
  return numberFormatter.format(value);
}

export const categoryLabels = {
  leasingavgift: "Leasingavgift",
  kapitalkostnad: "Kapitalkostnad (alternativkostnad på bundet kapital)",
  laneranta: "Låneränta",
  energy: "Bränsle/el",
  tax: "Fordonsskatt",
  insurance: "Försäkring",
  service: "Service, besiktning",
  tires: "Däck (vinter/sommar)",
  depreciation: "Värdeminskning",
};
