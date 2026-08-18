import { isIP } from "node:net";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://magazyny.ideasol.pl",
  "https://www.magazyny.ideasol.pl",
];

const EVENT_STAGES = {
  calculator_view: 0,
  calculator_started: 1,
  step_view: null,
  analysis_started: 6,
  recommendation_shown: 7,
  lead_submit_attempt: 8,
  lead_submit_success: 9,
  lead_submit_failed: 8,
  report_unlocked: 10,
  session_closed: null,
} as const;

type EventName = keyof typeof EVENT_STAGES;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function limitedText(value: unknown, maxLength = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function getAllowedOrigins() {
  const configured =
    process.env.CALCULATOR_ANALYTICS_ALLOWED_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || getAllowedOrigins().has(origin);
}

function decodeHeader(value: string | null) {
  if (!value) return null;

  try {
    return decodeURIComponent(value).slice(0, 160);
  } catch {
    return value.slice(0, 160);
  }
}

function getRequestIp(request: Request) {
  const candidates = [
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim(),
    request.headers.get("x-real-ip")?.trim(),
    request.headers.get("cf-connecting-ip")?.trim(),
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ];

  return candidates.find((candidate) => candidate && isIP(candidate)) || null;
}

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) throw new Error("Brak konfiguracji Supabase dla analityki.");
  return { url, key };
}

async function supabaseRequest(path: string, init: RequestInit) {
  const { url, key } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Supabase analytics request failed (${response.status}): ${message.slice(0, 300)}`);
  }
}

function sanitizeEventPayload(body: Record<string, unknown>) {
  const payload: Record<string, string | number> = {};
  const recommendationType = limitedText(body.recommendationType, 32);
  const leadClientId = limitedText(body.leadClientId, 40);
  const hasPv = limitedText(body.hasPv, 8);
  const question = limitedText(body.question, 300);
  const answer = limitedText(body.answer, 2_000);
  const recommendedStorageKwh = Number(body.recommendedStorageKwh);

  if (recommendationType === "recommended" || recommendationType === "not_recommended") {
    payload.recommendation_type = recommendationType;
  }
  if (leadClientId && UUID_PATTERN.test(leadClientId)) payload.lead_client_id = leadClientId;
  if (hasPv === "yes" || hasPv === "no") payload.has_pv = hasPv;
  if (question) payload.question = question;
  if (answer) payload.answer = answer;
  if (Number.isFinite(recommendedStorageKwh) && recommendedStorageKwh > 0 && recommendedStorageKwh <= 100) {
    payload.recommended_storage_kwh = recommendedStorageKwh;
  }

  return payload;
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const sessionId = limitedText(body.sessionId, 40);
    const eventName = limitedText(body.eventName, 40) as EventName | null;

    if (!sessionId || !UUID_PATTERN.test(sessionId) || !eventName || !(eventName in EVENT_STAGES)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const requestedStep = Number(body.stepNumber);
    const stepNumber =
      eventName === "step_view" || eventName === "session_closed"
        ? Math.min(10, Math.max(0, Number.isFinite(requestedStep) ? Math.round(requestedStep) : 0))
        : EVENT_STAGES[eventName];
    const landingUrl = limitedText(body.landingUrl, 1_500);
    let hostname = "";
    try {
      hostname = landingUrl ? new URL(landingUrl).hostname.toLowerCase() : "";
    } catch {
      hostname = "";
    }
    const isTest = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    const screenWidth = Number(body.screenWidth);
    const screenHeight = Number(body.screenHeight);

    await supabaseRequest("energy_storage_calculator_sessions?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        id: sessionId,
        ip_address: getRequestIp(request),
        country_code: limitedText(request.headers.get("x-vercel-ip-country"), 8)
          || limitedText(request.headers.get("cf-ipcountry"), 8),
        region: decodeHeader(request.headers.get("x-vercel-ip-country-region")),
        city: decodeHeader(request.headers.get("x-vercel-ip-city")),
        postal_code: decodeHeader(request.headers.get("x-vercel-ip-postal-code")),
        timezone: decodeHeader(request.headers.get("x-vercel-ip-timezone")),
        user_agent: limitedText(request.headers.get("user-agent"), 1_000),
        accept_language: limitedText(request.headers.get("accept-language"), 300),
        referrer: limitedText(body.referrer, 1_500),
        landing_url: landingUrl,
        utm_source: limitedText(body.utmSource, 200),
        utm_medium: limitedText(body.utmMedium, 200),
        utm_campaign: limitedText(body.utmCampaign, 300),
        utm_content: limitedText(body.utmContent, 300),
        utm_term: limitedText(body.utmTerm, 300),
        device_type: limitedText(body.deviceType, 24),
        screen_width: Number.isFinite(screenWidth) ? Math.max(0, Math.round(screenWidth)) : null,
        screen_height: Number.isFinite(screenHeight) ? Math.max(0, Math.round(screenHeight)) : null,
        is_test: isTest,
      }),
    });

    await supabaseRequest("energy_storage_calculator_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        session_id: sessionId,
        event_name: eventName,
        step_number: stepNumber,
        step_key: limitedText(body.stepKey, 80),
        payload: sanitizeEventPayload(body),
      }),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("calculator analytics error", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
