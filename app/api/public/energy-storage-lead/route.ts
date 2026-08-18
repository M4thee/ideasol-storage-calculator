import { NextResponse } from "next/server";

const DEFAULT_CRM_LEAD_ENDPOINT = "https://crm.ideasol.pl/api/public/energy-storage-lead";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://magazyny.ideasol.pl",
  "https://www.ideasol.pl",
  "https://ideasol.pl",
];

function getAllowedOrigins() {
  const configuredOrigins =
    process.env.PUBLIC_LEAD_ALLOWED_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];

  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]));
}

function getCorsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: Request) {
  const corsHeaders = getCorsHeaders(request);

  try {
    const payload = await request.json();
    const crmEndpoint = process.env.CRM_LEAD_ENDPOINT || DEFAULT_CRM_LEAD_ENDPOINT;
    const forwardedFor =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userAgent = request.headers.get("user-agent")?.slice(0, 1000);

    const crmResponse = await fetch(crmEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Host": request.headers.get("host") || "magazyny.ideasol.pl",
        "X-Forwarded-Proto": "https",
        ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
        ...(forwardedFor ? { "X-Client-IP": forwardedFor } : {}),
        ...(userAgent ? { "X-Client-User-Agent": userAgent } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const contentType = crmResponse.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await crmResponse.json().catch(() => ({})) as Record<string, unknown>
      : { error: await crmResponse.text().catch(() => "Nie udało się wysłać zgłoszenia.") };

    if (crmResponse.ok && data.ok === true && typeof data.clientId !== "string") {
      return NextResponse.json(
        { error: "CRM nie potwierdził zapisu leada." },
        { status: 502, headers: corsHeaders }
      );
    }

    return NextResponse.json(data, {
      status: crmResponse.status,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("energy-storage-lead proxy error", error);

    return NextResponse.json(
      { error: "Nie udało się wysłać zgłoszenia." },
      { status: 500, headers: corsHeaders }
    );
  }
}
