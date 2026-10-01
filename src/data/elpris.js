// Hämtar dagsaktuellt spotpris på el från elprisetjustnu.se (öppet, gratis API, ingen nyckel krävs).
// https://www.elprisetjustnu.se/elpris-api

const AREAS = ["SE1", "SE2", "SE3", "SE4"];

/**
 * Hämtar dagens timpriser (öre/kWh → SEK/kWh) för ett elområde och returnerar dagens snittpris.
 * @param {string} area - "SE1" | "SE2" | "SE3" | "SE4"
 * @param {number} fallbackPricePerKwh - Används om anropet misslyckas (nätverk/CORS)
 * @returns {Promise<number>} SEK per kWh
 */
export async function fetchAverageSpotPrice(area = "SE3", fallbackPricePerKwh = 1.8) {
  if (!AREAS.includes(area)) {
    throw new Error(`Okänt elområde: ${area}`);
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const url = `https://www.elprisetjustnu.se/api/v1/prices/${year}/${month}-${day}_${area}.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const hours = await response.json();
    if (!Array.isArray(hours) || hours.length === 0) throw new Error("Tomt svar");
    const avgSekPerKwh = hours.reduce((sum, h) => sum + h.SEK_per_kWh, 0) / hours.length;
    return avgSekPerKwh;
  } catch (err) {
    console.warn("Kunde inte hämta elpris, använder standardvärde:", err.message);
    return fallbackPricePerKwh;
  }
}
