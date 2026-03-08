import { NextRequest, NextResponse } from "next/server";
import store from "@/lib/store";
import { deleteDocumentAndReaggregate } from "@/lib/pipeline/orchestrator";
import { readRawText } from "@/lib/pdf/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = store.getDocument(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const extraction = store.getExtraction(id);
  const rawText = readRawText(id);

  return NextResponse.json({ document: doc, extraction, rawText });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = store.getDocument(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Run async — SSE will push updates
  deleteDocumentAndReaggregate(id).catch((e) => console.error("Delete error:", e));

  return NextResponse.json({ success: true });
}
