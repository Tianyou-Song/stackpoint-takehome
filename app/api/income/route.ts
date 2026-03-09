import { NextResponse } from "next/server";
import store from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = store.getState();
  return NextResponse.json(state.incomeRecords);
}
