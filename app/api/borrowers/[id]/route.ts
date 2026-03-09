import { NextRequest, NextResponse } from "next/server";
import store from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const state = store.getState();
  const borrower = state.borrowers.find((b) => b.id === id);
  if (!borrower) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const incomeRecords = state.incomeRecords.filter((r) => r.borrowerId === id);
  const accounts = state.accounts.filter((a) => a.borrowerId === id);
  const borrowerDocIds = new Set(borrower.sources.map((s) => s.documentId));
  const fields = state.extractedFields.filter(
    (f) => f.category === "borrower" && borrowerDocIds.has(f.documentId)
  );

  return NextResponse.json({ borrower, incomeRecords, accounts, fields, loan: state.loan });
}
