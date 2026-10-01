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
  financing: "Finansiering (kapitalkostnad/lån/leasingavgift)",
  energy: "Bränsle/el",
  tax: "Fordonsskatt",
  insurance: "Försäkring",
  service: "Service, däck, besiktning",
  residual: "Restvärde (avgår)",
};
