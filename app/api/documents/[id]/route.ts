import { NextRequest, NextResponse } from "next/server";
import store from "@/lib/store";
import { deleteDocumentAndReaggregate, processDocument, reaggregate } from "@/lib/pipeline/orchestrator";

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

  return NextResponse.json({ document: doc, extraction });
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

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = store.getDocument(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.status !== "error") return NextResponse.json({ error: "Document is not in error state" }, { status: 400 });

  const retryDoc = { ...doc, status: "pending" as const, errorMessage: undefined };
  store.upsertDocument(retryDoc);

  // Re-run pipeline async — SSE will push updates
  processDocument(retryDoc)
    .then(() => reaggregate())
    .catch((e) => console.error("Retry error:", e));

  return NextResponse.json({ success: true });
}
