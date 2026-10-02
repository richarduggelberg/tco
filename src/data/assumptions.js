// Standardantaganden för TCO-kalkylatorn. Alla värden kan ändras av användaren i UI:t.

export const defaultAssumptions = {
  // Allmänt
  discountRateAnnual: 0.05, // Alternativkostnad för kapital, används för att nuvärdesberäkna ALLA finansieringsmetoder lika
  holdingPeriodYears: 5,
  annualMileageKm: 1500 * 10, // ~15 000 mil/år i km (15000)
  ageAtPurchaseYears: 0, // Bilens kalenderålder (sedan tillverkning) vid köpet - 0 = nyköpt

  // Värdeminskning (årlig, appliceras stegvis - år 1 störst, avtar sedan)
  depreciation: {
    yearlyRates: [0.20, 0.15, 0.12, 0.10, 0.10, 0.08, 0.08, 0.08, 0.08, 0.08], // år 1..10, år 11+ använder sista värdet
  },

  // Finansiering
  financing: {
    method: "kontant", // "kontant" | "billan" | "bolan"
    kontant: {
      // Ingen extra data behövs - alternativkostnaden hanteras av discountRateAnnual
    },
    billan: {
      downPaymentRatio: 0.20,
      interestRateAnnual: 0.07,
      termYears: 5,
    },
    bolan: {
      downPaymentRatio: 0.0, // Hela beloppet läggs ofta på lånet
      interestRateAnnual: 0.035,
      amortizationRateAnnual: 0.01, // Enligt amorteringskravet, 1% eller 2% beroende på belåningsgrad
    },
    leasing: {
      monthlyFee: 4500, // Schablon - ersätt med en verklig privatleasingoffert
      firstPaymentExtra: 0, // "Förhöjd leasingavgift" vid tecknande, om tillämpligt
      taxAndServiceIncluded: true, // Vanligt i privatleasingerbjudanden
      winterTiresIncluded: false, // Vissa leasingavtal inkluderar vinterdäck/hjulårsförvaring
    },
  },

  // Drift
  running: {
    serviceMonthly: 400, // Periodiserad service/besiktning
    fuelPricePerLiter: 17.5, // SEK/liter, bensin/diesel-snitt
    consumptionLPer10km: 0.6, // L/mil → 6.0 L/100km
    electricityPricePerKwh: 1.8, // SEK/kWh, fallback om live-data inte går att hämta
    consumptionKwhPer10km: 1.8, // kWh/mil
    fuelType: "bensin", // "bensin" | "diesel" | "el"
  },

  // Försäkring: växlar automatiskt mellan halv- och helförsäkring utifrån bilens kalenderålder.
  // Vanligt mönster i Sverige: nya bilar har ofta en vagnskadegaranti (~3 år) från
  // tillverkaren som täcker motsvarande vagnskadeförsäkring, så halvförsäkring räcker.
  // Därefter behövs helförsäkring för samma skydd, tills bilens värde blivit så lågt att
  // det inte längre lönar sig - då återgår man till halvförsäkring.
  insurance: {
    halvMonthly: 400,
    helMonthly: 650,
    helStartYears: 3, // Kalenderålder då vagnskadegarantin normalt löper ut
    helEndYears: 8, // Kalenderålder då helförsäkring inte längre lönar sig
  },

  // Däck: återkommande klumpkostnad för byte av däckuppsättning (samma kostnadsantagande
  // används för både vinter- och sommardäck, men med separata bytesintervall).
  tires: {
    setCost: 6000,
    winterIntervalYears: 4,
    summerIntervalYears: 5,
  },

  // Fordonsskatt (mycket förenklad - verklig bonus-malus beror på CO2/vikt/drivmedel)
  tax: {
    annualAmount: 2000,
  },

  // Haveririsk (Monte Carlo)
  risk: {
    enabled: true,
    numSimulations: 3000,
    weibullShape: 2.5, // k - ökande haveriintensitet med ålder
    weibullScaleMonths: 180, // lambda - karaktäristisk livslängd (15 år)
    repairCostMedian: 25000, // SEK, log-normalfördelning
    repairCostSigma: 0.8, // log-normal spridningsparameter
    totalLossThreshold: 0.5, // Totalhaveri om reparationskostnad > 50% av bilens aktuella värde
    reliabilityFactor: 1.0, // 1 = snitt, <1 mer pålitlig, >1 mindre pålitlig
  },
};
