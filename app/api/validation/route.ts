import { NextResponse } from "next/server";
import store from "@/lib/store";
import { reaggregate } from "@/lib/pipeline/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = store.getState();
  return NextResponse.json(state.validationFindings);
}

export async function POST() {
  await store.init();
  await reaggregate();
  const state = store.getState();
  return NextResponse.json(state.validationFindings);
}
