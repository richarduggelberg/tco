// Standardantaganden för TCO-kalkylatorn. Alla värden kan ändras av användaren i UI:t.

export const defaultAssumptions = {
  // Allmänt
  discountRateAnnual: 0.04, // Alternativkostnad för kapital, används för att nuvärdesberäkna ALLA finansieringsmetoder lika
  holdingPeriodYears: 5,
  annualMileageKm: 1100 * 10, // 1 100 mil/år = 11 000 km/år (svenskt snitt)
  ageAtPurchaseYears: 0, // Bilens kalenderålder (sedan tillverkning) vid köpet - 0 = nyköpt

  // Körsträckans påverkan på bilens "ålder": en bil som körs mer åldras (värdemässigt
  // och haverimässigt) snabbare än kalendertiden, en lågkörd bil långsammare. Kurvorna för
  // värdeminskning/haveririsk är kalibrerade mot baselineAnnualMileageKm, som också antas
  // gälla ägandet INNAN köpet (se ageAtPurchaseYears) eftersom körsträckan dessförinnan är okänd.
  vehicleAge: {
    baselineAnnualMileageKm: 11000, // ~1100 mil/år (svenskt snitt) - antas gälla även ägandet innan köpet
    mileageWeight: 0.7, // Andel (0-1) av åldringseffekten som beror på körsträcka snarare än kalendertid
  },

  // Värdeminskning (årlig, appliceras stegvis - år 1 störst, avtar sedan)
  depreciation: {
    yearlyRates: [0.20, 0.15, 0.12, 0.10, 0.10, 0.08, 0.08, 0.08, 0.08, 0.08], // år 1..10, år 11+ använder sista värdet
    // Justeringsfaktor på kurvan ovan (1 = standard, 1.3 = 30% snabbare värdetapp, 0.7 = långsammare).
    // Alla bilar värdeminskar inte i samma takt (märke/modell, efterfrågan, skick). Används bara
    // när varken restvärde eller nypris är angett.
    rateMultiplier: 1,
    // Önskat restvärde (kr) vid ägandeperiodens slut. När det är satt (inte null/0) löses
    // rateMultiplier BAKLÄNGES så att värdeminskningskurvan landar exakt på detta värde.
    // Har högst prioritet av de tre sätten att bestämma kurvan.
    residualTarget: null,
    // Bilens nypris (kr), om det är känt. Bara meningsfullt för en bil som hade en ålder vid
    // köpet (> 0 år): kurvan kalibreras då mot bilens EGEN historik, dvs. från nypriset vid
    // ålder 0 till inköpspriset vid köptillfället. Används när inget restvärde är angett, och
    // dessutom alltid som måttstock för att bedöma inköpspriset (se assessPurchasePrice).
    newPrice: null,
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
      interestRateAnnual: 0.026, // Lånet antas aldrig amorteras under innehavstiden - bara räntan räknas som kostnad
    },
    leasing: {
      monthlyFee: 4500, // Schablon - ersätt med en verklig privatleasingoffert
      firstPaymentExtra: 0, // "Förhöjd leasingavgift" vid tecknande, om tillämpligt
      serviceIncluded: true, // Vanligt i privatleasingerbjudanden - fordonsskatt ingår dock normalt INTE
      winterTiresIncluded: false, // Vissa leasingavtal inkluderar vinterdäck/hjulårsförvaring
    },
  },

  // Drift
  running: {
    serviceMonthly: 400, // Periodiserad service/besiktning
    fuelType: "bensin", // "bensin" | "diesel" | "el"
    bensin: { pricePerLiter: 18, consumptionLPer100km: 7.0 },
    diesel: { pricePerLiter: 21, consumptionLPer100km: 5.5 },
    el: { pricePerKwh: 2, consumptionKwhPer100km: 18 },
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

  // Fordonsskatt (bonus-malus): förhöjd skatt (malus) de första åren efter tillverkning
  // för fossildrivna bilar, sedan en lägre normalnivå. Elbilar har ingen malus (se
  // fuelTypeDefaults nedan som ger el en platt, låg skatt).
  tax: {
    malusAnnualAmount: 6000, // kr/år under malusperioden
    normalAnnualAmount: 2000, // kr/år efter malusperioden
    malusYears: 3, // Bonus-malus-systemets malusperiod är 3 kalenderår sedan tillverkning/registrering
  },

  // Haveririsk (Monte Carlo)
  risk: {
    enabled: true,
    numSimulations: 3000,
    weibullShape: 2.5, // k - ökande haveriintensitet med ålder
    weibullScaleMonths: 204, // lambda - karaktäristisk livslängd (17 år)
    repairCostMedian: 35000, // SEK, log-normalfördelning (moderna bilar: sensorer, elektronik, växellåda)
    repairCostSigma: 0.8, // log-normal spridningsparameter
    totalLossThreshold: 0.7, // Totalhaveri om reparationskostnad > 70% av bilens aktuella värde
    reliabilityFactor: 1.0, // 1 = snitt, <1 mer pålitlig, >1 mindre pålitlig
  },
};

/**
 * Skatte- och riskantaganden som skiljer sig åt mellan drivmedel. Används av UI:t för att
 * fylla i rimliga standardvärden när användaren byter drivmedel - men bara för fält som
 * användaren inte redan har ändrat manuellt. Elbilar: ingen bonus-malus (låg platt skatt),
 * färre rörliga/slitagedelar ger lägre snitt-reparationskostnad och något lägre haveri-
 * frekvens, men batteribyten är sällsynta och mycket dyra vilket ger en bredare (mer
 * högerskev) kostnadsfördelning (högre repairCostSigma). Diesel: högre fordonsskatt än
 * bensin (permanent dieselpåslag utöver CO2-delen).
 */
export const fuelTypeDefaults = {
  bensin: {
    tax: { malusAnnualAmount: 6000, normalAnnualAmount: 2000, malusYears: 3 },
    risk: { weibullScaleMonths: 204, repairCostMedian: 35000, repairCostSigma: 0.8, reliabilityFactor: 1.0 },
  },
  diesel: {
    tax: { malusAnnualAmount: 9000, normalAnnualAmount: 3600, malusYears: 3 },
    risk: { weibullScaleMonths: 204, repairCostMedian: 37000, repairCostSigma: 0.8, reliabilityFactor: 1.0 },
  },
  el: {
    tax: { malusAnnualAmount: 360, normalAnnualAmount: 360, malusYears: 3 }, // Ingen malus för elbilar
    risk: { weibullScaleMonths: 224, repairCostMedian: 20000, repairCostSigma: 1.3, reliabilityFactor: 0.85 },
  },
};
