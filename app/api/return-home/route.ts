import { NextResponse } from "next/server";
import { calculateLatestDepartureForLocation } from "@/lib/return-home";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const location = searchParams.get("location") ?? "四条";
  const walkMin = Number(searchParams.get("walkMin") ?? "5");
  const bufferMin = Number(searchParams.get("bufferMin") ?? "0");

  try {
    const result = calculateLatestDepartureForLocation(location, walkMin, bufferMin);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const location = String(body.location ?? "四条");
    const walkMin = Number(body.walkMin ?? 5);
    const bufferMin = Number(body.bufferMin ?? 0);

    const result = calculateLatestDepartureForLocation(location, walkMin, bufferMin);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
