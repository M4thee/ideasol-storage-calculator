export type Tariff = "G11" | "G12" | "G13" | "other_unknown";

type TariffProfile = {
  label: string;
  averagePurchasePricePerKwh: number;
  highZonePricePerKwh: number;
  lowZonePricePerKwh: number;
  arbitrageDaysPerYear: number;
  highZoneConsumptionShare: number;
  strategy: string;
};

// Referencyjne, zmienne koszty brutto energii i dystrybucji dla gospodarstw
// domowych w 2026 r. Rzeczywiste stawki zależą od sprzedawcy, OSD i umowy.
// Przedział dla G12 obejmuje zwykłą taryfę G12 oraz wariant weekendowy G12w.
// Oba profile są oparte na taryfach PGE Obrót i PGE Dystrybucja na 2026 r.
const TARIFF_PROFILES: Record<Tariff, TariffProfile> = {
  G11: {
    label: "G11 — jedna strefa",
    averagePurchasePricePerKwh: 1.1,
    highZonePricePerKwh: 1.1,
    lowZonePricePerKwh: 1.1,
    arbitrageDaysPerYear: 0,
    highZoneConsumptionShare: 0,
    strategy: "Brak różnicy między strefami — korzyść magazynu wynika głównie z energii z PV i backupu.",
  },
  G12: {
    label: "G12 — taryfa dwustrefowa",
    averagePurchasePricePerKwh: 0.98,
    highZonePricePerKwh: 1.25,
    lowZonePricePerKwh: 0.61,
    arbitrageDaysPerYear: 365,
    highZoneConsumptionShare: 0.45,
    strategy: "Ładowanie w tańszej strefie i rozładowanie w droższej. Wynik obejmuje możliwy zakres dla G12 i wariantu weekendowego G12w.",
  },
  G13: {
    label: "G13 — trzy strefy",
    averagePurchasePricePerKwh: 0.98,
    highZonePricePerKwh: 1.32,
    lowZonePricePerKwh: 0.64,
    arbitrageDaysPerYear: 251,
    highZoneConsumptionShare: 0.32,
    strategy: "Ładowanie w najtańszej strefie i rozładowanie przede wszystkim w godzinach szczytowych.",
  },
  other_unknown: {
    label: "Inna / taryfa nieznana",
    averagePurchasePricePerKwh: 0.95,
    highZonePricePerKwh: 0.95,
    lowZonePricePerKwh: 0.95,
    arbitrageDaysPerYear: 0,
    highZoneConsumptionShare: 0,
    strategy: "Bez rozkładu stref nie doliczamy korzyści z ładowania magazynu tańszą energią.",
  },
};

const G12_WEEKEND_PROFILE: TariffProfile = {
  label: "G12w — wariant weekendowy",
  averagePurchasePricePerKwh: 0.97,
  highZonePricePerKwh: 1.3,
  lowZonePricePerKwh: 0.68,
  arbitrageDaysPerYear: 251,
  // Górna część przedziału pokazuje gospodarstwo, które dużą część energii
  // dokupuje w drogiej strefie dni roboczych. Dzięki temu 20 kWh może wykorzystać
  // większą część średniego dziennego zakupu, a 30 kWh nadal ogranicza realny popyt.
  highZoneConsumptionShare: 0.68,
  strategy: "Ładowanie nocą i w taniej strefie weekendowej, rozładowanie w drogiej strefie dni roboczych.",
};

const TARIFF_STORAGE_USABLE_CAPACITY_RATE = 0.95;
const TARIFF_STORAGE_ROUND_TRIP_EFFICIENCY = 0.92;

export function getTariffProfile(tariff: Tariff | null): TariffProfile {
  return TARIFF_PROFILES[tariff || "other_unknown"];
}

export function pickStorageVariant(requiredKwh: number) {
  // Wariant prezentowany jako 10 kWh ma rzeczywistą pojemność nominalną 10,24 kWh.
  if (requiredKwh <= 10.24) return 10;
  if (requiredKwh <= 15) return 15;
  if (requiredKwh <= 20) return 20;
  return 30;
}

export function estimateGridConsumptionFromBill(params: {
  yearlyBill: number;
  fixedYearlyCost: number;
  tariff: Tariff | null;
}) {
  const variableCost = Math.max(0, params.yearlyBill - params.fixedYearlyCost);
  return variableCost / getTariffProfile(params.tariff).averagePurchasePricePerKwh;
}

export function getTariffStorageFromConsumption(
  yearlyConsumptionKwh: number,
  tariff: Tariff | null
) {
  const profiles = tariff === "G12"
    ? [getTariffProfile(tariff), G12_WEEKEND_PROFILE]
    : [getTariffProfile(tariff)];
  if (profiles[0].arbitrageDaysPerYear <= 0 || yearlyConsumptionKwh <= 0) return 0;

  const requiredRatedCapacity = Math.max(...profiles.map((profile) => {
    const expensiveZoneDemandPerActiveDay =
      (yearlyConsumptionKwh * profile.highZoneConsumptionShare) /
      profile.arbitrageDaysPerYear;
    const economicDailyTargetKwh = expensiveZoneDemandPerActiveDay * 0.85;
    return economicDailyTargetKwh /
      (TARIFF_STORAGE_USABLE_CAPACITY_RATE * TARIFF_STORAGE_ROUND_TRIP_EFFICIENCY);
  }));

  return pickStorageVariant(requiredRatedCapacity);
}

export function getBackupStorageFromConsumption(yearlyConsumptionKwh: number) {
  if (yearlyConsumptionKwh <= 0) return 0;
  const dailyConsumptionKwh = yearlyConsumptionKwh / 365;
  const essentialBackupEnergyKwh = dailyConsumptionKwh * 0.35;
  return pickStorageVariant(
    essentialBackupEnergyKwh / TARIFF_STORAGE_USABLE_CAPACITY_RATE
  );
}

export function calculateTariffOptimization(params: {
  tariff: Tariff | null;
  storageKwh: number;
  yearlyConsumptionKwh: number;
}) {
  const profile = getTariffProfile(params.tariff);
  const scenarios = params.tariff === "G12"
    ? [profile, G12_WEEKEND_PROFILE]
    : [profile];
  const usableChargeKwh = params.storageKwh * TARIFF_STORAGE_USABLE_CAPACITY_RATE;
  const deliverableKwh = usableChargeKwh * TARIFF_STORAGE_ROUND_TRIP_EFFICIENCY;
  const calculations = scenarios.map((scenario) => {
    const expensiveZoneDemandPerActiveDay = scenario.arbitrageDaysPerYear > 0
      ? (params.yearlyConsumptionKwh * scenario.highZoneConsumptionShare) /
        scenario.arbitrageDaysPerYear
      : 0;
    const shiftedToExpensiveZoneKwh = Math.min(deliverableKwh, expensiveZoneDemandPerActiveDay);
    const chargedInCheapZoneKwh = TARIFF_STORAGE_ROUND_TRIP_EFFICIENCY > 0
      ? shiftedToExpensiveZoneKwh / TARIFF_STORAGE_ROUND_TRIP_EFFICIENCY
      : 0;
    const dailyBenefit = Math.max(
      0,
      shiftedToExpensiveZoneKwh * scenario.highZonePricePerKwh -
        chargedInCheapZoneKwh * scenario.lowZonePricePerKwh
    );

    return {
      profile: scenario,
      shiftedToExpensiveZoneKwh,
      dailyBenefit,
      yearlyMaximum: dailyBenefit * scenario.arbitrageDaysPerYear,
    };
  });
  const yearlyMaximums = calculations.map((calculation) => calculation.yearlyMaximum);
  const dailyBenefits = calculations.map((calculation) => calculation.dailyBenefit);
  const shiftedEnergy = calculations.map((calculation) => calculation.shiftedToExpensiveZoneKwh);
  const activeDays = calculations.map((calculation) => calculation.profile.arbitrageDaysPerYear);
  const highZonePrices = calculations.map((calculation) => calculation.profile.highZonePricePerKwh);
  const lowZonePrices = calculations.map((calculation) => calculation.profile.lowZonePricePerKwh);

  return {
    tariff: params.tariff,
    label: profile.label,
    strategy: profile.strategy,
    highZonePricePerKwh: Math.max(...highZonePrices),
    highZonePriceMinimumPerKwh: Math.min(...highZonePrices),
    lowZonePricePerKwh: Math.min(...lowZonePrices),
    lowZonePriceMaximumPerKwh: Math.max(...lowZonePrices),
    activeDaysPerYear: Math.max(...activeDays),
    activeDaysMinimumPerYear: Math.min(...activeDays),
    dailyBenefitMinimum: Math.min(...dailyBenefits),
    dailyBenefitMaximum: Math.max(...dailyBenefits),
    yearlyBenefitLow: Math.min(...yearlyMaximums) * 0.6,
    yearlyBenefitHigh: Math.max(...yearlyMaximums),
    shiftedEnergyPerActiveDayKwh: Math.max(...shiftedEnergy),
    shiftedEnergyMinimumPerActiveDayKwh: Math.min(...shiftedEnergy),
    isTimeOfUse: profile.arbitrageDaysPerYear > 0,
    includesWeekendVariant: params.tariff === "G12",
  };
}

export function getBestAlternativeTariffOptimization(params: {
  currentTariff: Tariff | null;
  storageKwh: number;
  yearlyConsumptionKwh: number;
}) {
  const alternativeCandidates: Tariff[] = ["G12", "G13"];
  const candidates: Tariff[] = params.currentTariff === "G12"
    ? ["G13"]
    : alternativeCandidates.filter((tariff) => tariff !== params.currentTariff);

  return candidates
    .map((tariff) => calculateTariffOptimization({
      tariff,
      storageKwh: params.storageKwh,
      yearlyConsumptionKwh: params.yearlyConsumptionKwh,
    }))
    .sort((left, right) => right.yearlyBenefitHigh - left.yearlyBenefitHigh)[0];
}

export function getStorageAlternatives(recommendedStorageKwh: number) {
  const variants = [10, 15, 20, 30];
  const index = variants.indexOf(recommendedStorageKwh);

  return {
    lower: index > 0 ? variants[index - 1] : null,
    higher: index >= 0 && index < variants.length - 1 ? variants[index + 1] : null,
  };
}
