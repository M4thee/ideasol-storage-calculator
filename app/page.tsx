"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import {
  calculateTariffOptimization,
  estimateGridConsumptionFromBill,
  getBackupStorageFromConsumption,
  getBestAlternativeTariffOptimization,
  getStorageAlternatives,
  getTariffProfile,
  getTariffStorageFromConsumption,
  pickStorageVariant,
  type Tariff,
} from "@/lib/energyStorageTariff";
import { normalizePolishMobilePhone } from "@/lib/polishMobilePhone";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

type HasPv = "yes" | "no" | null;
type BillMode = "monthly" | "yearly";

type SettlementSystem = "net_billing" | "net_metering" | "unknown" | null;

type ThemeMode = "auto" | "light" | "dark";

type RecommendationType = "recommended" | "consider" | "not_recommended";

type CalculatorAnalyticsEvent =
  | "calculator_view"
  | "calculator_started"
  | "step_view"
  | "analysis_started"
  | "recommendation_shown"
  | "lead_submit_attempt"
  | "lead_submit_success"
  | "lead_submit_failed"
  | "report_unlocked"
  | "session_closed";

type CalculatorAnalyticsDetails = {
  stepNumber?: number;
  stepKey?: string;
  question?: string;
  answer?: string;
  recommendationType?: RecommendationType;
  recommendedStorageKwh?: number;
  leadClientId?: string;
  hasPv?: Exclude<HasPv, null>;
  errorCode?: string;
  errorMessage?: string;
  errorStatus?: number;
  useBeacon?: boolean;
};

function sendCalculatorAnalyticsEvent(
  sessionId: string,
  eventName: CalculatorAnalyticsEvent,
  details: CalculatorAnalyticsDetails = {}
) {
  if (typeof window === "undefined") return;

  const search = new URLSearchParams(window.location.search);
  const payload = JSON.stringify({
    sessionId,
    eventName,
    stepNumber: details.stepNumber,
    stepKey: details.stepKey,
    question: details.question,
    answer: details.answer,
    recommendationType: details.recommendationType,
    recommendedStorageKwh: details.recommendedStorageKwh,
    leadClientId: details.leadClientId,
    hasPv: details.hasPv,
    errorCode: details.errorCode,
    errorMessage: details.errorMessage,
    errorStatus: details.errorStatus,
    landingUrl: window.location.href,
    referrer: document.referrer || null,
    utmSource: search.get("utm_source"),
    utmMedium: search.get("utm_medium"),
    utmCampaign: search.get("utm_campaign"),
    utmContent: search.get("utm_content"),
    utmTerm: search.get("utm_term"),
    deviceType: window.innerWidth < 640 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop",
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  });

  if (details.useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/analytics/calculator-event",
      new Blob([payload], { type: "application/json" })
    );
    return;
  }

  void fetch("/api/analytics/calculator-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

const NET_BILLING_EXPORT_PRICE_PER_KWH = 0.34;
const NET_BILLING_BASE_AUTOCONSUMPTION_RATE = 0.2;
const NET_METERING_SMALL_INSTALLATION_RETURN_RATE = 0.8;
const NET_METERING_LARGE_INSTALLATION_RETURN_RATE = 0.7;
const STORAGE_ROUND_TRIP_EFFICIENCY = 0.9;
const STORAGE_USABLE_CAPACITY_RATE = 0.9;
const STORAGE_CYCLES_PER_YEAR = 250;
const MAX_SHIFTABLE_EXPORT_SHARE = 0.7;
const ESTIMATED_FIXED_YEARLY_ENERGY_COST = 420;
const ANNUAL_ENERGY_PRICE_GROWTH = 0.09;
const PV_PRODUCTION_PER_KWP = 1005;
const EU_EQUIPMENT_SUBSIDY_BONUS = 2000;

function calculateMaximumPmeSubsidy(params: {
  billingSystem: SettlementSystem;
  storageCapacityKwh: number;
}) {
  const programCap = params.billingSystem === "net_metering" ? 8000 : 16000;
  const storageCapacityKwh = Math.max(0, params.storageCapacityKwh);
  const storageCapByKwh = storageCapacityKwh * 800;
  const maxStorageSubsidy = Math.min(storageCapByKwh, programCap);
  const euBonus = EU_EQUIPMENT_SUBSIDY_BONUS;

  return {
    storageSubsidy: Math.round(maxStorageSubsidy),
    euBonus: Math.round(euBonus),
    total: Math.round(maxStorageSubsidy + euBonus),
    maxStorageSubsidy: Math.round(maxStorageSubsidy),
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMoneyWithDecimals(value: number) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPaybackRange(low: number, high: number) {
  return low === high ? `około ${low} lat` : `${low}–${high} lat`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseDecimal(value: string) {
  return Number(String(value).replace(",", ".")) || 0;
}
function formatPostalCode(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 5);

  if (digits.length <= 2) return digits;

  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function formatPhoneInput(value: string) {
  return value.replace(/[^0-9+]/g, "").slice(0, 15);
}

function getBrowserCookie(name: string) {
  if (typeof document === "undefined") return null;

  const prefix = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

function createMetaLeadEventId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `lead:${crypto.randomUUID()}`;
  }

  return `lead:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function getStorageFromConsumption(yearlyConsumptionKwh: number) {
  if (yearlyConsumptionKwh <= 7000) return 10;
  if (yearlyConsumptionKwh <= 11000) return 16;
  if (yearlyConsumptionKwh <= 15000) return 20;
  return 30;
}

function getSuggestedPvKw(yearlyConsumptionKwh: number) {
  if (yearlyConsumptionKwh <= 3500) return 4;
  if (yearlyConsumptionKwh <= 5000) return 5;
  if (yearlyConsumptionKwh <= 6500) return 6;
  if (yearlyConsumptionKwh <= 8500) return 8;
  if (yearlyConsumptionKwh <= 11000) return 10;
  return 12;
}

function roundUpToHalfKw(value: number) {
  return Math.ceil(value * 2) / 2;
}

function getSuggestedPvStorageSystem(yearlyConsumptionKwh: number) {
  const fallbackPvKw = getSuggestedPvKw(yearlyConsumptionKwh);
  const pvKw = yearlyConsumptionKwh > 0
    ? clamp(roundUpToHalfKw((yearlyConsumptionKwh / PV_PRODUCTION_PER_KWP) * 1.05), 4, 15)
    : fallbackPvKw;
  const storageKwh = pickStorageVariant(pvKw * 2);

  return {
    pvKw,
    storageKwh,
  };
}

function calculatePaybackYears(investmentAfterSubsidy: number, yearlySavings: number) {
  if (investmentAfterSubsidy <= 0) return 0;
  if (yearlySavings <= 0) return 30;

  let cumulativeSavings = 0;

  for (let year = 1; year <= 30; year += 1) {
    cumulativeSavings += yearlySavings * Math.pow(1 + ANNUAL_ENERGY_PRICE_GROWTH, year - 1);

    if (cumulativeSavings >= investmentAfterSubsidy) {
      return year;
    }
  }

  return 30;
}

function getMarketingPriceRange(baseCalculatorPriceWithoutSellerMarkup: number) {
  const priceLow = baseCalculatorPriceWithoutSellerMarkup + 3500;
  const priceHigh = Math.round(priceLow * 1.25);

  return [priceLow, priceHigh] as const;
}

function getPvStorageMarketingPriceRange(pvKw: number, storageKwh: number) {
  if (pvKw <= 4 && storageKwh <= 10) return [36000, 44000] as const;
  if (pvKw <= 5 && storageKwh <= 10) return [38000, 46500] as const;
  if (pvKw <= 6 && storageKwh <= 16) return [42000, 51000] as const;
  if (pvKw <= 8 && storageKwh <= 16) return [44400, 53600] as const;
  if (pvKw <= 10 && storageKwh <= 20) return [51900, 61600] as const;
  if (pvKw <= 12 && storageKwh <= 30) return [58900, 66800] as const;
  if (pvKw <= 15 && storageKwh <= 30) return [62600, 69900] as const;

  return [62600, 69900] as const;
}


function getOnlyStorageBasePriceWithoutSellerMarkup(storageKwh: number) {
  if (storageKwh <= 10) return 19000;
  if (storageKwh <= 16) return 25000;
  if (storageKwh <= 20) return 27800;
  return 43000;
}

function getPvStorageBasePriceWithoutSellerMarkup(pvKw: number, storageKwh: number) {
  if (pvKw <= 4 && storageKwh <= 10) return 30000;
  if (pvKw <= 5 && storageKwh <= 10) return 32000;
  if (pvKw <= 6 && storageKwh <= 16) return 36000;
  if (pvKw <= 8 && storageKwh <= 16) return 38400;
  if (pvKw <= 10 && storageKwh <= 20) return 45900;
  if (pvKw <= 12 && storageKwh <= 30) return 52900;
  return 52900;
}


function getBaseAutoconsumptionRate(params: {
  pvProductionKwh: number;
  yearlyConsumptionKwh: number;
}) {
  const { pvProductionKwh, yearlyConsumptionKwh } = params;

  if (pvProductionKwh <= 0 || yearlyConsumptionKwh <= 0) return NET_BILLING_BASE_AUTOCONSUMPTION_RATE;

  const coverageRatio = pvProductionKwh / yearlyConsumptionKwh;

  if (coverageRatio <= 0.6) return 0.3;
  if (coverageRatio <= 1) return 0.25;
  if (coverageRatio <= 1.5) return 0.22;
  return 0.2;
}

function getStorageEnergyFlow(params: {
  pvProductionKwh: number;
  yearlyConsumptionKwh: number;
  storageKwh: number;
  baseAutoconsumptionRate: number;
}) {
  const { pvProductionKwh, yearlyConsumptionKwh, storageKwh, baseAutoconsumptionRate } = params;
  const baseAutoconsumedKwh = Math.min(
    pvProductionKwh * baseAutoconsumptionRate,
    yearlyConsumptionKwh
  );
  const exportedBeforeStorageKwh = Math.max(0, pvProductionKwh - baseAutoconsumedKwh);
  const remainingConsumptionKwh = Math.max(0, yearlyConsumptionKwh - baseAutoconsumedKwh);
  const yearlyChargeCapacityKwh =
    storageKwh * STORAGE_USABLE_CAPACITY_RATE * STORAGE_CYCLES_PER_YEAR;
  const chargedFromPvKwh = Math.max(
    0,
    Math.min(
      exportedBeforeStorageKwh * MAX_SHIFTABLE_EXPORT_SHARE,
      remainingConsumptionKwh / STORAGE_ROUND_TRIP_EFFICIENCY,
      yearlyChargeCapacityKwh
    )
  );
  const deliveredFromStorageKwh = chargedFromPvKwh * STORAGE_ROUND_TRIP_EFFICIENCY;
  const autoconsumedWithStorageKwh = Math.min(
    yearlyConsumptionKwh,
    baseAutoconsumedKwh + deliveredFromStorageKwh
  );

  return {
    baseAutoconsumedKwh,
    exportedBeforeStorageKwh,
    chargedFromPvKwh,
    deliveredFromStorageKwh,
    autoconsumedWithStorageKwh,
    exportedAfterStorageKwh: Math.max(
      0,
      pvProductionKwh - baseAutoconsumedKwh - chargedFromPvKwh
    ),
    autoconsumptionRateWithStorage:
      pvProductionKwh > 0 ? autoconsumedWithStorageKwh / pvProductionKwh : 0,
  };
}


function getNetBillingStorageSavingsRange(params: {
  pvProductionKwh: number;
  yearlyConsumptionKwh: number;
  storageKwh: number;
  baseAutoconsumptionRate: number;
  purchasePricePerKwh: number;
}) {
  const { pvProductionKwh, yearlyConsumptionKwh, storageKwh, baseAutoconsumptionRate, purchasePricePerKwh } = params;

  const flow = getStorageEnergyFlow({
    pvProductionKwh,
    yearlyConsumptionKwh,
    storageKwh,
    baseAutoconsumptionRate,
  });
  const avoidedPurchaseValue = flow.deliveredFromStorageKwh * purchasePricePerKwh;
  const lostExportValue = flow.chargedFromPvKwh * NET_BILLING_EXPORT_PRICE_PER_KWH;
  const expectedSavings = Math.max(0, avoidedPurchaseValue - lostExportValue);

  return {
    baseAutoconsumptionRate,
    autoconsumptionRateWithStorage: flow.autoconsumptionRateWithStorage,
    additionalAutoconsumedKwh: flow.deliveredFromStorageKwh,
    chargedFromPvKwh: flow.chargedFromPvKwh,
    valueDifferencePerKwh:
      purchasePricePerKwh - NET_BILLING_EXPORT_PRICE_PER_KWH / STORAGE_ROUND_TRIP_EFFICIENCY,
    low: expectedSavings * 0.85,
    high: expectedSavings * 1.15,
  };
}

function getNetMeteringStorageSavingsRange(params: {
  pvProductionKwh: number;
  yearlyConsumptionKwh: number;
  storageKwh: number;
  currentPvPowerKw: number;
  baseAutoconsumptionRate: number;
  purchasePricePerKwh: number;
}) {
  const { pvProductionKwh, yearlyConsumptionKwh, storageKwh, currentPvPowerKw, baseAutoconsumptionRate, purchasePricePerKwh } = params;

  const returnRate =
    currentPvPowerKw > 10
      ? NET_METERING_LARGE_INSTALLATION_RETURN_RATE
      : NET_METERING_SMALL_INSTALLATION_RETURN_RATE;

  const flow = getStorageEnergyFlow({
    pvProductionKwh,
    yearlyConsumptionKwh,
    storageKwh,
    baseAutoconsumptionRate,
  });
  const valueDifferencePerKwh = purchasePricePerKwh * Math.max(
    0,
    STORAGE_ROUND_TRIP_EFFICIENCY - returnRate
  );
  const expectedSavings = flow.chargedFromPvKwh * valueDifferencePerKwh;

  return {
    baseAutoconsumptionRate,
    autoconsumptionRateWithStorage: flow.autoconsumptionRateWithStorage,
    additionalAutoconsumedKwh: flow.deliveredFromStorageKwh,
    chargedFromPvKwh: flow.chargedFromPvKwh,
    returnRate,
    valueDifferencePerKwh,
    low: expectedSavings * 0.85,
    high: expectedSavings * 1.15,
  };
}

function getRecommendation(params: {
  paybackYearsLow: number;
  paybackYearsHigh: number;
  alternativePaybackYearsLow: number;
  alternativePaybackYearsHigh: number;
  yearlyBill: number;
  shouldRecommendPvExpansion: boolean;
  priorities: string[];
}): {
  type: RecommendationType;
  title: string;
  description: string;
} {
  const {
    paybackYearsLow,
    paybackYearsHigh,
    alternativePaybackYearsLow,
    alternativePaybackYearsHigh,
    yearlyBill,
    shouldRecommendPvExpansion,
    priorities,
  } = params;
  const paybackYearsForRecommendation = Math.round((paybackYearsLow + paybackYearsHigh) / 2);
  const alternativePaybackYears = Math.round(
    (alternativePaybackYearsLow + alternativePaybackYearsHigh) / 2
  );
  const caresAboutBackup = priorities.includes("Awaryjne zasilanie domu w razie awarii");
  const caresAboutEfficiency = priorities.includes("Zwiększenie produktywności mojej instalacji fotowoltaicznej (zapobieganie wyłączeniom)");

  if (shouldRecommendPvExpansion && yearlyBill >= 3600) {
    return {
      type: "consider",
      title: "Wymagana indywidualna analiza",
      description:
        "Magazyn może poprawić wynik, ale obecna fotowoltaika pokrywa zbyt małą część zapotrzebowania, aby sprowadzić decyzję do prostego doboru baterii. Najpierw trzeba sprawdzić możliwość rozbudowy PV, profil zużycia w strefach i wymagania dotyczące zasilania awaryjnego.",
    };
  }

  if (paybackYearsForRecommendation <= 12) {
    return {
      type: "recommended",
      title: "Magazyn energii wygląda na dobrą inwestycję",
      description:
        "Szacowany okres zwrotu mieści się w przyjętym progu, a magazyn może zwiększyć wykorzystanie energii z fotowoltaiki i ograniczyć zmienne koszty zakupu prądu.",
    };
  }

  const tariffChangeCouldHelp =
    alternativePaybackYears <= 18 &&
    alternativePaybackYears + 1 < paybackYearsForRecommendation;
  const needsComplexOptimization =
    paybackYearsForRecommendation <= 18 ||
    tariffChangeCouldHelp ||
    (shouldRecommendPvExpansion && yearlyBill >= 3600) ||
    ((caresAboutBackup || caresAboutEfficiency) && yearlyBill >= 4800);

  if (needsComplexOptimization) {
    return {
      type: "consider",
      title: "Wymagana indywidualna analiza",
      description:
        "Wynik ma potencjał, ale nie sprowadza się do prostego ładowania magazynu z fotowoltaiki. Trzeba potwierdzić profil zużycia w strefach, taryfę, możliwość rozbudowy PV i wymagania dotyczące zasilania awaryjnego.",
    };
  }

  return {
    type: "not_recommended",
    title: "Magazyn energii nie jest opłacalny przy tych założeniach",
    description:
      "Rachunek i możliwe oszczędności są zbyt małe w stosunku do kosztu zakupu. Nawet po uwzględnieniu pracy taryfowej okres zwrotu pozostaje zbyt długi.",
  };
}

function getRecommendationBoxClass(type: RecommendationType) {
  if (type === "recommended") {
    return "border-emerald-300/30 bg-emerald-300/15";
  }

  if (type === "consider") {
    return "border-amber-300/35 bg-amber-300/15";
  }

  if (type === "not_recommended") {
    return "border-rose-300/30 bg-rose-300/15";
  }

  return "border-rose-300/30 bg-rose-300/15";
}

function getRecommendationBadge(type: RecommendationType) {
  if (type === "recommended") return "🟢 REKOMENDOWANY";
  if (type === "consider") return "🟡 WYMAGANA INDYWIDUALNA ANALIZA";
  return "🔴 NIE REKOMENDUJEMY";
}

export default function EnergyStorageCalculatorPage() {
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");
  const [hasStarted, setHasStarted] = useState(false);
  const [hasPv, setHasPv] = useState<HasPv>(null);
  const [pvPower, setPvPower] = useState("");
  const [settlementSystem, setSettlementSystem] = useState<SettlementSystem>(null);
  const [billMode, setBillMode] = useState<BillMode>("monthly");
  const [billAmount, setBillAmount] = useState("");
  const [tariff, setTariff] = useState<Tariff | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);

const [step, setStep] = useState(2);
const [priorities, setPriorities] = useState<string[]>([]);
const [expandedResultDetails, setExpandedResultDetails] = useState<Record<string, boolean>>({});
const [showDetailedResult, setShowDetailedResult] = useState(false);
const [isFullReportUnlocked, setIsFullReportUnlocked] = useState(false);

const [contactFirstName, setContactFirstName] = useState("");
const [contactLastName, setContactLastName] = useState("");
const [contactPostalCode, setContactPostalCode] = useState("");
const [contactPhone, setContactPhone] = useState("");
const [contactEmail, setContactEmail] = useState("");
const [marketingConsent, setMarketingConsent] = useState(false);
const [isSubmittingLead, setIsSubmittingLead] = useState(false);
const [leadSubmitStatus, setLeadSubmitStatus] =
  useState<"idle" | "success" | "error">("idle");
const [turnstileToken, setTurnstileToken] = useState("");
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const turnstileRef = useRef<HTMLDivElement | null>(null);
const hasTrackedResultViewRef = useRef(false);
const analyticsSessionIdRef = useRef<string | null>(null);
const analyticsMaxStageRef = useRef(0);
const trackedStepViewsRef = useRef<Set<string>>(new Set());
const [isTurnstileLoaded, setIsTurnstileLoaded] = useState(false);

  const trackCalculatorEvent = useCallback(
    (eventName: CalculatorAnalyticsEvent, details: CalculatorAnalyticsDetails = {}) => {
      const sessionId = analyticsSessionIdRef.current;
      if (!sessionId) return;

      if (typeof details.stepNumber === "number") {
        analyticsMaxStageRef.current = Math.max(analyticsMaxStageRef.current, details.stepNumber);
      }
      sendCalculatorAnalyticsEvent(sessionId, eventName, details);
    },
    []
  );

  useEffect(() => {
    const sessionId = window.crypto.randomUUID();
    analyticsSessionIdRef.current = sessionId;
    sendCalculatorAnalyticsEvent(sessionId, "calculator_view", { stepNumber: 0, stepKey: "wejscie" });

    const closeSession = () => {
      sendCalculatorAnalyticsEvent(sessionId, "session_closed", {
        stepNumber: analyticsMaxStageRef.current,
        stepKey: "wyjscie",
        useBeacon: true,
      });
    };

    window.addEventListener("pagehide", closeSession);
    return () => window.removeEventListener("pagehide", closeSession);
  }, []);

  useEffect(() => {
    const savedThemeMode = window.localStorage.getItem("energyStorageCalculatorTheme") as ThemeMode | null;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function updateSystemTheme() {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    }

    const initialThemeTimeout = window.setTimeout(() => {
      if (savedThemeMode === "auto" || savedThemeMode === "light" || savedThemeMode === "dark") {
        setThemeMode(savedThemeMode);
      }
      updateSystemTheme();
    }, 0);
    mediaQuery.addEventListener("change", updateSystemTheme);

    return () => {
      window.clearTimeout(initialThemeTimeout);
      mediaQuery.removeEventListener("change", updateSystemTheme);
    };
  }, []);

  useEffect(() => {
    if (!showResult) {
      return;
    }

    if (!turnstileSiteKey || !isTurnstileLoaded || !turnstileRef.current || !window.turnstile) {
      return;
    }

    setTurnstileToken("");
    turnstileRef.current.innerHTML = "";

    window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      callback: (token: string) => {
        setTurnstileToken(token);
      },
      "expired-callback": () => {
        setTurnstileToken("");
      },
    });
  }, [turnstileSiteKey, isTurnstileLoaded, showResult]);


  function changeThemeMode(nextThemeMode: ThemeMode) {
    setThemeMode(nextThemeMode);
    window.localStorage.setItem("energyStorageCalculatorTheme", nextThemeMode);
  }

  const formRef = useRef<HTMLDivElement | null>(null);
  const pvDetailsRef = useRef<HTMLDivElement | null>(null);
  const step4Ref = useRef<HTMLDivElement | null>(null);
  const step5Ref = useRef<HTMLDivElement | null>(null);
  const step6Ref = useRef<HTMLButtonElement | null>(null);
  const detailedReportRef = useRef<HTMLDivElement | null>(null);

  const analysisSteps = [
    "Analiza zużycia energii",
    "Dobór pojemności magazynu",
    "Sprawdzenie potencjału dotacji",
    "Szacowanie oszczędności",
  ];

  const isDarkMode = themeMode === "dark" || (themeMode === "auto" && systemTheme === "dark");

  const pageClass = isDarkMode
    ? "relative min-h-screen overflow-x-hidden bg-[#071510] px-4 pb-16 pt-4 text-white sm:px-6 lg:px-8"
    : "relative min-h-screen overflow-x-hidden bg-[#f4f5ef] px-4 pb-16 pt-4 text-[#13231d] sm:px-6 lg:px-8";

  const heroClass = isDarkMode
    ? "relative overflow-hidden rounded-[32px] border border-white/10 bg-[#10261f] text-white shadow-2xl shadow-black/20"
    : "relative overflow-hidden rounded-[32px] border border-[#13231d]/10 bg-[#10261f] text-white shadow-[0_30px_90px_rgba(16,38,31,0.18)]";

  const panelClass = isDarkMode
    ? "mx-auto w-full min-w-0 max-w-4xl scroll-mt-6 rounded-[30px] border border-white/10 bg-[#10261f] p-5 shadow-2xl shadow-black/20 sm:p-9"
    : "mx-auto w-full min-w-0 max-w-4xl scroll-mt-6 rounded-[30px] border border-[#13231d]/10 bg-white/80 p-5 shadow-[0_24px_70px_rgba(16,38,31,0.10)] backdrop-blur sm:p-9";

  const resultPanelClass = isDarkMode
    ? "space-y-6 overflow-hidden rounded-[26px] bg-[#091a14] p-4 text-white sm:p-8 [&_button]:text-white"
    : "space-y-6 overflow-hidden rounded-[26px] border border-[#13231d]/10 bg-[#fbfcf8] p-4 text-[#13231d] shadow-xl shadow-[#10261f]/5 sm:p-8";

  const resultCardClass = isDarkMode
    ? "border-b border-white/10 py-4 text-white"
    : "border-b border-[#13231d]/10 py-4";

  const mutedTextClass = isDarkMode ? "text-white/62" : "text-[#617069]";

  const eyebrowTextClass = isDarkMode ? "text-[#c7f36b]" : "text-[#397f72]";

  const themeButtonClass = (mode: ThemeMode) =>
    `rounded-full px-3 py-2 text-xs font-bold transition ${
      themeMode === mode
        ? isDarkMode
          ? "bg-[#c7f36b] text-[#10261f]"
          : "bg-[#10261f] text-white"
        : isDarkMode
          ? "bg-white/10 text-white/70 hover:bg-white/15 hover:text-white"
          : "bg-white/70 text-[#617069] hover:bg-white hover:text-[#13231d]"
    }`;

  const optionButtonClass = (isSelected: boolean, variant: "card" | "compact" = "card") => {
    const sizeClass = variant === "compact" ? "rounded-2xl px-4 py-3" : "rounded-[24px] p-5";

    return `${sizeClass} border text-left shadow-sm transition touch-manipulation hover:-translate-y-0.5 hover:shadow-md ${
      isSelected
        ? isDarkMode
          ? "border-[#c7f36b] bg-[#c7f36b]/12 text-white"
          : "border-[#397f72] bg-[#dff3d5] text-[#13231d]"
        : isDarkMode
          ? "border-white/10 bg-white/10 text-white hover:bg-white/15"
          : "border-[#13231d]/10 bg-white/90 text-[#13231d] hover:border-[#397f72]/35 hover:bg-[#f8faf5]"
    }`;
  };

  const inputClass = isDarkMode
    ? "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 font-medium text-white shadow-sm outline-none transition placeholder:text-white/40 focus:border-[#c7f36b] focus:ring-4 focus:ring-[#c7f36b]/10"
    : "rounded-2xl border border-[#13231d]/12 bg-white px-4 py-3 font-medium text-[#13231d] shadow-sm outline-none transition placeholder:text-[#8d9993] focus:border-[#397f72] focus:ring-4 focus:ring-[#8edbd2]/20";

  const labelClass = isDarkMode ? "text-sm font-semibold text-white/70" : "text-sm font-semibold text-[#52645d]";

  const hintBoxClass = isDarkMode
    ? "mt-4 rounded-[22px] border border-[#8edbd2]/20 bg-[#8edbd2]/10 p-4 text-sm leading-6 text-white/80"
    : "mt-4 rounded-[22px] border border-[#397f72]/15 bg-[#e9f6f1] p-4 text-sm leading-6 text-[#40534b]";

  const priorityHintBoxClass = isDarkMode
    ? "mt-2 rounded-[20px] border border-[#8edbd2]/20 bg-[#8edbd2]/10 p-4 text-sm leading-6 text-white/80 animate-[fadeInUp_0.35s_ease-out]"
    : "mt-2 rounded-[20px] border border-[#397f72]/15 bg-[#e9f6f1] p-4 text-sm leading-6 text-[#40534b] animate-[fadeInUp_0.35s_ease-out]";

  const backButtonClass = isDarkMode
    ? "mt-5 w-full rounded-2xl border border-white/10 bg-white/10 px-5 py-3 font-bold text-white transition hover:bg-white/15"
    : "mt-5 w-full rounded-2xl border border-[#13231d]/10 bg-white px-5 py-3 font-bold text-[#52645d] transition hover:bg-[#f4f5ef] hover:text-[#13231d]";

  const primaryButtonClass = isDarkMode
    ? "w-full rounded-2xl bg-[#c7f36b] px-5 py-3 font-bold text-[#10261f] shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-[#b9ed54] disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40 disabled:shadow-none"
    : "w-full rounded-2xl bg-[#10261f] px-5 py-3 font-bold text-white shadow-lg shadow-[#10261f]/15 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-[#aeb8b2] disabled:shadow-none";

  const contactPanelClass = isDarkMode
    ? "rounded-[24px] border border-[#c7f36b]/20 bg-[#c7f36b]/8 p-5 text-white shadow-xl shadow-black/10"
    : "rounded-[24px] border border-[#397f72]/15 bg-[#dff3d5] p-5 text-[#13231d] shadow-xl shadow-[#10261f]/5";

  const contactLabelClass = isDarkMode ? "text-sm font-semibold text-white/75" : "text-sm font-semibold text-[#40534b]";

  const contactInputClass = isDarkMode
    ? "mt-1 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 font-medium text-white outline-none transition placeholder:text-white/40 focus:border-[#c7f36b] focus:ring-4 focus:ring-[#c7f36b]/10"
    : "mt-1 w-full rounded-2xl border border-[#13231d]/12 bg-white px-4 py-3 font-medium text-[#13231d] outline-none transition placeholder:text-[#8d9993] focus:border-[#397f72] focus:ring-4 focus:ring-[#8edbd2]/20";

  const contactSubmitButtonClass = isDarkMode
    ? "mt-4 w-full rounded-2xl bg-[#c7f36b] px-5 py-3 font-bold text-[#10261f] shadow-lg shadow-black/10 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40 disabled:shadow-none"
    : "mt-4 w-full rounded-2xl bg-[#10261f] px-5 py-3 font-bold text-white shadow-lg shadow-[#10261f]/15 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-[#aeb8b2] disabled:shadow-none";

  const tariffHint = {
    G11: "W G11 nie ma tańszej strefy ładowania. Kalkulator nie doliczy więc korzyści taryfowej — magazyn oceniamy na podstawie PV, backupu i pozostałych priorytetów.",
    G12: "Dla taryfy dwustrefowej pokazujemy bezpieczny przedział korzyści obejmujący G12 i wariant weekendowy G12w. Dokładny wariant doradca potwierdzi później z rachunku.",
    G13: "Taryfa G13 daje więcej możliwości optymalizacji pracy magazynu energii, bo pozwala lepiej dopasować ładowanie i zużycie do różnych stref cenowych.",
    other_unknown: "Bez znajomości stref nie doliczamy korzyści taryfowej. Doradca może ją później policzyć z rachunku zawierającego zużycie w każdej strefie.",
  } satisfies Record<Tariff, string>;

  const settlementSystemHint: Record<Exclude<SettlementSystem, null>, string> = {
    net_metering:
      'System tzw. opustów, który obowiązuje dla instalacji założonych i zgłoszonych do 31.03.2022 roku. Polegał na tym, że operator sieci dystrybucyjnej przechowuje w "wirtualnym magazynie" od 70 do 80% nadwyżek przesłanej do sieci energii, w zależności od mocy instalacji fotowoltaicznej, umożliwiając jej późniejszy odbiór w kolejnych okresach rozliczeniowych.',
    net_billing:
      "System obowiązujący dla instalacji zainstalowanych i zgłoszonych od 01.04.2022 roku. W tym systemie nadwyżki energii są sprzedawane zakładowi energetycznemu po średnich cenach rynkowych, a energia pobrana z sieci jest kupowana po cenach dostawcy energii.",
    unknown:
      "Jeżeli nie masz pewności, w którym systemie rozliczana jest Twoja instalacja, wybierz tę opcję. Doradca może to później zweryfikować na podstawie daty zgłoszenia instalacji lub dokumentów od operatora.",
  };

  const priorityHint: Record<string, string> = {
    "Niższe rachunki":
      "Jedna z podstawowych ról magazynu energii to zwiększenie zużycia własnego prądu z fotowoltaiki. Dobrze skonfigurowany system sterowania może też wspierać sprzedaż energii w korzystniejszych godzinach, zamiast oddawania jej do sieci za bardzo niskie stawki.",
    "Awaryjne zasilanie domu w razie awarii":
      "Magazyn energii wyposażony w funkcję automatycznego zasilania awaryjnego może zasilać wybrane obwody domu podczas awarii sieci energetycznej. W prawidłowo dobranym systemie przełączenie na zasilanie z magazynu trwa zwykle mniej niż sekundę i jest praktycznie nieodczuwalne.",
    "Zwiększenie produktywności mojej instalacji fotowoltaicznej (zapobieganie wyłączeniom)":
      "W okresach wysokiej produkcji część instalacji fotowoltaicznych ogranicza pracę albo wyłącza się przez zbyt wysokie napięcie w sieci. To realna strata energii, szczególnie latem. Magazyn energii może stabilizować pracę instalacji i ograniczać straty wynikające z nadprodukcji oraz przeciążeń sieci.",
  };

  function goToStep(nextStep: number) {
    setStep(nextStep);
  }

  function scrollToElement(element: HTMLElement | null) {
    if (!element) return;

    window.setTimeout(() => {
      const startY = window.scrollY;
      const elementRect = element.getBoundingClientRect();
      const elementTop = elementRect.top + window.scrollY;
      const targetY = Math.max(0, elementTop - 24);
      const duration = 750;
      const startTime = window.performance.now();

      function easeInOutCubic(t: number) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      function animateScroll(currentTime: number) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easeInOutCubic(progress);
        const nextY = startY + (targetY - startY) * easedProgress;

        window.scrollTo(0, nextY);

        if (progress < 1) {
          window.requestAnimationFrame(animateScroll);
        }
      }

      window.requestAnimationFrame(animateScroll);
    }, 180);
  }

  function startAnalysis() {
    setHasStarted(true);
    goToStep(2);
    trackCalculatorEvent("calculator_started", { stepNumber: 1, stepKey: "start" });

    window.setTimeout(() => {
      scrollToElement(formRef.current);
    }, 80);
  }

  function selectHasPv(value: Exclude<HasPv, null>) {
    setHasPv(value);
    setShowResult(false);
    trackCalculatorEvent("step_view", {
      stepNumber: 1,
      stepKey: "odpowiedz_czy_masz_fotowoltaike",
      question: "Czy masz już instalację fotowoltaiczną?",
      answer: value === "yes"
        ? "Tak, mam instalację fotowoltaiczną i chcę dobrać do niej magazyn energii"
        : "Nie, ale chcę mieć fotowoltaikę wraz z magazynem energii",
      hasPv: value,
    });

    if (value === "yes") {
      goToStep(3);
      scrollToElement(formRef.current);
      return;
    }

    goToStep(4);
    scrollToElement(formRef.current);
  }

  function selectSettlementSystem(value: Exclude<SettlementSystem, null>) {
    setSettlementSystem(value);
  }

  function selectTariff(value: Exclude<Tariff, null>) {
    setTariff(value);
    setShowResult(false);
  }

  function togglePriority(value: string) {
    setPriorities((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  }

  function toggleResultDetail(key: string) {
    setExpandedResultDetails((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function editAnswers() {
    setShowResult(false);
    setIsAnalyzing(false);
    setAnalysisStep(0);
    setShowDetailedResult(false);
    setIsFullReportUnlocked(false);
    scrollToElement(formRef.current);
  }

  function restartCalculator() {
    setHasPv(null);
    setPvPower("");
    setSettlementSystem(null);
    setBillMode("monthly");
    setBillAmount("");
    setTariff(null);
    setShowResult(false);
    setIsAnalyzing(false);
    setAnalysisStep(0);
    setShowDetailedResult(false);
    setIsFullReportUnlocked(false);
    setStep(2);
    setPriorities([]);
    setContactFirstName("");
    setContactLastName("");
    setContactPostalCode("");
    setContactPhone("");
    setContactEmail("");
    setMarketingConsent(false);
    setLeadSubmitStatus("idle");
    hasTrackedResultViewRef.current = false;
    setHasStarted(false);
    scrollToElement(formRef.current);
  }

  function goBack() {
    if (step === 2) return;

    if (step === 4 && hasPv === "no") {
      goToStep(2);
      scrollToElement(formRef.current);
      return;
    }

    goToStep(step - 1);
    scrollToElement(formRef.current);
  }

  const billValue = parseDecimal(billAmount);
  const yearlyBill = billMode === "monthly" ? billValue * 12 : billValue;
  const currentPvPowerKw = parseDecimal(pvPower);
  const estimatedGridConsumptionKwh = estimateGridConsumptionFromBill({
    yearlyBill,
    fixedYearlyCost: ESTIMATED_FIXED_YEARLY_ENERGY_COST,
    tariff,
  });
  const estimatedPvProductionKwh = hasPv === "yes" && currentPvPowerKw > 0 ? currentPvPowerKw * PV_PRODUCTION_PER_KWP : 0;
  const preliminaryYearlyConsumptionKwh = estimatedGridConsumptionKwh + estimatedPvProductionKwh * NET_BILLING_BASE_AUTOCONSUMPTION_RATE;
  const baseAutoconsumptionRate =
    hasPv === "yes"
      ? getBaseAutoconsumptionRate({
          pvProductionKwh: estimatedPvProductionKwh,
          yearlyConsumptionKwh: preliminaryYearlyConsumptionKwh,
        })
      : NET_BILLING_BASE_AUTOCONSUMPTION_RATE;
  const estimatedSelfConsumedPvKwh =
    hasPv === "yes" ? estimatedPvProductionKwh * baseAutoconsumptionRate : 0;
  const estimatedExportedPvKwh =
    hasPv === "yes" ? Math.max(0, estimatedPvProductionKwh - estimatedSelfConsumedPvKwh) : 0;

  const netMeteringReturnRate = currentPvPowerKw > 10 ? 0.7 : 0.8;

  const estimatedReturnedFromNetMeteringKwh =
    hasPv === "yes" && settlementSystem === "net_metering"
      ? estimatedExportedPvKwh * netMeteringReturnRate
      : 0;

  const yearlyConsumptionKwh =
    hasPv === "yes"
      ? settlementSystem === "net_metering"
        ? estimatedGridConsumptionKwh +
          estimatedSelfConsumedPvKwh +
          estimatedReturnedFromNetMeteringKwh
        : estimatedGridConsumptionKwh + estimatedSelfConsumedPvKwh
      : estimatedGridConsumptionKwh;

    const result = useMemo(() => {
      if (!hasPv || yearlyBill <= 0) return null;

      const storageFromConsumption = getStorageFromConsumption(yearlyConsumptionKwh);
      const suggestedPvStorageSystem = getSuggestedPvStorageSystem(yearlyConsumptionKwh);
      const caresAboutSavings = priorities.includes("Niższe rachunki");
      const caresAboutBackup = priorities.includes("Awaryjne zasilanie domu w razie awarii");
      const storageFromPv =
        hasPv === "yes" && currentPvPowerKw > 0
          ? pickStorageVariant(currentPvPowerKw * 2)
          : 0;
      const storageFromTariff = caresAboutSavings
        ? getTariffStorageFromConsumption(estimatedGridConsumptionKwh, tariff)
        : 0;
      const storageFromBackup = caresAboutBackup
        ? getBackupStorageFromConsumption(yearlyConsumptionKwh)
        : 0;
      const recommendedStorageKwh =
        hasPv === "yes"
          ? Math.max(
              storageFromConsumption,
              storageFromPv,
              storageFromTariff,
              storageFromBackup
            )
          : suggestedPvStorageSystem.storageKwh;
      let suggestedPvKw = hasPv === "yes" ? getSuggestedPvKw(yearlyConsumptionKwh) : suggestedPvStorageSystem.pvKw;

      if (
        hasPv === "yes" &&
        settlementSystem === "net_metering" &&
        currentPvPowerKw > 0 &&
        currentPvPowerKw < 10 &&
        suggestedPvKw > 10
      ) {
        const productionAt10Kw = 10 * PV_PRODUCTION_PER_KWP;
        const usableAt10Kw = productionAt10Kw * 0.8;

        const productionAtSuggestedKw = suggestedPvKw * PV_PRODUCTION_PER_KWP;
        const usableAtSuggestedKw = productionAtSuggestedKw * 0.7;

        const gainAfterCrossingThreshold = usableAtSuggestedKw - usableAt10Kw;

        if (gainAfterCrossingThreshold < 1500) {
          suggestedPvKw = 10;
        } else if (yearlyConsumptionKwh > 14000) {
          suggestedPvKw = Math.max(suggestedPvKw, 12);
        }
      }

      const coveragePercent =
        hasPv === "yes" && yearlyConsumptionKwh > 0
          ? Math.round((estimatedPvProductionKwh / yearlyConsumptionKwh) * 100)
          : 100;
      const shouldRecommendPvExpansion = hasPv === "yes" && coveragePercent < 70;
      const pvExpansionStorageKwh = pickStorageVariant(suggestedPvKw * 2);
      const pvExpansionPriceRange = getPvStorageMarketingPriceRange(suggestedPvKw, pvExpansionStorageKwh);
      const tariffProfile = getTariffProfile(tariff);
      const purchasePricePerKwh = tariffProfile.highZonePricePerKwh;
      const tariffOptimizationBase = calculateTariffOptimization({
        tariff,
        storageKwh: recommendedStorageKwh,
        yearlyConsumptionKwh: estimatedGridConsumptionKwh,
      });
      const alternativeTariffOptimizationBase = getBestAlternativeTariffOptimization({
        currentTariff: tariff,
        storageKwh: recommendedStorageKwh,
        yearlyConsumptionKwh: estimatedGridConsumptionKwh,
      });
      const tariffLowAvailability = hasPv === "no"
        ? 0.25
        : settlementSystem === "net_metering"
          ? 1
          : 0.35;
      const tariffHighAvailability = hasPv === "no"
        ? 0.4
        : settlementSystem === "net_metering"
          ? 1
          : 0.55;
      const tariffSavingsLow = tariffOptimizationBase.yearlyBenefitLow * tariffLowAvailability;
      const tariffSavingsHigh = tariffOptimizationBase.yearlyBenefitHigh * tariffHighAvailability;
      const alternativeTariffSavingsLow =
        alternativeTariffOptimizationBase.yearlyBenefitLow * tariffLowAvailability;
      const alternativeTariffSavingsHigh =
        alternativeTariffOptimizationBase.yearlyBenefitHigh * tariffHighAvailability;

      const netBillingSavingsDetails =
        hasPv === "yes" && settlementSystem !== "net_metering" && estimatedPvProductionKwh > 0
          ? getNetBillingStorageSavingsRange({
              pvProductionKwh: estimatedPvProductionKwh,
              yearlyConsumptionKwh,
              storageKwh: recommendedStorageKwh,
              baseAutoconsumptionRate,
              purchasePricePerKwh,
            })
          : null;

      const netMeteringSavingsDetails =
        hasPv === "yes" && settlementSystem === "net_metering" && estimatedPvProductionKwh > 0
          ? getNetMeteringStorageSavingsRange({
              pvProductionKwh: estimatedPvProductionKwh,
              yearlyConsumptionKwh,
              storageKwh: recommendedStorageKwh,
              currentPvPowerKw,
              baseAutoconsumptionRate,
              purchasePricePerKwh,
            })
          : null;

      const pvStorageProductionKwh = suggestedPvKw * PV_PRODUCTION_PER_KWP;
      const newPvBaseAutoconsumptionRate = getBaseAutoconsumptionRate({
        pvProductionKwh: pvStorageProductionKwh,
        yearlyConsumptionKwh,
      });
      const newPvStorageFlow = getStorageEnergyFlow({
        pvProductionKwh: pvStorageProductionKwh,
        yearlyConsumptionKwh,
        storageKwh: recommendedStorageKwh,
        baseAutoconsumptionRate: newPvBaseAutoconsumptionRate,
      });
      const pvStorageAutoconsumptionRate = newPvStorageFlow.autoconsumptionRateWithStorage;
      const pvStorageSelfConsumedKwh = newPvStorageFlow.autoconsumedWithStorageKwh;
      const pvStorageExportedKwh = newPvStorageFlow.exportedAfterStorageKwh;
      const pvStorageGridPurchaseKwh = Math.max(0, yearlyConsumptionKwh - pvStorageSelfConsumedKwh);
      const pvStorageGridPurchaseCost =
        pvStorageGridPurchaseKwh * tariffProfile.averagePurchasePricePerKwh;
      const pvStorageExportValue = pvStorageExportedKwh * NET_BILLING_EXPORT_PRICE_PER_KWH;
      const pvStorageEstimatedBillAfterSystem = Math.max(
        ESTIMATED_FIXED_YEARLY_ENERGY_COST,
        ESTIMATED_FIXED_YEARLY_ENERGY_COST + pvStorageGridPurchaseCost - pvStorageExportValue
      );
      const pvStorageExpectedSavings = clamp(
        yearlyBill - pvStorageEstimatedBillAfterSystem,
        0,
        Math.max(0, yearlyBill - ESTIMATED_FIXED_YEARLY_ENERGY_COST)
      );

      const energySourceSavingsLow = hasPv === "no"
        ? clamp(pvStorageExpectedSavings * 0.9, 0, yearlyBill * 0.95)
        : netBillingSavingsDetails
          ? netBillingSavingsDetails.low
          : netMeteringSavingsDetails
            ? netMeteringSavingsDetails.low
            : 0;
      const energySourceSavingsHigh = hasPv === "no"
        ? clamp(pvStorageExpectedSavings * 1.1, 0, yearlyBill * 0.98)
        : netBillingSavingsDetails
          ? netBillingSavingsDetails.high
          : netMeteringSavingsDetails
            ? netMeteringSavingsDetails.high
            : 0;
      const maximumVariableYearlyCost = Math.max(
        0,
        yearlyBill - ESTIMATED_FIXED_YEARLY_ENERGY_COST
      );
      const yearlySavingsLow = clamp(
        energySourceSavingsLow + tariffSavingsLow,
        0,
        maximumVariableYearlyCost
      );
      const yearlySavingsHigh = clamp(
        energySourceSavingsHigh + tariffSavingsHigh,
        0,
        maximumVariableYearlyCost
      );
      const alternativeYearlySavingsLow = clamp(
        energySourceSavingsLow + alternativeTariffSavingsLow,
        0,
        maximumVariableYearlyCost
      );
      const alternativeYearlySavingsHigh = clamp(
        energySourceSavingsHigh + alternativeTariffSavingsHigh,
        0,
        maximumVariableYearlyCost
      );

      const storageAlternatives = getStorageAlternatives(recommendedStorageKwh);
      const lowerTariffOptimization = storageAlternatives.lower
        ? calculateTariffOptimization({
            tariff,
            storageKwh: storageAlternatives.lower,
            yearlyConsumptionKwh: estimatedGridConsumptionKwh,
          })
        : null;
      const higherTariffOptimization = storageAlternatives.higher
        ? calculateTariffOptimization({
            tariff,
            storageKwh: storageAlternatives.higher,
            yearlyConsumptionKwh: estimatedGridConsumptionKwh,
          })
        : null;

      const baseCalculatorPriceWithoutSellerMarkup =
        hasPv === "yes"
          ? getOnlyStorageBasePriceWithoutSellerMarkup(recommendedStorageKwh)
          : getPvStorageBasePriceWithoutSellerMarkup(suggestedPvKw, recommendedStorageKwh);

      const [priceLow, priceHigh] =
        hasPv === "yes"
          ? getMarketingPriceRange(baseCalculatorPriceWithoutSellerMarkup)
          : getPvStorageMarketingPriceRange(suggestedPvKw, recommendedStorageKwh);

      const subsidy = calculateMaximumPmeSubsidy({
        billingSystem: settlementSystem,
        storageCapacityKwh: recommendedStorageKwh,
      });
      const subsidyEstimate = subsidy.total;

      const investmentLowAfterSubsidy = Math.max(0, priceLow - subsidyEstimate);
      const investmentHighAfterSubsidy = Math.max(0, priceHigh - subsidyEstimate);
      const paybackYearsLow = calculatePaybackYears(investmentLowAfterSubsidy, yearlySavingsHigh);
      const paybackYearsHigh = calculatePaybackYears(investmentHighAfterSubsidy, yearlySavingsLow);
      const paybackYearsWithoutSubsidyLow = calculatePaybackYears(priceLow, yearlySavingsHigh);
      const paybackYearsWithoutSubsidyHigh = calculatePaybackYears(priceHigh, yearlySavingsLow);
      const alternativePaybackYearsLow = calculatePaybackYears(
        investmentLowAfterSubsidy,
        alternativeYearlySavingsHigh
      );
      const alternativePaybackYearsHigh = calculatePaybackYears(
        investmentHighAfterSubsidy,
        alternativeYearlySavingsLow
      );

      const chartYearlyBillAfterInvestment = Math.max(0, yearlyBill - yearlySavingsLow);
      const chartCostReductionPercent =
        yearlyBill > 0
          ? Math.round((1 - chartYearlyBillAfterInvestment / yearlyBill) * 100)
          : 0;

      const baseRecommendation = getRecommendation({
        paybackYearsLow,
        paybackYearsHigh,
        alternativePaybackYearsLow,
        alternativePaybackYearsHigh,
        yearlyBill,
        shouldRecommendPvExpansion,
        priorities,
      });

      const recommendation = hasPv === "no"
        ? {
            ...baseRecommendation,
            title:
              baseRecommendation.type === "recommended"
                ? "Fotowoltaika z magazynem energii wygląda na dobrą inwestycję"
                : baseRecommendation.type === "consider"
                  ? "Wymagana indywidualna analiza fotowoltaiki i magazynu"
                  : "Fotowoltaika z magazynem energii ma ograniczoną opłacalność",
            description:
              baseRecommendation.type === "recommended"
                ? "Szacowany okres zwrotu jest korzystny, a połączenie fotowoltaiki z magazynem energii może znacząco ograniczyć zakup energii z sieci."
                : baseRecommendation.type === "consider"
                  ? "Rachunki można prawdopodobnie ograniczyć, ale wynik zależy od właściwego podziału korzyści między fotowoltaikę, magazyn i pracę w strefach taryfowych."
                  : "Przy obecnych założeniach taki zestaw może zwracać się stosunkowo długo. Warto porozmawiać z doradcą o doborze mocy PV, taryfie i możliwych dotacjach.",
          }
        : baseRecommendation;

      return {
        recommendedStorageKwh,
        storageFromConsumption,
        storageFromPv,
        storageFromTariff,
        storageFromBackup,
        storageAlternatives,
        lowerTariffOptimization,
        higherTariffOptimization,
        currentPvPowerKw,
        gridPurchaseYearlyKwh: estimatedGridConsumptionKwh,
        gridPurchaseDailyKwh: estimatedGridConsumptionKwh / 365,
        suggestedPvKw,
        estimatedPvProductionKwh,
        coveragePercent,
        shouldRecommendPvExpansion,
        pvExpansionStorageKwh,
        pvExpansionPriceRange,
        pvStorageProductionKwh,
        pvStorageAutoconsumptionRate,
        pvStorageSelfConsumedKwh,
        pvStorageExportedKwh,
        pvStorageGridPurchaseKwh,
        pvStorageEstimatedBillAfterSystem,
        currentYearlyBill: yearlyBill,
        chartYearlyBillAfterInvestment,
        chartCostReductionPercent,
        netBillingSavingsDetails,
        netMeteringSavingsDetails,
        energySourceSavingsLow,
        energySourceSavingsHigh,
        tariffOptimization: {
          ...tariffOptimizationBase,
          yearlyBenefitLow: tariffSavingsLow,
          yearlyBenefitHigh: tariffSavingsHigh,
          availabilityLow: tariffLowAvailability,
          availabilityHigh: tariffHighAvailability,
        },
        alternativeTariffOptimization: {
          ...alternativeTariffOptimizationBase,
          yearlyBenefitLow: alternativeTariffSavingsLow,
          yearlyBenefitHigh: alternativeTariffSavingsHigh,
        },
        alternativeYearlySavingsLow,
        alternativeYearlySavingsHigh,
        yearlySavingsLow,
        yearlySavingsHigh,
        purchasePricePerKwh,
        priceLow,
        priceHigh,
        subsidyEstimate,
        subsidyStorage: subsidy.storageSubsidy,
        subsidyEuBonus: subsidy.euBonus,
        subsidyStorageLimit: subsidy.maxStorageSubsidy,
        paybackYearsLow,
        paybackYearsHigh,
        paybackYearsWithoutSubsidyLow,
        paybackYearsWithoutSubsidyHigh,
        alternativePaybackYearsLow,
        alternativePaybackYearsHigh,
        recommendation,
      };
    }, [hasPv, currentPvPowerKw, estimatedGridConsumptionKwh, estimatedPvProductionKwh, settlementSystem, tariff, yearlyBill, yearlyConsumptionKwh, baseAutoconsumptionRate, priorities]);

  useEffect(() => {
    if (!showResult || !result || hasTrackedResultViewRef.current) {
      return;
    }

    if (typeof window !== "undefined" && window.fbq) {
      window.fbq("track", "ViewContent", {
        content_name: "energy_storage_calculator_result",
        content_category: "calculator_result",
        recommendation_type: result.recommendation.type,
        recommended_storage_kwh: result.recommendedStorageKwh,
        has_pv: hasPv,
      });
    }
    hasTrackedResultViewRef.current = true;
    trackCalculatorEvent("recommendation_shown", {
      stepNumber: 7,
      stepKey: "rekomendacja_i_formularz",
      recommendationType: result.recommendation.type,
      recommendedStorageKwh: result.recommendedStorageKwh,
      hasPv: hasPv || undefined,
    });
  }, [showResult, result, hasPv, trackCalculatorEvent]);

  const hasValidPvDetails = hasPv !== "yes" || parseDecimal(pvPower) > 0;
const canCalculate = Boolean(
  hasPv &&
    yearlyBill > 0 &&
    hasValidPvDetails &&
    tariff &&
    (hasPv === "no" || settlementSystem) &&
    priorities.length > 0
);

const normalizedContactPhone = normalizePolishMobilePhone(contactPhone);
const contactPhoneHasError = contactPhone.length > 0 && !normalizedContactPhone;

const canSubmitLead = Boolean(
  contactFirstName.trim() &&
    contactPostalCode.length === 6 &&
    normalizedContactPhone &&
    marketingConsent &&
    turnstileToken &&
    result &&
    leadSubmitStatus !== "success"
);

  function handleCalculate() {
    if (!canCalculate) return;
    trackCalculatorEvent("step_view", {
      stepNumber: hasPv === "yes" ? 5 : 4,
      stepKey: "odpowiedz_priorytety",
      question: "Co jest dla Ciebie najważniejsze?",
      answer: priorities.join("; "),
      hasPv: hasPv || undefined,
    });
    trackCalculatorEvent("analysis_started", {
      stepNumber: 6,
      stepKey: "analiza",
      hasPv: hasPv || undefined,
    });
    setIsAnalyzing(true);
    setShowResult(false);
    setAnalysisStep(0);
    setExpandedResultDetails({});
    setShowDetailedResult(false);
    setIsFullReportUnlocked(false);
    setLeadSubmitStatus("idle");
    hasTrackedResultViewRef.current = false;

    scrollToElement(formRef.current);

    analysisSteps.forEach((_, index) => {
      window.setTimeout(() => {
        setAnalysisStep(index + 1);
      }, 650 + index * 850);
    });

    window.setTimeout(() => {
      setIsAnalyzing(false);
      setShowResult(true);
      scrollToElement(formRef.current);
    }, 4800);
  }

  async function submitLead() {
    if (!canSubmitLead || !result || !normalizedContactPhone) return;

    const metaEventId = createMetaLeadEventId();

    setIsSubmittingLead(true);
    setLeadSubmitStatus("idle");
    trackCalculatorEvent("lead_submit_attempt", {
      stepNumber: 8,
      stepKey: "wysylka_formularza",
      recommendationType: result.recommendation.type,
      recommendedStorageKwh: result.recommendedStorageKwh,
      hasPv: hasPv || undefined,
    });

    let errorCode = "network_error";
    let errorMessage = "Brak odpowiedzi serwera.";
    let errorStatus: number | undefined;

    try {
      const response = await fetch("/api/public/energy-storage-lead", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "kalkulatorME",
          contact: {
            firstName: contactFirstName.trim(),
            lastName: contactLastName.trim() || null,
            postalCode: contactPostalCode,
            phone: normalizedContactPhone,
            email: contactEmail.trim() || null,
            turnstileToken,
          },
          answers: {
            hasPv,
            pvPower: pvPower || null,
            settlementSystem,
            billMode,
            billAmount,
            yearlyBill,
            yearlyConsumptionKwh,
            estimatedGridConsumptionKwh,
            estimatedPvProductionKwh,
            estimatedSelfConsumedPvKwh,
            estimatedExportedPvKwh,
            estimatedReturnedFromNetMeteringKwh,
            baseAutoconsumptionRate,
            tariff,
            priorities,
          },
          result: {
            recommendationType: result.recommendation.type,
            recommendationTitle: result.recommendation.title,
            recommendedStorageKwh: result.recommendedStorageKwh,
            gridPurchaseYearlyKwh: result.gridPurchaseYearlyKwh,
            gridPurchaseDailyKwh: result.gridPurchaseDailyKwh,
            suggestedPvKw: result.suggestedPvKw,
            coveragePercent: result.coveragePercent,
            shouldRecommendPvExpansion: result.shouldRecommendPvExpansion,
            pvExpansionStorageKwh: result.pvExpansionStorageKwh,
            pvExpansionPriceLow: result.pvExpansionPriceRange[0],
            pvExpansionPriceHigh: result.pvExpansionPriceRange[1],
            yearlySavingsLow: result.yearlySavingsLow,
            yearlySavingsHigh: result.yearlySavingsHigh,
            energySourceSavingsLow: result.energySourceSavingsLow,
            energySourceSavingsHigh: result.energySourceSavingsHigh,
            tariffOptimization: result.tariffOptimization,
            alternativeTariffOptimization: result.alternativeTariffOptimization,
            alternativeYearlySavingsLow: result.alternativeYearlySavingsLow,
            alternativeYearlySavingsHigh: result.alternativeYearlySavingsHigh,
            storageFromConsumption: result.storageFromConsumption,
            storageFromPv: result.storageFromPv,
            storageFromTariff: result.storageFromTariff,
            storageFromBackup: result.storageFromBackup,
            storageAlternatives: result.storageAlternatives,
            lowerTariffOptimization: result.lowerTariffOptimization,
            higherTariffOptimization: result.higherTariffOptimization,
            netBillingSavingsDetails: result.netBillingSavingsDetails,
            netMeteringSavingsDetails: result.netMeteringSavingsDetails,
            pvStorageProductionKwh: result.pvStorageProductionKwh,
            pvStorageAutoconsumptionRate: result.pvStorageAutoconsumptionRate,
            pvStorageSelfConsumedKwh: result.pvStorageSelfConsumedKwh,
            pvStorageExportedKwh: result.pvStorageExportedKwh,
            pvStorageGridPurchaseKwh: result.pvStorageGridPurchaseKwh,
            pvStorageEstimatedBillAfterSystem: result.pvStorageEstimatedBillAfterSystem,
            currentYearlyBill: result.currentYearlyBill,
            chartYearlyBillAfterInvestment: result.chartYearlyBillAfterInvestment,
            chartCostReductionPercent: result.chartCostReductionPercent,
            purchasePricePerKwh: result.purchasePricePerKwh,
            priceLow: result.priceLow,
            priceHigh: result.priceHigh,
            subsidyEstimate: result.subsidyEstimate,
            subsidyStorage: result.subsidyStorage,
            subsidyEuBonus: result.subsidyEuBonus,
            paybackYearsLow: result.paybackYearsLow,
            paybackYearsHigh: result.paybackYearsHigh,
            paybackYearsWithoutSubsidyLow: result.paybackYearsWithoutSubsidyLow,
            paybackYearsWithoutSubsidyHigh: result.paybackYearsWithoutSubsidyHigh,
            alternativePaybackYearsLow: result.alternativePaybackYearsLow,
            alternativePaybackYearsHigh: result.alternativePaybackYearsHigh,
          },
          meta: {
            eventId: metaEventId,
            eventSourceUrl: window.location.href,
            fbp: getBrowserCookie("_fbp"),
            fbc: getBrowserCookie("_fbc"),
          },
        }),
      });

      const responseData = await response.json().catch(() => ({})) as {
        ok?: boolean;
        clientId?: string;
        duplicate?: boolean;
        error?: string;
        skipped?: boolean;
      };

      errorStatus = response.status;

      if (!response.ok || responseData.ok !== true || !responseData.clientId) {
        if (responseData.skipped) {
          errorCode = "antispam_rejected";
          errorMessage = "Zgłoszenie zostało odrzucone przez ochronę antyspamową.";
        } else if (!response.ok) {
          errorCode = `http_${response.status}`;
          errorMessage = responseData.error || "Serwer nie przyjął zgłoszenia.";
        } else {
          errorCode = "missing_client_id";
          errorMessage = "CRM nie potwierdził utworzenia klienta.";
        }
        throw new Error(errorMessage);
      }

      if (!responseData.duplicate && typeof window !== "undefined" && window.fbq) {
        window.fbq("track", "Lead", {
          content_name: "energy_storage_calculator_lead",
          content_category: "lead_form",
          recommendation_type: result.recommendation.type,
          recommended_storage_kwh: result.recommendedStorageKwh,
          has_pv: hasPv,
        }, {
          eventID: metaEventId,
        });
      }

      setLeadSubmitStatus("success");
      setIsFullReportUnlocked(true);
      setShowDetailedResult(true);
      trackCalculatorEvent("lead_submit_success", {
        stepNumber: 9,
        stepKey: "lead_w_crm",
        recommendationType: result.recommendation.type,
        recommendedStorageKwh: result.recommendedStorageKwh,
        leadClientId: responseData.clientId,
        hasPv: hasPv || undefined,
      });
      trackCalculatorEvent("report_unlocked", {
        stepNumber: 10,
        stepKey: "pelny_raport",
        recommendationType: result.recommendation.type,
        recommendedStorageKwh: result.recommendedStorageKwh,
        leadClientId: responseData.clientId,
        hasPv: hasPv || undefined,
      });
      window.setTimeout(() => {
        scrollToElement(detailedReportRef.current);
      }, 120);
    } catch (error) {
      console.error(error);
      if (error instanceof TypeError) {
        errorCode = "network_error";
        errorMessage = "Nie udało się połączyć z serwerem.";
      }
      setLeadSubmitStatus("error");
      trackCalculatorEvent("lead_submit_failed", {
        stepNumber: 8,
        stepKey: "blad_wysylki_formularza",
        recommendationType: result.recommendation.type,
        recommendedStorageKwh: result.recommendedStorageKwh,
        hasPv: hasPv || undefined,
        errorCode,
        errorMessage,
        errorStatus,
      });
    } finally {
      setIsSubmittingLead(false);
    }
  }

  const currentFormStep = step === 2 ? 1 : hasPv === "no" ? step - 2 : step - 1;
  const totalFormSteps = hasPv === "yes" ? 5 : 4;

  useEffect(() => {
    if (!hasStarted || isAnalyzing || showResult) return;

    const stepKey = `krok_${currentFormStep}_${hasPv || "nie_wybrano"}`;
    if (trackedStepViewsRef.current.has(stepKey)) return;
    trackedStepViewsRef.current.add(stepKey);
    trackCalculatorEvent("step_view", {
      stepNumber: Math.min(5, Math.max(1, currentFormStep)),
      stepKey,
      hasPv: hasPv || undefined,
    });
  }, [currentFormStep, hasPv, hasStarted, isAnalyzing, showResult, trackCalculatorEvent]);

  return (
    <main className={pageClass}>
      <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-9">
        <header className="flex items-center justify-between gap-4 py-1">
          <Link href="/" className="flex items-center gap-3" aria-label="IdeaSol — kalkulator magazynu energii">
            <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${isDarkMode ? "bg-white/10" : "bg-[#10261f]"}`}>
              <Image src="/logo.png" alt="" width={34} height={34} className="h-8 w-8 object-contain" priority />
            </span>
            <span>
              <span className="block text-lg font-black tracking-[-0.03em]">IdeaSol</span>
              <span className={`block text-[10px] font-bold uppercase tracking-[0.18em] ${mutedTextClass}`}>Kalkulator energii</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/blog" className={`hidden text-sm font-bold transition hover:opacity-70 sm:block ${mutedTextClass}`}>Baza wiedzy</Link>
            <div className={`inline-flex rounded-full border p-1 ${isDarkMode ? "border-white/10 bg-white/5" : "border-[#13231d]/10 bg-white/60"}`}>
              <button type="button" aria-label="Motyw automatyczny" onClick={() => changeThemeMode("auto")} className={themeButtonClass("auto")}>Auto</button>
              <button type="button" aria-label="Jasny motyw" onClick={() => changeThemeMode("light")} className={themeButtonClass("light")}>Jasny</button>
              <button type="button" aria-label="Ciemny motyw" onClick={() => changeThemeMode("dark")} className={themeButtonClass("dark")}>Ciemny</button>
            </div>
          </div>
        </header>
        <section className={heroClass}>
          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            <div className="relative z-10 flex flex-col justify-center p-7 sm:p-10 lg:p-14">
              <p className="inline-flex w-fit rounded-full border border-white/12 bg-white/8 px-4 py-2 text-xs font-black uppercase tracking-[0.15em] text-[#9ee5d9]">
                Bezpłatna analiza • około 60 sekund
              </p>
              <h1 className="mt-6 max-w-2xl text-4xl font-black leading-[0.98] tracking-[-0.05em] text-white sm:text-5xl lg:text-6xl">
                Czy magazyn energii ma sens w Twoim domu?
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-white/68 sm:text-lg">
                Odpowiedz na kilka prostych pytań. Najpierw pokażemy jasną kwalifikację: <strong className="text-white">rekomendowany, wymaga indywidualnej analizy albo nieopłacalny</strong>. Po formularzu otrzymasz pełny raport i kontakt specjalisty.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="#analiza"
                  onClick={(event) => { event.preventDefault(); startAnalysis(); }}
                  className="inline-flex items-center justify-center rounded-full bg-[#c7f36b] px-6 py-4 text-sm font-black text-[#10261f] shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-[#b9ed54]"
                >
                  Sprawdź rekomendację <span className="ml-2 text-lg">→</span>
                </a>
                <span className="text-xs font-semibold text-white/48">Bez zobowiązań i bez kosztów</span>
              </div>
              <div className="mt-8 grid grid-cols-3 gap-3 border-t border-white/10 pt-6">
                {[['01', 'Rachunek'], ['02', 'Instalacja'], ['03', 'Jasna rekomendacja']].map(([number, label]) => (
                  <div key={number}><p className="text-xs font-black text-[#c7f36b]">{number}</p><p className="mt-1 text-xs font-bold text-white/60 sm:text-sm">{label}</p></div>
                ))}
              </div>
            </div>
            <div className="relative min-h-[320px] overflow-hidden sm:min-h-[440px] lg:min-h-[610px]">
              <Image src="/blog/home-storage-evening.png" alt="Dom z fotowoltaiką i magazynem energii" fill priority sizes="(min-width: 1024px) 56vw, 100vw" className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#10261f]/55 via-transparent to-transparent lg:bg-gradient-to-r lg:from-[#10261f]/35 lg:to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 grid grid-cols-2 gap-3 sm:bottom-7 sm:left-7 sm:right-7">
                <div className="rounded-2xl border border-white/18 bg-[#10261f]/72 p-4 text-white backdrop-blur-md">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#9ee5d9]">Jasna odpowiedź</p><p className="mt-1 text-lg font-black">Czy magazyn ma sens?</p>
                </div>
                <div className="rounded-2xl border border-white/18 bg-[#f4f5ef]/90 p-4 text-[#10261f] backdrop-blur-md">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#397f72]">Pełna analiza</p><p className="mt-1 text-lg font-black">Szczegóły i rozmowa z ekspertem</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {hasStarted && (
        <section className="grid gap-6">
          <div id="analiza" ref={formRef} className={panelClass}>
            {!isAnalyzing && !showResult && (
              <div className={`mb-8 border-b pb-6 ${isDarkMode ? "border-white/10" : "border-[#13231d]/10"}`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className={`text-xs font-black uppercase tracking-[0.18em] ${eyebrowTextClass}`}>Analiza Twojego domu</p>
                    <p className={`mt-2 text-sm ${mutedTextClass}`}>Odpowiadaj zgodnie z rachunkiem — resztę policzymy za Ciebie.</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${isDarkMode ? "bg-white/10 text-white/70" : "bg-[#dff3d5] text-[#397f72]"}`}>
                    Krok {currentFormStep} z {totalFormSteps}
                  </span>
                </div>
                <div className={`mt-5 h-1.5 overflow-hidden rounded-full ${isDarkMode ? "bg-white/10" : "bg-[#13231d]/8"}`}>
                  <div
                    className="h-full rounded-full bg-[#c7f36b] transition-all duration-500"
                    style={{ width: `${Math.min(100, (currentFormStep / totalFormSteps) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {isAnalyzing ? (
              <div
                className={`flex min-h-[520px] flex-col justify-center rounded-[28px] p-6 sm:p-8 ${
                  isDarkMode
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-950 shadow-xl shadow-slate-950/10"
                }`}
              >
                <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${isDarkMode ? "text-cyan-200" : "text-cyan-600"}`}>
                  Analiza
                </p>
                <h2 className="mt-4 text-3xl font-bold">Liczymy potencjał Twojego domu</h2>
                <div className="mt-8 space-y-3">
                  {analysisSteps.map((item, index) => {
                    const isDone = analysisStep > index;
                    const isCurrent = analysisStep === index;

                    return (
                      <div
                        key={item}
                        className={`flex items-center gap-3 rounded-[20px] border p-4 transition ${
                          isDone
                            ? isDarkMode
                              ? "border-cyan-300/30 bg-cyan-300/15"
                              : "border-cyan-200 bg-cyan-50"
                            : isCurrent
                              ? isDarkMode
                                ? "border-white/20 bg-white/10"
                                : "border-slate-300 bg-slate-100"
                              : isDarkMode
                                ? "border-white/10 bg-white/5"
                                : "border-slate-200 bg-white"
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                            isDone
                              ? "bg-cyan-300 text-slate-950"
                              : isDarkMode
                                ? "bg-white/10 text-white/60"
                                : "bg-slate-200 text-slate-500"
                          }`}
                        >
                          {isDone ? "✓" : index + 1}
                        </span>
                        <span
                          className={
                            isDone
                              ? isDarkMode
                                ? "font-bold text-white"
                                : "font-bold text-slate-950"
                              : isDarkMode
                                ? "text-white/70"
                                : "text-slate-600"
                          }
                        >
                          {item}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : showResult && result ? (
              <div className={resultPanelClass}>
                <div>
                  <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${eyebrowTextClass}`}>
                    Wstępna kwalifikacja
                  </p>
                  <h2 className="mt-4 text-3xl font-bold">
                    Czy rekomendujemy magazyn energii?
                  </h2>
                </div>

                <div className={`rounded-[24px] border p-5 ${getRecommendationBoxClass(result.recommendation.type)}`}>
                  <p className={`text-sm font-semibold uppercase tracking-[0.18em] ${
                    result.recommendation.type === "recommended"
                      ? (isDarkMode ? "text-emerald-200" : "text-emerald-700")
                      : result.recommendation.type === "consider"
                        ? (isDarkMode ? "text-amber-200" : "text-amber-700")
                        : (isDarkMode ? "text-rose-200" : "text-rose-700")
                  }`}>
                    {getRecommendationBadge(result.recommendation.type)}
                  </p>
                  <h3 className="mt-3 text-2xl font-bold">
                    {result.recommendation.type === "recommended"
                      ? "TAK — rekomendujemy magazyn energii dla Twojego domu"
                      : result.recommendation.type === "consider"
                        ? "MOŻLIWE — wynik wymaga indywidualnej analizy"
                        : "NIE — przy podanych danych nie rekomendujemy magazynu energii"}
                  </h3>
                  <p className={`mt-3 text-sm leading-6 ${mutedTextClass}`}>
                    {isFullReportUnlocked
                      ? result.recommendation.description
                      : "Ta decyzja dotyczy bezpośrednio zakupu magazynu energii. Pełny dobór pojemności, widełki oszczędności i ceny, okres zwrotu oraz kontakt specjalisty odblokujemy po przesłaniu formularza."}
                  </p>
                  {isFullReportUnlocked && result.recommendation.type === "not_recommended" && (
                    <div className={`mt-4 rounded-[18px] border p-4 text-sm leading-6 ${isDarkMode ? "border-white/10 bg-white/5 text-[#D8CEC7]" : "border-slate-200 bg-white/70 text-slate-600"}`}>
                      Nie oznacza to, że w Twoim domu nie da się poprawić kosztów energii. Może się okazać, że większy sens ma zmiana taryfy, korekta sposobu zużycia energii, optymalizacja pracy obecnej instalacji albo inne rozwiązanie. Warto omówić wynik z doradcą i sprawdzić, czy istnieje prostsza droga do obniżenia rachunków.
                    </div>
                  )}
                </div>

                {isFullReportUnlocked ? (
                <div>
  <button
    type="button"
    onClick={() => {
      setShowDetailedResult((current) => {
        const next = !current;

        if (next) {
          window.setTimeout(() => {
            scrollToElement(detailedReportRef.current);
          }, 80);
        }

        return next;
      });
    }}
    className="w-full rounded-2xl bg-[#c7f36b] px-5 py-4 text-left text-[#10261f] shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-[#b9ed54]"
  >
    <span className="flex items-center justify-between gap-4">
      <span
        aria-hidden="true"
        className="w-10 text-center text-3xl font-black leading-none"
      >
        {showDetailedResult ? "◀" : "▼"}
      </span>

      <span className="flex-1 text-center">
        <span className="block text-xl font-extrabold sm:text-2xl">
          {showDetailedResult ? "Ukryj dokładny raport" : "Dokładny raport"}
        </span>
        <span className="mt-2 block text-sm font-semibold text-slate-800/75 sm:text-base">
          {showDetailedResult
            ? "Schowaj szczegółowe liczby i założenia"
            : "Pokaż szczegółowe liczby i założenia"}
        </span>
      </span>

      <span
        aria-hidden="true"
        className="w-10 text-center text-3xl font-black leading-none"
      >
        {showDetailedResult ? "▶" : "▼"}
      </span>
    </span>
  </button>

  {showDetailedResult && (
    <div ref={detailedReportRef} className="space-y-0">
                  <div className={resultCardClass}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>
                          Roczne koszty energii
                        </p>
                        <p className={`mt-1 text-xs ${mutedTextClass}`}>
                          Porównanie obecnego kosztu energii z szacowanym kosztem po inwestycji.
                        </p>
                      </div>

                      <div className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-extrabold ${isDarkMode ? "bg-lime-300 text-slate-950" : "bg-lime-200 text-slate-950"}`}>
                        ↓ {result.chartCostReductionPercent}% kosztów
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className={`relative ml-16 h-[220px] border-b border-l ${isDarkMode ? "border-white/10" : "border-slate-200"}`}>
                        {[1, 0.75, 0.5, 0.25, 0].map((scaleValue) => (
                          <div
                            key={scaleValue}
                            className={`absolute left-0 right-0 border-t ${isDarkMode ? "border-white/10" : "border-slate-200"}`}
                            style={{ bottom: `${scaleValue * 100}%` }}
                          >
                            <span className={`absolute -left-16 -translate-y-1/2 text-[10px] ${mutedTextClass}`}>
                              {formatMoney(result.currentYearlyBill * scaleValue)}
                            </span>
                          </div> 
                        ))}

                        <div className="absolute inset-x-0 bottom-0 flex h-full items-end justify-center gap-10 sm:gap-16">
                          <div className="flex h-full flex-col items-center justify-end gap-2">
                            <div
                              className="w-20 rounded-t-xl shadow-lg sm:w-24"
                              style={{
                                height: "100%",
                                backgroundColor: "#C80E0E",
                              }}
                            />
                          </div>

                          <div className="flex h-full flex-col items-center justify-end gap-2">
                            <div
                              className="w-20 rounded-t-xl shadow-lg sm:w-24"
                              style={{
                                height: `${Math.max(
                                  0,
                                  Math.min(
                                    100,
                                    result.currentYearlyBill > 0
                                      ? (result.chartYearlyBillAfterInvestment / result.currentYearlyBill) * 100
                                      : 0
                                  )
                                )}%`,
                                backgroundColor: "#BEFF67",
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="ml-16 mt-3 flex justify-center gap-10 text-center sm:gap-16">
                        <div className="w-20 sm:w-24">
                          <div className={isDarkMode ? "text-sm font-extrabold text-white" : "text-sm font-extrabold text-slate-950"}>Obecnie</div>
                          <div className={`mt-1 text-xs font-bold ${mutedTextClass}`}>{formatMoney(result.currentYearlyBill)}</div>
                        </div>
                        <div className="w-20 sm:w-24">
                          <div className={isDarkMode ? "text-sm font-extrabold text-white" : "text-sm font-extrabold text-slate-950"}>Po inwestycji</div>
                          <div className={`mt-1 text-xs font-bold ${mutedTextClass}`}>{formatMoney(result.chartYearlyBillAfterInvestment)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className={resultCardClass}>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>
                      {hasPv === "yes" ? "Szacowane całkowite zużycie energii" : "Szacowane roczne zużycie"}
                    </p>
                    <p className={isDarkMode ? "mt-1 text-2xl font-bold text-white" : "mt-1 text-2xl font-bold text-slate-950"}>{Math.round(yearlyConsumptionKwh).toLocaleString("pl-PL")} kWh</p>
                    {hasPv === "yes" && result.estimatedPvProductionKwh > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleResultDetail("usage")}
                          className={`mt-2 text-xs font-bold underline-offset-4 hover:underline ${isDarkMode ? "text-cyan-200" : "text-cyan-800"}`}
                        >
                          {expandedResultDetails.usage ? "Ukryj szczegóły" : "Rozwiń szczegóły"}
                        </button>
                        {expandedResultDetails.usage && (
                          <div className={`mt-3 px-4 py-3 ${isDarkMode ? "bg-white/5" : "bg-slate-100/80"}`}>
                            <p className={`text-xs leading-5 ${mutedTextClass}`}>
                              W tym około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(estimatedGridConsumptionKwh).toLocaleString("pl-PL")} kWh</strong> kupione z sieci oraz około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(estimatedSelfConsumedPvKwh).toLocaleString("pl-PL")} kWh</strong> zużyte bezpośrednio z obecnej instalacji fotowoltaicznej. Około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(estimatedExportedPvKwh).toLocaleString("pl-PL")} kWh</strong> traktujemy jako nadwyżkę oddaną do sieci.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {result.shouldRecommendPvExpansion && (
                    <div className={`border p-5 ${isDarkMode ? "border-amber-300/25 bg-amber-300/10" : "border-amber-200 bg-amber-50"}`}>
                      <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-amber-200" : "text-amber-800"}`}>
                        Pierwszy rekomendowany krok
                      </p>
                      <p className={`mt-2 text-lg font-bold ${isDarkMode ? "text-white" : "text-slate-950"}`}>
                        Sprawdź możliwość rozbudowy fotowoltaiki
                      </p>
                      <p className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>
                        Obecna instalacja pokrywa szacunkowo około {result.coveragePercent}% rocznego zapotrzebowania. Jeżeli dach i warunki przyłączenia pozwalają, dodatkowe panele zwykle dadzą większy efekt niż samo zwiększanie pojemności baterii. Gdy rozbudowa nie jest możliwa, poniższy magazyn pozostaje wariantem dobranym do taryfy i backupu.
                      </p>
                    </div>
                  )}
                  {hasPv === "yes" && (
                    <div className={resultCardClass}>
                      <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>Twoja obecna instalacja fotowoltaiczna</p>
                      <p className={isDarkMode ? "mt-1 text-2xl font-bold text-cyan-300" : "mt-1 text-2xl font-bold text-cyan-700"}>
                        {pvPower ? `${pvPower} kWp` : "moc niepodana"}
                      </p>
                      <div className="mt-2">
                        <span className={`inline-flex px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${isDarkMode ? "bg-cyan-300/10 text-cyan-300" : "bg-cyan-100 text-cyan-700"}`}>
                          {settlementSystem === "net_billing" ? "Net-billing" : settlementSystem === "net_metering" ? "Net-metering" : "System nieznany"}
                        </span>
                      </div>
                      <p className={`mt-2 text-sm ${mutedTextClass}`}>
                        Szacowana produkcja z fotowoltaiki: {Math.round(result.estimatedPvProductionKwh).toLocaleString("pl-PL")} kWh/rok
                      </p>
                      <p className={`mt-1 text-sm ${mutedTextClass}`}>
                        Szacowana autokonsumpcja bez magazynu: {Math.round(baseAutoconsumptionRate * 100)}% ({Math.round(estimatedSelfConsumedPvKwh).toLocaleString("pl-PL")} kWh/rok)
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleResultDetail("currentPv")}
                        className={`mt-2 text-xs font-bold underline-offset-4 hover:underline ${isDarkMode ? "text-cyan-200" : "text-cyan-800"}`}
                      >
                        {expandedResultDetails.currentPv ? "Ukryj szczegóły" : "Rozwiń szczegóły"}
                      </button>
                      {expandedResultDetails.currentPv && (
                        <div className={`mt-3 space-y-2 px-4 py-3 text-xs leading-5 ${mutedTextClass} ${isDarkMode ? "bg-white/5" : "bg-slate-100/80"}`}>
                          <p className={`mt-3 text-xs leading-5 ${mutedTextClass}`}>
                            Twoja instalacja fotowoltaiczna produkuje około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(result.estimatedPvProductionKwh).toLocaleString("pl-PL")} kWh</strong> energii rocznie, co odpowiada około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{result.coveragePercent}%</strong> rocznego zużycia energii w domu.
                          </p>
                          <p className={`mt-2 text-xs leading-5 ${mutedTextClass}`}>
                            Obecnie wykorzystujesz bezpośrednio około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(estimatedSelfConsumedPvKwh).toLocaleString("pl-PL")} kWh</strong> (<strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(baseAutoconsumptionRate * 100)}%</strong>) tej energii, a pozostałe około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(estimatedExportedPvKwh).toLocaleString("pl-PL")} kWh</strong> trafia do sieci.
                          </p>
                          <p className={`mt-2 text-xs font-semibold ${isDarkMode ? "text-cyan-200" : "text-cyan-700"}`}>
                            To właśnie ten obszar może poprawić magazyn energii, zwiększając wykorzystanie własnej produkcji zamiast oddawania jej do sieci.
                          </p>
                          {result.shouldRecommendPvExpansion && (
                            <p className={`mt-2 text-xs font-semibold ${isDarkMode ? "text-cyan-200" : "text-cyan-700"}`}>
                              Obecna instalacja fotowoltaiczna pokrywa mniej niż 70% szacowanego zapotrzebowania — warto sprawdzić wariant z rozbudową instalacji.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {hasPv === "no" && (
                    <div className={resultCardClass}>
                      <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>
                        Sugerowana instalacja fotowoltaiczna
                      </p>

                      <p className={isDarkMode ? "mt-1 text-2xl font-bold text-white" : "mt-1 text-2xl font-bold text-slate-950"}>
                        około {result.suggestedPvKw} kWp
                      </p>

                      <button
                        type="button"
                        onClick={() => toggleResultDetail("newPv")}
                        className={`mt-2 text-xs font-bold underline-offset-4 hover:underline ${isDarkMode ? "text-cyan-200" : "text-cyan-800"}`}
                      >
                        {expandedResultDetails.newPv ? "Ukryj szczegóły" : "Rozwiń szczegóły"}
                      </button>

                      {expandedResultDetails.newPv && (
                        <div className={`mt-3 px-4 py-3 ${isDarkMode ? "bg-white/5" : "bg-slate-100/80"}`}>
                          <p className={`text-xs leading-5 ${mutedTextClass}`}>
                            Zgodnie z kalkulacją obecnie zużywasz około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(yearlyConsumptionKwh).toLocaleString("pl-PL")} kWh</strong> energii rocznie.
                          </p>

                      <p className={`mt-2 text-xs leading-5 ${mutedTextClass}`}>
                        Proponowana instalacja fotowoltaiczna o mocy <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{result.suggestedPvKw} kWp</strong> może wyprodukować około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(result.pvStorageProductionKwh).toLocaleString("pl-PL")} kWh</strong> energii rocznie.
                      </p>

                      <p className={`mt-2 text-xs leading-5 ${mutedTextClass}`}>
                        W połączeniu z magazynem energii o pojemności <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{result.recommendedStorageKwh} kWh</strong> oraz systemem inteligentnego zarządzania energią (HEMS/EMS), możliwe jest wykorzystanie nawet około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(result.pvStorageAutoconsumptionRate * 100)}%</strong> wyprodukowanej energii bezpośrednio na potrzeby własnego domu.
                      </p>

                          <p className={`mt-2 text-xs leading-5 ${mutedTextClass}`}>
                            W takim wariancie szacunkowo około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(result.pvStorageSelfConsumedKwh).toLocaleString("pl-PL")} kWh</strong> energii rocznie zostanie wykorzystane w domu, a około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(result.pvStorageExportedKwh).toLocaleString("pl-PL")} kWh</strong> może stanowić nadwyżkę oddawaną do sieci.
                          </p>

                          <p className={`mt-2 text-xs leading-5 ${mutedTextClass}`}>
                            Nadwyżki energii mogą być sprzedawane do sieci energetycznej, a ich wartość zależy między innymi od wybranego sposobu rozliczeń oraz taryfy. Doradca IdeaSol pomoże dobrać najlepsze rozwiązanie i wyjaśni różnice pomiędzy dostępnymi wariantami.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  <div className={resultCardClass}>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>Sugerowany magazyn energii</p>
                    <p className={isDarkMode ? "mt-1 text-2xl font-bold text-cyan-300" : "mt-1 text-2xl font-bold text-cyan-700"}>około {result.recommendedStorageKwh} kWh</p>
                    <p className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>
                      Pojemność dobraliśmy łącznie do zużycia, mocy PV, wybranej taryfy i wskazanych priorytetów — nie tylko do jednego parametru.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                      <span className={isDarkMode ? "bg-white/8 px-3 py-1.5 text-white/75" : "bg-slate-100 px-3 py-1.5 text-slate-700"}>zużycie: {result.storageFromConsumption} kWh</span>
                      {result.storageFromPv > 0 && <span className={isDarkMode ? "bg-white/8 px-3 py-1.5 text-white/75" : "bg-slate-100 px-3 py-1.5 text-slate-700"}>moc PV: {result.storageFromPv} kWh</span>}
                      {result.storageFromTariff > 0 && <span className={isDarkMode ? "bg-white/8 px-3 py-1.5 text-white/75" : "bg-slate-100 px-3 py-1.5 text-slate-700"}>taryfa: {result.storageFromTariff} kWh</span>}
                      {result.storageFromBackup > 0 && <span className={isDarkMode ? "bg-white/8 px-3 py-1.5 text-white/75" : "bg-slate-100 px-3 py-1.5 text-slate-700"}>backup: {result.storageFromBackup} kWh</span>}
                    </div>
                    {(result.storageAlternatives.lower || result.storageAlternatives.higher) && (
                      <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${mutedTextClass}`}>
                        {result.storageAlternatives.lower && (
                          <div className={isDarkMode ? "bg-white/5 p-3" : "bg-slate-100/80 p-3"}>
                            <p className="text-xs font-bold">Mniejszy wariant: {result.storageAlternatives.lower} kWh</p>
                            <p className="mt-1 text-xs leading-5">
                              Niższy koszt, ale mniej energii na wieczór i backup
                              {result.lowerTariffOptimization?.isTimeOfUse
                                ? `; maksymalny potencjał taryfowy spada do około ${formatMoney(result.lowerTariffOptimization.yearlyBenefitHigh)} rocznie.`
                                : "."}
                            </p>
                          </div>
                        )}
                        {result.storageAlternatives.higher && (
                          <div className={isDarkMode ? "bg-white/5 p-3" : "bg-slate-100/80 p-3"}>
                            <p className="text-xs font-bold">Większy wariant: {result.storageAlternatives.higher} kWh</p>
                            <p className="mt-1 text-xs leading-5">
                              Większa rezerwa i dłuższy backup
                              {result.higherTariffOptimization?.isTimeOfUse
                                ? `; maksymalny potencjał taryfowy to około ${formatMoney(result.higherTariffOptimization.yearlyBenefitHigh)} rocznie, więc przewaga finansowa może być niewielka.`
                                : ", ale nie musi proporcjonalnie zwiększyć oszczędności."}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={resultCardClass}>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>Wpływ taryfy na wynik</p>
                    <p className={isDarkMode ? "mt-1 text-xl font-bold text-white" : "mt-1 text-xl font-bold text-slate-950"}>
                      {result.tariffOptimization.label}
                    </p>
                    <p className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>{result.tariffOptimization.strategy}</p>
                    <div className={`mt-4 border p-4 ${isDarkMode ? "border-cyan-300/20 bg-cyan-300/8" : "border-cyan-200 bg-cyan-50"}`}>
                      <p className={`text-[10px] font-bold uppercase tracking-wide ${mutedTextClass}`}>Energia dokupowana z sieci poza własną produkcją PV</p>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xl font-bold">{Math.round(result.gridPurchaseYearlyKwh).toLocaleString("pl-PL")} kWh/rok</p>
                          <p className={`mt-1 text-xs ${mutedTextClass}`}>Szacunek na podstawie rachunku i wybranej taryfy.</p>
                        </div>
                        <div>
                          <p className="text-xl font-bold">{result.gridPurchaseDailyKwh.toFixed(1).replace(".", ",")} kWh/dzień</p>
                          <p className={`mt-1 text-xs ${mutedTextClass}`}>Średnia dobowa będąca podstawą analizy taryfowej.</p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className={isDarkMode ? "bg-white/5 p-4" : "bg-slate-100/80 p-4"}>
                        <p className={`text-[10px] font-bold uppercase tracking-wide ${mutedTextClass}`}>Przy obecnej taryfie</p>
                        <p className="mt-1 text-sm font-bold">{result.tariffOptimization.label}</p>
                        <p className="mt-2 text-lg font-bold text-emerald-600">
                          {formatMoney(result.tariffOptimization.yearlyBenefitLow)} – {formatMoney(result.tariffOptimization.yearlyBenefitHigh)} / rok
                        </p>
                      </div>
                      <div className={isDarkMode ? "bg-white/5 p-4" : "bg-slate-100/80 p-4"}>
                        <p className={`text-[10px] font-bold uppercase tracking-wide ${mutedTextClass}`}>Po zmianie taryfy</p>
                        <p className="mt-1 text-sm font-bold">{result.alternativeTariffOptimization.label}</p>
                        <p className="mt-2 text-lg font-bold text-cyan-600">
                          {formatMoney(result.alternativeTariffOptimization.yearlyBenefitLow)} – {formatMoney(result.alternativeTariffOptimization.yearlyBenefitHigh)} / rok
                        </p>
                      </div>
                    </div>
                    <p className={`mt-3 text-xs font-semibold leading-5 ${mutedTextClass}`}>
                      {result.alternativeTariffOptimization.yearlyBenefitHigh > result.tariffOptimization.yearlyBenefitHigh
                        ? `Zmiana taryfy może zwiększyć potencjał magazynu. Szacowany zwrot w tym wariancie to ${formatPaybackRange(result.alternativePaybackYearsLow, result.alternativePaybackYearsHigh)}.`
                        : "Obecna taryfa ma co najmniej tak dobry potencjał jak porównywany wariant. Sama zmiana taryfy nie poprawia tego wyniku."}
                    </p>
                    {result.tariffOptimization.isTimeOfUse ? (
                      <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className={isDarkMode ? "bg-white/5 p-3" : "bg-slate-100/80 p-3"}>
                            <p className={`text-[10px] font-bold uppercase ${mutedTextClass}`}>Korzyść dziennie</p>
                            <p className="mt-1 font-bold">
                              {formatMoneyWithDecimals(result.tariffOptimization.dailyBenefitMinimum)} – {formatMoneyWithDecimals(result.tariffOptimization.dailyBenefitMaximum)}
                            </p>
                          </div>
                          <div className={isDarkMode ? "bg-white/5 p-3" : "bg-slate-100/80 p-3"}>
                            <p className={`text-[10px] font-bold uppercase ${mutedTextClass}`}>Prognoza roczna</p>
                            <p className="mt-1 font-bold">{formatMoney(result.tariffOptimization.yearlyBenefitLow)} – {formatMoney(result.tariffOptimization.yearlyBenefitHigh)}</p>
                          </div>
                          <div className={isDarkMode ? "bg-white/5 p-3" : "bg-slate-100/80 p-3"}>
                            <p className={`text-[10px] font-bold uppercase ${mutedTextClass}`}>Energia przesuwana</p>
                            <p className="mt-1 font-bold">
                              {result.tariffOptimization.shiftedEnergyMinimumPerActiveDayKwh.toFixed(1).replace(".", ",")} – {result.tariffOptimization.shiftedEnergyPerActiveDayKwh.toFixed(1).replace(".", ",")} kWh/dzień
                            </p>
                          </div>
                        </div>
                        <p className={`mt-3 text-xs leading-5 ${mutedTextClass}`}>
                          Model referencyjny obejmuje stawki G12 i wariantu weekendowego: około {result.tariffOptimization.lowZonePricePerKwh.toFixed(2).replace(".", ",")}–{result.tariffOptimization.lowZonePriceMaximumPerKwh.toFixed(2).replace(".", ",")} zł/kWh w taniej strefie, {result.tariffOptimization.highZonePriceMinimumPerKwh.toFixed(2).replace(".", ",")}–{result.tariffOptimization.highZonePricePerKwh.toFixed(2).replace(".", ",")} zł/kWh w drogiej oraz {result.tariffOptimization.activeDaysMinimumPerYear}–{result.tariffOptimization.activeDaysPerYear} dni pracy taryfowej rocznie. Dokładny wynik wymaga rachunku z podziałem zużycia na strefy i potwierdzenia stawek sprzedawcy oraz operatora.
                        </p>
                      </>
                    ) : (
                      <p className={`mt-3 text-xs font-semibold leading-5 ${mutedTextClass}`}>
                        Do oszczędności nie doliczyliśmy pracy taryfowej. Dzięki temu nie pokazujemy korzyści, której nie da się potwierdzić na podstawie wybranej taryfy.
                      </p>
                    )}
                  </div>
                  <div className={resultCardClass}>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>Szacowana roczna korzyść</p>
                    <p className={isDarkMode ? "mt-1 text-2xl font-bold text-emerald-300" : "mt-1 text-2xl font-bold text-emerald-700"}>
                      {formatMoney(result.yearlySavingsLow)} – {formatMoney(result.yearlySavingsHigh)} / rok
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleResultDetail("yearlySavings")}
                      className={`mt-2 text-xs font-bold underline-offset-4 hover:underline ${isDarkMode ? "text-cyan-300" : "text-cyan-700"}`}
                    >
                      {expandedResultDetails.yearlySavings ? "Ukryj szczegóły" : "Rozwiń szczegóły"}
                    </button>

                    {expandedResultDetails.yearlySavings && (
                      <div className="mt-3 space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className={isDarkMode ? "bg-white/5 px-4 py-3" : "bg-slate-100/80 px-4 py-3"}>
                            <p className={`text-[10px] font-bold uppercase tracking-wide ${mutedTextClass}`}>
                              Energia z PV / cały system
                            </p>
                            <p className="mt-1 text-sm font-bold">
                              {formatMoney(result.energySourceSavingsLow)} – {formatMoney(result.energySourceSavingsHigh)} / rok
                            </p>
                          </div>
                          <div className={isDarkMode ? "bg-white/5 px-4 py-3" : "bg-slate-100/80 px-4 py-3"}>
                            <p className={`text-[10px] font-bold uppercase tracking-wide ${mutedTextClass}`}>
                              Sterowanie według taryfy
                            </p>
                            <p className="mt-1 text-sm font-bold">
                              {result.tariffOptimization.isTimeOfUse
                                ? `${formatMoney(result.tariffOptimization.yearlyBenefitLow)} – ${formatMoney(result.tariffOptimization.yearlyBenefitHigh)} / rok`
                                : "0 zł — brak potwierdzonej różnicy stref"}
                            </p>
                          </div>
                        </div>
                        {result.netBillingSavingsDetails ? (
                        <div className={`mt-3 px-4 py-3 ${isDarkMode ? "bg-white/5" : "bg-slate-100/80"}`}>
                          <p className={`text-xs leading-5 ${mutedTextClass}`}>
                            {settlementSystem === "unknown" ? "Ponieważ nie wskazano systemu rozliczeń, do symulacji przyjęliśmy zasady net-billingu. " : "Dla net-billingu "}przyjęliśmy około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(result.netBillingSavingsDetails.baseAutoconsumptionRate * 100)}%</strong> autokonsumpcji bez magazynu energii oraz około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{Math.round(result.netBillingSavingsDetails.autoconsumptionRateWithStorage * 100)}%</strong> po zastosowaniu magazynu energii i HEMS. Korzyść wynika z tego, że zamiast sprzedawać energię po około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{NET_BILLING_EXPORT_PRICE_PER_KWH.toLocaleString("pl-PL", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} zł/kWh</strong>, a następnie kupować ją po około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{result.purchasePricePerKwh.toLocaleString("pl-PL", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} zł/kWh</strong>, zużywasz większą część własnej energii na potrzeby domu.
                          </p>
                        </div>
                        ) : (
                        <div className={`mt-3 px-4 py-3 ${isDarkMode ? "bg-white/5" : "bg-slate-100/80"}`}>
                          <p className={`text-xs leading-5 ${mutedTextClass}`}>
                            {result.netMeteringSavingsDetails
      ? `Dla net-meteringu przyjęliśmy około ${Math.round(result.netMeteringSavingsDetails.baseAutoconsumptionRate * 100)}% autokonsumpcji bez magazynu energii oraz około ${Math.round(result.netMeteringSavingsDetails.autoconsumptionRateWithStorage * 100)}% autokonsumpcji z zastosowaniem magazynu energii i HEMS. W systemie opustów za każdą 1 kWh oddaną do sieci możesz odebrać około ${Math.round(result.netMeteringSavingsDetails.returnRate * 100)}% energii, dlatego magazyn poprawia wynik głównie przez ograniczenie tej straty i zwiększenie zużycia energii na miejscu.`
      : hasPv === "no"
        ? `To około ${Math.round((result.yearlySavingsLow / yearlyBill) * 100)}–${Math.round((result.yearlySavingsHigh / yearlyBill) * 100)}% obecnych kosztów energii. Szacunek wynika z porównania obecnego rachunku z przewidywanym kosztem energii po montażu fotowoltaiki, magazynu energii i systemu HEMS/EMS.`
        : `To około ${Math.round((result.yearlySavingsLow / yearlyBill) * 100)}–${Math.round((result.yearlySavingsHigh / yearlyBill) * 100)}% obecnych kosztów energii, w zależności od profilu zużycia i sposobu pracy instalacji.`}
                          </p>
                        </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={resultCardClass}>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>Orientacyjny koszt inwestycji</p>
                    <p className={isDarkMode ? "mt-1 text-2xl font-bold text-white" : "mt-1 text-2xl font-bold text-slate-950"}>
                      {formatMoney(result.priceLow)} – {formatMoney(result.priceHigh)}
                    </p>
                  </div>
                  <div className={resultCardClass}>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>Potencjalna dotacja — nabór planowany</p>
                    <p className={isDarkMode ? "mt-1 text-2xl font-bold text-violet-300" : "mt-1 text-2xl font-bold text-violet-700"}>do {formatMoney(result.subsidyEstimate)}</p>
                    <p className={`mt-1 text-xs font-semibold ${mutedTextClass}`}>
                      {formatMoney(result.subsidyStorage)} dotacji do magazynu oraz {formatMoney(result.subsidyEuBonus)} bonusu za urządzenie / EMS z UE
                    </p>
                    <p className={`mt-2 text-xs leading-5 ${mutedTextClass}`}>
                      Pokazujemy maksymalną możliwą kwotę: do 800 zł za każdą kWh pojemności magazynu, maksymalnie {formatMoney(result.subsidyStorageLimit)} dla tej konfiguracji, oraz do 2 000 zł bonusu za urządzenie lub EMS produkowane w UE. Łączny limit programu wynosi do 18 000 zł. Ostateczna dotacja zależy między innymi od kosztów kwalifikowanych i wymaga potwierdzenia warunków planowanego naboru PME 2.
                    </p>
                  </div>
                  <div className={resultCardClass}>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDarkMode ? "text-cyan-300/80" : "text-cyan-700"}`}>Szacunkowy okres zwrotu z potencjalną dotacją</p>
                    <p className={isDarkMode ? "mt-1 text-2xl font-bold text-amber-300" : "mt-1 text-2xl font-bold text-amber-700"}>
                      {result.paybackYearsLow === result.paybackYearsHigh
                        ? `około ${result.paybackYearsLow} ${result.paybackYearsLow === 1 ? "rok" : result.paybackYearsLow >= 2 && result.paybackYearsLow <= 4 ? "lata" : "lat"}`
                        : `${result.paybackYearsLow}–${result.paybackYearsHigh} lat`}
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleResultDetail("payback")}
                      className={`mt-2 text-xs font-bold underline-offset-4 hover:underline ${isDarkMode ? "text-cyan-300" : "text-cyan-700"}`}
                    >
                      {expandedResultDetails.payback ? "Ukryj szczegóły" : "Rozwiń szczegóły"}
                    </button>
                    {expandedResultDetails.payback && (
                      <div className={`mt-3 px-4 py-3 ${isDarkMode ? "bg-white/5" : "bg-slate-100/80"}`}>
                        <p className={`text-xs leading-5 ${mutedTextClass}`}>
                          Przyjęliśmy wzrost wartości oszczędności o <strong className={isDarkMode ? "text-white" : "text-slate-900"}>9% rocznie</strong>. Bez dotacji okres zwrotu wynosi około <strong className={isDarkMode ? "text-white" : "text-slate-900"}>{result.paybackYearsWithoutSubsidyLow}–{result.paybackYearsWithoutSubsidyHigh} lat</strong>. Kalkulacja nie uwzględnia degradacji, kosztu finansowania ani ewentualnej wymiany baterii, dlatego wynik pozostaje orientacyjny.
                        </p>
                      </div>
                    )}
                  </div>
                    </div>
                  )}
                </div>
                ) : (
                  <div className={`rounded-[24px] border p-5 ${isDarkMode ? "border-cyan-300/20 bg-cyan-300/10" : "border-cyan-200 bg-cyan-50"}`}>
                    <p className="font-bold">Poznaj szczegóły wyniku i porozmawiaj ze specjalistą</p>
                    <p className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>
                      Zostaw dane kontaktowe poniżej, aby odblokować pojemność magazynu, widełki cenowe, oszczędności, wariant dotacji i okres zwrotu. Specjalista IdeaSol skontaktuje się z Tobą, aby omówić wynik.
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={editAnswers}
                    className={`w-full rounded-2xl px-5 py-3 text-sm font-bold transition hover:-translate-y-0.5 ${isDarkMode ? "bg-white/10 text-white hover:bg-white/15" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}
                  >
                    Popraw odpowiedzi
                  </button>
                  <button
                    type="button"
                    onClick={restartCalculator}
                    className={`w-full rounded-2xl px-5 py-3 text-sm font-bold transition hover:-translate-y-0.5 ${isDarkMode ? "bg-white/5 text-white/80 hover:bg-white/10 hover:text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-950"}`}
                  >
                    Zacznij od początku
                  </button>
                </div>

                <div className={contactPanelClass}>
                  <p className={`text-xs font-bold uppercase tracking-[0.2em] ${isDarkMode ? "text-lime-300" : "text-lime-700"}`}>
                    Szczegółowa analiza Twojego wyniku
                  </p>
                  <p className="mt-3 text-xl font-bold">Odbierz pełną analizę</p>
                  <p className={`mt-2 text-sm ${mutedTextClass}`}>
                    Po przesłaniu formularza pokażemy dobraną pojemność, oszczędności, ceny, potencjalną dotację i okres zwrotu. Specjalista IdeaSol skontaktuje się z Tobą, aby zweryfikować wynik i odpowiedzieć na pytania.
                  </p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className={contactLabelClass}>Imię *</span>
                      <input
                        name="given-name"
                        autoComplete="given-name"
                        value={contactFirstName}
                        onChange={(event) => setContactFirstName(event.target.value)}
                        placeholder="np. Jan"
                        className={contactInputClass}
                      />
                    </label>

                    <label className="block">
                      <span className={contactLabelClass}>Nazwisko</span>
                      <input
                        name="family-name"
                        autoComplete="family-name"
                        value={contactLastName}
                        onChange={(event) => setContactLastName(event.target.value)}
                        placeholder="np. Kowalski"
                        className={contactInputClass}
                      />
                    </label>

                    <label className="block">
                      <span className={contactLabelClass}>Kod pocztowy *</span>
                      <input
                        name="postal-code"
                        value={contactPostalCode}
                        onChange={(event) => {
                          setContactPostalCode(formatPostalCode(event.target.value));
                        }}
                        inputMode="numeric"
                        autoComplete="postal-code"
                        maxLength={6}
                        placeholder="np. 25-015"
                        className={contactInputClass}
                      />
                    </label>

                    <label className="block">
                      <span className={contactLabelClass}>Telefon *</span>
                      <input
                        name="tel"
                        autoComplete="tel"
                        value={contactPhone}
                        onChange={(event) => setContactPhone(formatPhoneInput(event.target.value))}
                        inputMode="tel"
                        placeholder="np. 500 600 700"
                        aria-invalid={contactPhoneHasError}
                        aria-describedby={contactPhoneHasError ? "contact-phone-error" : undefined}
                        className={`${contactInputClass} ${contactPhoneHasError ? "border-rose-400 ring-2 ring-rose-200/70" : ""}`}
                      />
                      {contactPhoneHasError && (
                        <span id="contact-phone-error" className={`mt-2 block text-xs font-semibold ${isDarkMode ? "text-rose-200" : "text-rose-700"}`}>
                          Podaj prawidłowy polski numer komórkowy, np. 501 234 567.
                        </span>
                      )}
                    </label>

                    <label className="block sm:col-span-2">
                      <span className={contactLabelClass}>E-mail</span>
                      <input
                        name="email"
                        autoComplete="email"
                        value={contactEmail}
                        onChange={(event) => setContactEmail(event.target.value)}
                        inputMode="email"
                        placeholder="opcjonalnie — wyślemy kopię analizy"
                        className={contactInputClass}
                      />
                    </label>

                    <label className={`sm:col-span-2 flex items-start gap-3 rounded-xl border p-3 ${isDarkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-white/70"}`}>
                      <input
                        type="checkbox"
                        checked={marketingConsent}
                        onChange={(event) => setMarketingConsent(event.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <span className={`text-xs leading-5 ${mutedTextClass}`}>
                        Wyrażam zgodę na przetwarzanie podanych danych kontaktowych w celu kontaktu ze strony doradcy IdeaSol Sp. z o.o. z siedzibą w Kielcach, w związku z analizą zapotrzebowania na magazyn energii oraz przedstawieniem informacji handlowych dotyczących oferowanych rozwiązań energetycznych.
                      </span>
                    </label>
                  </div>

                  <div className="mt-4 flex justify-center">
                    {turnstileSiteKey ? (
                      <div ref={turnstileRef} />
                    ) : (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        Brak konfiguracji Turnstile (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
                      </div>
                    )}
                  </div>
                  {!turnstileToken && (
                    <p className={`mt-3 text-center text-xs ${mutedTextClass}`}>
                      Potwierdź zabezpieczenie antyspamowe, aby wysłać zgłoszenie.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={submitLead}
                    disabled={!canSubmitLead || isSubmittingLead}
                    className={contactSubmitButtonClass}
                  >
                    {isSubmittingLead ? "Wysyłamy zgłoszenie..." : "Odbierz raport i kontakt specjalisty"}
                  </button>

                  {leadSubmitStatus === "success" && (
                    <p className={`mt-3 rounded-2xl p-3 text-sm font-semibold ${isDarkMode ? "bg-emerald-300/10 text-emerald-100" : "bg-emerald-50 text-emerald-700"}`}>
                      Zgłoszenie zostało zapisane w CRM, a pełny raport jest odblokowany powyżej. Doradca IdeaSol skontaktuje się z Tobą możliwie szybko. Jeżeli podałeś adres e-mail, otrzymasz również kopię analizy.
                    </p>
                  )}

                  {leadSubmitStatus === "error" && (
                    <p className={`mt-3 rounded-2xl p-3 text-sm font-semibold ${isDarkMode ? "bg-rose-300/10 text-rose-100" : "bg-rose-50 text-rose-700"}`}>
                      Nie udało się wysłać zgłoszenia. Spróbuj ponownie za chwilę.
                    </p>
                  )}
                </div>

                <div className={`pt-2 text-xs leading-5 ${isDarkMode ? "text-[#D8CEC7]" : "text-slate-600"}`}>
                  Wynik ma charakter orientacyjny. Model oddziela stałe i zmienne składniki rachunku, uwzględnia sprawność magazynu, ograniczoną liczbę cykli, aktualny współczynnik wartości depozytu prosumenckiego i planowane limity programu PME 2. Dokładna analiza wymaga profilu godzinowego zużycia i produkcji, parametrów instalacji, warunków technicznych budynku oraz potwierdzenia aktualnego naboru dotacyjnego.
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {step === 2 && (
                  <div>
                    <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${eyebrowTextClass}`}>Krok 1</p>
                    <h2 className="mt-3 text-2xl font-bold">Czy masz już instalację fotowoltaiczną?</h2>
                    <div className="mt-5 grid gap-3">
                      <button
                        type="button"
                        onPointerUp={() => selectHasPv("yes")}
                        className={optionButtonClass(hasPv === "yes")}
                      >
                        <span className="block text-lg font-bold">Tak, mam instalację fotowoltaiczną i chcę dobrać do niej magazyn energii</span>
                        <span className={`mt-1 block text-sm ${mutedTextClass}`}>Sprawdzimy pojemność magazynu, oszczędności i możliwą dotację.</span>
                      </button>
                      <button
                        type="button"
                        onPointerUp={() => selectHasPv("no")}
                        className={optionButtonClass(hasPv === "no")}
                      >
                        <span className="block text-lg font-bold">Nie, ale chcę mieć fotowoltaikę wraz z magazynem energii</span>
                        <span className={`mt-1 block text-sm ${mutedTextClass}`}>Oszacujemy moc instalacji fotowoltaicznej i magazynu energii na podstawie Twojego zużycia.</span>
                      </button>
                    </div>
                  </div>
                )}

                {hasPv === "yes" && step === 3 && (
                  <div ref={pvDetailsRef} className={`scroll-mt-6 rounded-[28px] border p-5 backdrop-blur animate-[fadeInUp_0.45s_ease-out] ${isDarkMode ? "border-white/10 bg-white/5 shadow-inner shadow-black/20" : "border-slate-200 bg-white/55 shadow-inner shadow-white/70"}`}>
                    <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${eyebrowTextClass}`}>Krok 2</p>
                    <h2 className="mt-3 text-2xl font-bold">Podaj szczegóły obecnej instalacji</h2>

                    <div className="mt-5 grid gap-4">
                      <label className="block">
                        <span className={labelClass}>Moc obecnej instalacji fotowoltaicznej</span>
                        <div className="mt-2 flex items-center gap-3">
                          <input
                            value={pvPower}
                            onChange={(event) => setPvPower(event.target.value.replace(",", "."))}
                            inputMode="decimal"
                            placeholder="np. 8.5"
                            className={`w-full ${inputClass}`}
                          />
                          <span className={`font-bold ${isDarkMode ? "text-white/70" : "text-slate-600"}`}>kWp</span>
                        </div>
                      </label>

                      <div>
                        <p className={labelClass}>W jakim systemie rozliczasz energię?</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          {[
                            ["net_billing", "net-billing", "tzw. nowe zasady"],
                            ["net_metering", "net-metering", "tzw. stare zasady"],
                            ["unknown", "Nie wiem", "sprawdzimy to później"],
                          ].map(([value, label, subtitle]) => (
                            <button
                              key={value}
                              type="button"
                              onPointerUp={() => selectSettlementSystem(value as Exclude<SettlementSystem, null>)}
                              className={`${optionButtonClass(settlementSystem === value, "compact")} font-semibold`}
                            >
                              <span className="block">{label}</span>
                              {subtitle && (
                                <span className={`mt-1 block text-xs font-normal ${isDarkMode ? "text-white/60" : "text-slate-500"}`}>
                                  {subtitle}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                        {settlementSystem && (
                          <div className={hintBoxClass}>
                            <span className={isDarkMode ? "font-bold text-white" : "font-bold text-slate-950"}>Wskazówka:</span> {settlementSystemHint[settlementSystem]}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const settlementLabel = settlementSystem === "net_billing"
                          ? "net-billing (nowe zasady)"
                          : settlementSystem === "net_metering"
                            ? "net-metering (stare zasady)"
                            : "Nie wiem";
                        trackCalculatorEvent("step_view", {
                          stepNumber: 2,
                          stepKey: "odpowiedz_szczegoly_instalacji",
                          question: "Podaj szczegóły obecnej instalacji",
                          answer: `Moc instalacji: ${parseDecimal(pvPower).toLocaleString("pl-PL")} kWp; system rozliczeń: ${settlementLabel}`,
                          hasPv: "yes",
                        });
                        goToStep(4);
                        scrollToElement(formRef.current);
                      }}
                      disabled={!hasValidPvDetails || !settlementSystem}
                      className={`mt-5 ${primaryButtonClass}`}
                    >
                      Dalej
                    </button>
                    <button type="button" onClick={goBack} className={backButtonClass}>
                      Wstecz
                    </button>
                  </div>
                )}

                {step === 4 && (
                  <div ref={step4Ref}>
                    <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${eyebrowTextClass}`}>Krok {hasPv === "yes" ? "3" : "2"}</p>
                    <h2 className="mt-3 text-2xl font-bold">Jaki masz rachunek za energię?</h2>
                    <div className="mt-5 grid gap-3 sm:grid-cols-[160px_1fr]">
                      <select value={billMode} onChange={(event) => setBillMode(event.target.value as BillMode)} className={inputClass}>
                        <option value="monthly">miesięcznie</option>
                        <option value="yearly">rocznie</option>
                      </select>
                      <input
                        value={billAmount}
                        onChange={(event) => setBillAmount(event.target.value.replace(",", "."))}
                        inputMode="decimal"
                        placeholder="np. 350"
                        className={inputClass}
                      />
                    </div>
                    <p className={`mt-2 text-sm ${mutedTextClass}`}>Podaj kwotę brutto z rachunku. Na tej podstawie oszacujemy zużycie energii.</p>
                    <button
                      type="button"
                      onClick={() => {
                        trackCalculatorEvent("step_view", {
                          stepNumber: hasPv === "yes" ? 3 : 2,
                          stepKey: "odpowiedz_rachunek_za_energie",
                          question: "Jaki masz rachunek za energię?",
                          answer: `${billValue.toLocaleString("pl-PL")} zł ${billMode === "monthly" ? "miesięcznie" : "rocznie"} (wartość roczna: ${yearlyBill.toLocaleString("pl-PL")} zł)`,
                          hasPv: hasPv || undefined,
                        });
                        goToStep(5);
                        scrollToElement(formRef.current);
                      }}
                      disabled={yearlyBill <= 0}
                      className={`mt-3 ${primaryButtonClass}`}
                    >
                      Dalej
                    </button>
                    <button type="button" onClick={goBack} className={backButtonClass}>
                      Wstecz
                    </button>
                  </div>
                )}

                {step === 5 && (
                  <div ref={step5Ref}>
                    <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${eyebrowTextClass}`}>Krok {hasPv === "yes" ? "4" : "3"}</p>
                    <h2 className="mt-3 text-2xl font-bold">Z jakiej taryfy korzystasz?</h2>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      {[
                        ["G11", "G11 — stała cena energii"],
                        ["G12", "G12 — taryfa dwustrefowa"],
                        ["G13", "G13 — trzy strefy"],
                        ["other_unknown", "Inna / nie wiem"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onPointerUp={() => selectTariff(value as Exclude<Tariff, null>)}
                          className={`${optionButtonClass(tariff === value, "compact")} font-semibold`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {tariff && (
                      <div className={hintBoxClass}>
                        <span className={isDarkMode ? "font-bold text-white" : "font-bold text-slate-950"}>Wskazówka:</span> {tariffHint[tariff]}
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={!tariff}
                      onClick={() => {
                        if (!tariff) return;
                        const tariffLabel = {
                          G11: "G11 — stała cena energii",
                          G12: "G12 — taryfa dwustrefowa",
                          G13: "G13 — trzy strefy",
                          other_unknown: "Inna / nie wiem",
                        }[tariff];
                        trackCalculatorEvent("step_view", {
                          stepNumber: hasPv === "yes" ? 4 : 3,
                          stepKey: "odpowiedz_taryfa",
                          question: "Z jakiej taryfy korzystasz?",
                          answer: tariffLabel,
                          hasPv: hasPv || undefined,
                        });
                        goToStep(6);
                        scrollToElement(formRef.current);
                      }}
                      className={`mt-3 ${primaryButtonClass}`}
                    >
                      Dalej
                    </button>
                    <button type="button" onClick={goBack} className={backButtonClass}>
                      Wstecz
                    </button>
                  </div>
                )}

                {step === 6 && (
                  <div>
                    <p className={`text-sm font-semibold uppercase tracking-[0.2em] ${eyebrowTextClass}`}>Krok {hasPv === "yes" ? "5" : "4"}</p>
                    <h2 className="mt-3 text-2xl font-bold">Co jest dla Ciebie najważniejsze?</h2>
                    <div className="mt-5 grid gap-3">
                      {Object.keys(priorityHint)
                        .filter((item) => hasPv === "yes" || item !== "Zwiększenie produktywności mojej instalacji fotowoltaicznej (zapobieganie wyłączeniom)")
                        .map((item) => (
                        <div key={item}>
                          <button
                            type="button"
                            onPointerUp={() => togglePriority(item)}
                            className={`w-full ${optionButtonClass(priorities.includes(item), "compact")} font-semibold`}
                          >
                            {item}
                          </button>
                          {priorities.includes(item) && (
                            <div className={priorityHintBoxClass}>
                              <span className={isDarkMode ? "font-bold text-white" : "font-bold text-slate-950"}>Wskazówka:</span> {priorityHint[item]}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      ref={step6Ref}
                      type="button"
                      onClick={handleCalculate}
                      disabled={!canCalculate}
                      className="mt-3 w-full rounded-2xl bg-[#c7f36b] px-6 py-4 text-lg font-black text-[#10261f] shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-[#b9ed54] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0"
                    >
                      Dokonaj analizy
                    </button>
                    <button type="button" onClick={goBack} className={backButtonClass}>
                      Wstecz
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        )}
      </div>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setIsTurnstileLoaded(true)}
      />
      <style jsx global>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <section className={`mx-auto mt-12 w-full max-w-7xl rounded-[32px] border p-6 sm:p-9 ${isDarkMode ? "border-white/10 bg-white/5" : "border-[#13231d]/10 bg-white/60"}`}>
        <div className="flex flex-wrap items-end justify-between gap-5 border-b pb-6 border-current/10">
          <div>
            <p className={`text-xs font-black uppercase tracking-[0.2em] ${eyebrowTextClass}`}>Baza wiedzy</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] sm:text-4xl">Podejmij decyzję świadomie</h2>
            <p className={`mt-3 max-w-2xl text-sm leading-6 ${mutedTextClass}`}>Praktyczne poradniki o opłacalności, doborze urządzeń i zasadach rozliczeń.</p>
          </div>
          <Link href="/blog" className={`rounded-full px-5 py-3 text-sm font-black transition hover:-translate-y-0.5 ${isDarkMode ? "bg-[#c7f36b] text-[#10261f]" : "bg-[#10261f] text-white"}`}>
            Wszystkie artykuły →
          </Link>
        </div>

        <div className="mt-7 grid gap-5 md:grid-cols-3">
          {[
            { href: "/blog/czy-magazyn-energii-sie-oplaca-w-2026-roku", image: "/blog/home-storage-evening.png", title: "Czy magazyn energii się opłaca?", text: "Realne okresy zwrotu, koszty i scenariusze na 2026 rok." },
            { href: "/blog/jak-dobrac-magazyn-energii-do-fotowoltaiki", image: "/blog/storage-sizing-workspace.png", title: "Jak dobrać pojemność magazynu?", text: "Dlaczego większa bateria nie zawsze oznacza większe oszczędności." },
            { href: "/blog/net-billing-a-magazyn-energii-kompletny-poradnik", image: "/blog/dynamic-energy-pricing.png", title: "Net-billing bez tajemnic", text: "Ceny godzinowe, autokonsumpcja i rola magazynu energii." },
          ].map((article) => (
            <Link key={article.href} href={article.href} className="group">
              <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-[#dce4dc]">
                <Image src={article.image} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition duration-500 group-hover:scale-[1.035]" />
              </div>
              <h3 className="mt-4 text-lg font-black leading-tight transition group-hover:text-[#397f72]">{article.title}</h3>
              <p className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>{article.text}</p>
            </Link>
          ))}
        </div>
      </section>
      <p className={`mx-auto mt-6 max-w-5xl px-4 text-center text-xs leading-5 ${mutedTextClass}`}>
        W celu zapewnienia bezpieczeństwa i analizy działania kalkulatora zapisujemy techniczne dane
        wizyty, w tym adres IP, przybliżoną lokalizację, źródło wejścia oraz osiągnięte etapy. Dane
        formularza kontaktowego są przetwarzane oddzielnie zgodnie z zasadami IdeaSol.
      </p>
    </main>
  );
}
