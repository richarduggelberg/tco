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

/** Formaterar en siffersträng med mellanslag som tusentalsavgränsare, t.ex. "300000" -> "300 000". */
export function formatThousands(value) {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Tolkar en (ev. mellanslagsformaterad) siffersträng tillbaka till ett tal. */
export function parseThousands(value) {
  const digits = String(value).replace(/\D/g, "");
  return digits ? Number(digits) : 0;
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
