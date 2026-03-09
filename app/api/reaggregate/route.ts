import { NextResponse } from "next/server";
import store from "@/lib/store";
import { reaggregate } from "@/lib/pipeline/orchestrator";

export async function POST() {
  await store.init();
  await reaggregate();
  return NextResponse.json({ ok: true });
}
