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

    const crmResponse = await fetch(crmEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Host": request.headers.get("host") || "magazyny.ideasol.pl",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify(payload),
    });

    const contentType = crmResponse.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await crmResponse.json().catch(() => ({}))
      : { error: await crmResponse.text().catch(() => "Nie udało się wysłać zgłoszenia.") };

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