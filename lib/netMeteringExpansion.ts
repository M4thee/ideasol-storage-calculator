export type NetMeteringExpansionDecision =
  | "not_applicable"
  | "worth_checking"
  | "individual_analysis";

export type NetMeteringExpansionAnalysis = {
  decision: NetMeteringExpansionDecision;
  crossesTenKwpThreshold: boolean;
  currentPowerKwp: number;
  proposedPowerKwp: number;
  currentReturnRate: number;
  proposedReturnRate: number;
  currentUsableEnergyWithoutStorageKwh: number;
  proposedUsableEnergyWithoutStorageKwh: number;
  incrementalUsableEnergyWithoutStorageKwh: number;
  currentUsableEnergyWithStorageKwh: number;
  proposedUsableEnergyWithStorageKwh: number;
  incrementalUsableEnergyWithStorageKwh: number;
  estimatedIncrementalYearlyValueLow: number;
  estimatedIncrementalYearlyValueHigh: number;
};

type ExpansionScenario = {
  returnRate: number;
  usableEnergyWithoutStorageKwh: number;
  usableEnergyWithStorageKwh: number;
};

const SMALL_INSTALLATION_RETURN_RATE = 0.8;
const LARGE_INSTALLATION_RETURN_RATE = 0.7;
const STORAGE_ROUND_TRIP_EFFICIENCY = 0.9;
const STORAGE_USABLE_CAPACITY_RATE = 0.9;
const STORAGE_CYCLES_PER_YEAR = 250;
const MAX_SHIFTABLE_EXPORT_SHARE = 0.7;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getBaseAutoconsumptionRate(
  pvProductionKwh: number,
  yearlyConsumptionKwh: number
) {
  if (pvProductionKwh <= 0 || yearlyConsumptionKwh <= 0) return 0.2;

  const coverageRatio = pvProductionKwh / yearlyConsumptionKwh;
  if (coverageRatio <= 0.6) return 0.3;
  if (coverageRatio <= 1) return 0.25;
  if (coverageRatio <= 1.5) return 0.22;
  return 0.2;
}

function calculateScenario(params: {
  pvPowerKwp: number;
  yearlyConsumptionKwh: number;
  storageKwh: number;
  productionPerKwp: number;
}): ExpansionScenario {
  const {
    pvPowerKwp,
    yearlyConsumptionKwh,
    storageKwh,
    productionPerKwp,
  } = params;
  const productionKwh = pvPowerKwp * productionPerKwp;
  const returnRate =
    pvPowerKwp > 10
      ? LARGE_INSTALLATION_RETURN_RATE
      : SMALL_INSTALLATION_RETURN_RATE;
  const baseAutoconsumptionRate = getBaseAutoconsumptionRate(
    productionKwh,
    yearlyConsumptionKwh
  );
  const directlyConsumedKwh = Math.min(
    yearlyConsumptionKwh,
    productionKwh * baseAutoconsumptionRate
  );
  const exportedBeforeStorageKwh = Math.max(
    0,
    productionKwh - directlyConsumedKwh
  );
  const remainingConsumptionKwh = Math.max(
    0,
    yearlyConsumptionKwh - directlyConsumedKwh
  );
  const chargedFromPvKwh = Math.max(
    0,
    Math.min(
      exportedBeforeStorageKwh * MAX_SHIFTABLE_EXPORT_SHARE,
      remainingConsumptionKwh / STORAGE_ROUND_TRIP_EFFICIENCY,
      storageKwh * STORAGE_USABLE_CAPACITY_RATE * STORAGE_CYCLES_PER_YEAR
    )
  );
  const deliveredFromStorageKwh =
    chargedFromPvKwh * STORAGE_ROUND_TRIP_EFFICIENCY;
  const exportedAfterStorageKwh = Math.max(
    0,
    exportedBeforeStorageKwh - chargedFromPvKwh
  );

  return {
    returnRate,
    usableEnergyWithoutStorageKwh: Math.min(
      yearlyConsumptionKwh,
      directlyConsumedKwh + exportedBeforeStorageKwh * returnRate
    ),
    usableEnergyWithStorageKwh: Math.min(
      yearlyConsumptionKwh,
      directlyConsumedKwh +
        deliveredFromStorageKwh +
        exportedAfterStorageKwh * returnRate
    ),
  };
}

export function analyzeNetMeteringExpansion(params: {
  currentPvPowerKwp: number;
  proposedPvPowerKwp: number;
  yearlyConsumptionKwh: number;
  storageKwh: number;
  productionPerKwp: number;
  purchasePricePerKwh: number;
}): NetMeteringExpansionAnalysis {
  const {
    currentPvPowerKwp,
    proposedPvPowerKwp,
    yearlyConsumptionKwh,
    storageKwh,
    productionPerKwp,
    purchasePricePerKwh,
  } = params;
  const hasExpansion = proposedPvPowerKwp > currentPvPowerKwp;
  const current = calculateScenario({
    pvPowerKwp: currentPvPowerKwp,
    yearlyConsumptionKwh,
    storageKwh,
    productionPerKwp,
  });
  const proposed = calculateScenario({
    pvPowerKwp: proposedPvPowerKwp,
    yearlyConsumptionKwh,
    storageKwh,
    productionPerKwp,
  });
  const crossesTenKwpThreshold =
    hasExpansion && currentPvPowerKwp <= 10 && proposedPvPowerKwp > 10;
  const incrementalUsableEnergyWithoutStorageKwh = Math.max(
    0,
    proposed.usableEnergyWithoutStorageKwh -
      current.usableEnergyWithoutStorageKwh
  );
  const incrementalUsableEnergyWithStorageKwh = Math.max(
    0,
    proposed.usableEnergyWithStorageKwh - current.usableEnergyWithStorageKwh
  );
  const estimatedIncrementalYearlyValue =
    incrementalUsableEnergyWithStorageKwh * purchasePricePerKwh;

  return {
    decision: !hasExpansion
      ? "not_applicable"
      : crossesTenKwpThreshold
        ? "individual_analysis"
        : "worth_checking",
    crossesTenKwpThreshold,
    currentPowerKwp: currentPvPowerKwp,
    proposedPowerKwp: proposedPvPowerKwp,
    currentReturnRate: current.returnRate,
    proposedReturnRate: proposed.returnRate,
    currentUsableEnergyWithoutStorageKwh:
      current.usableEnergyWithoutStorageKwh,
    proposedUsableEnergyWithoutStorageKwh:
      proposed.usableEnergyWithoutStorageKwh,
    incrementalUsableEnergyWithoutStorageKwh,
    currentUsableEnergyWithStorageKwh: current.usableEnergyWithStorageKwh,
    proposedUsableEnergyWithStorageKwh: proposed.usableEnergyWithStorageKwh,
    incrementalUsableEnergyWithStorageKwh,
    estimatedIncrementalYearlyValueLow: clamp(
      estimatedIncrementalYearlyValue * 0.85,
      0,
      Number.MAX_SAFE_INTEGER
    ),
    estimatedIncrementalYearlyValueHigh: clamp(
      estimatedIncrementalYearlyValue * 1.15,
      0,
      Number.MAX_SAFE_INTEGER
    ),
  };
}
