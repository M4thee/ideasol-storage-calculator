export type StorageVariantKwh = 10 | 15 | 20 | 30;

type StorageBundlePrice = {
  storageKwh: StorageVariantKwh;
  nominalCapacityKwh: number;
  priceLowGross: number;
  priceHighGross: number;
};

// Jednorazowy snapshot produkcyjnego kalkulatora CRM z 19.08.2026.
// Zestaw: EcoBSS FLEX 3L 6K + wskazany magazyn EcoBSS, VAT 8%,
// prowizja handlowca 3 000 zł netto. Górna granica = cena dolna + 11%.
const STORAGE_BUNDLE_PRICES: Record<StorageVariantKwh, StorageBundlePrice> = {
  10: {
    storageKwh: 10,
    nominalCapacityKwh: 10.24,
    priceLowGross: 28_626,
    priceHighGross: 31_775,
  },
  15: {
    storageKwh: 15,
    nominalCapacityKwh: 15,
    priceLowGross: 29_845,
    priceHighGross: 33_128,
  },
  20: {
    storageKwh: 20,
    nominalCapacityKwh: 20,
    priceLowGross: 32_945,
    priceHighGross: 36_569,
  },
  30: {
    storageKwh: 30,
    nominalCapacityKwh: 30,
    priceLowGross: 36_894,
    priceHighGross: 40_952,
  },
};

const EU_EQUIPMENT_SUBSIDY_BONUS = 2_000;

function normalizeStorageVariant(storageKwh: number): StorageVariantKwh {
  if (storageKwh <= 10.24) return 10;
  if (storageKwh <= 15) return 15;
  if (storageKwh <= 20) return 20;
  return 30;
}

export function getStorageBundlePrice(storageKwh: number) {
  return STORAGE_BUNDLE_PRICES[normalizeStorageVariant(storageKwh)];
}

export function calculatePmeSubsidyRange(params: {
  billingSystem: "net_billing" | "net_metering" | "unknown" | null;
  storageKwh: number;
}) {
  const bundle = getStorageBundlePrice(params.storageKwh);
  const programCap = params.billingSystem === "net_metering" ? 8_000 : 16_000;
  const storageCapByKwh = bundle.nominalCapacityKwh * 800;
  const maxStorageSubsidy = Math.min(storageCapByKwh, programCap);

  const calculateForPrice = (qualifyingCostGross: number) => {
    const storageSubsidy = Math.min(
      qualifyingCostGross * 0.3,
      storageCapByKwh,
      programCap
    );
    const euBonus = Math.min(
      qualifyingCostGross * 0.5,
      EU_EQUIPMENT_SUBSIDY_BONUS
    );

    return {
      qualifyingCostGross: Math.round(qualifyingCostGross),
      storageSubsidy: Math.round(storageSubsidy),
      euBonus: Math.round(euBonus),
      total: Math.round(storageSubsidy + euBonus),
    };
  };

  const low = calculateForPrice(bundle.priceLowGross);
  const high = calculateForPrice(bundle.priceHighGross);

  return {
    low,
    high,
    nominalCapacityKwh: bundle.nominalCapacityKwh,
    storageCapByKwh: Math.round(storageCapByKwh),
    maxStorageSubsidy: Math.round(maxStorageSubsidy),
    programCap,
  };
}
