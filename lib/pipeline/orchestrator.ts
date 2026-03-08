import fs from "fs";
import path from "path";
import type { LoanDocument } from "../types";
import store from "../store";
import emitter from "../events";
import { extractTextFromPDF, saveRawText } from "../pdf/parser";
import { extractFromDocument } from "../ai/extract";
import { assembleFromExtractions } from "./assembler";
import { runValidation } from "./validator";

function updateDocStatus(doc: LoanDocument, updates: Partial<LoanDocument>) {
  const updated = { ...doc, ...updates };
  store.upsertDocument(updated);
  return updated;
}

export async function processDocument(doc: LoanDocument): Promise<void> {
  let current = doc;

  try {
    // 1. Parse
    current = updateDocStatus(current, { status: "parsing" });
    emitter.emit({ type: "document:parsing", documentId: doc.id, message: `Parsing ${doc.originalName}` });

    const parsed = await extractTextFromPDF(doc.filePath);
    const rawTextPath = saveRawText(doc.id, parsed.fullText);

    current = updateDocStatus(current, {
      status: "parsed",
      pageCount: parsed.pageCount,
      rawTextPath,
    });
    emitter.emit({ type: "document:parsed", documentId: doc.id, message: `Parsed ${parsed.pageCount} pages` });

    // 2. Extract
    current = updateDocStatus(current, { status: "extracting" });
    emitter.emit({ type: "document:extracting", documentId: doc.id, message: "Extracting with Gemini..." });

    const extraction = await extractFromDocument(doc.id, doc.originalName, parsed.fullText);

    // Update doc type from extraction
    current = updateDocStatus(current, {
      status: "extracted",
      documentType: extraction.documentType,
    });
    store.upsertExtraction(extraction);
    emitter.emit({ type: "document:extracted", documentId: doc.id, message: `Extracted ${extraction.fields.length} fields` });

    // 3. Mark complete
    current = updateDocStatus(current, {
      status: "completed",
      processedAt: new Date().toISOString(),
    });
    emitter.emit({ type: "document:completed", documentId: doc.id });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(
      `[orchestrator] processDocument failed for ${doc.originalName} (id=${doc.id}):`,
      errorMessage,
      stack ?? ""
    );
    updateDocStatus(current, { status: "error", errorMessage });
    emitter.emit({ type: "document:error", documentId: doc.id, message: errorMessage });
    throw err;
  }
}

export async function processBatch(docs: LoanDocument[]): Promise<void> {
  // Process all docs in parallel
  await Promise.allSettled(docs.map((doc) => processDocument(doc)));
  // Re-aggregate after all are done
  await reaggregate();
}

export async function reaggregate(): Promise<void> {
  const state = store.getState();
  const completedExtractions = state.extractions.filter((e) =>
    state.documents.find((d) => d.id === e.documentId && d.status === "completed")
  );
  const completedDocs = state.documents.filter((d) => d.status === "completed");

  const { loan, borrowers, incomeRecords, accounts } = assembleFromExtractions(
    completedExtractions,
    completedDocs
  );

  const allExtractedFields = completedExtractions.flatMap((e) => e.fields);

  const validationFindings = runValidation(
    completedExtractions,
    borrowers,
    incomeRecords,
    completedDocs
  );

  store.setAggregated({
    loan,
    borrowers,
    incomeRecords,
    accounts,
    extractedFields: allExtractedFields,
    validationFindings,
  });

  store.persist();

  // Emit full state update
  const newState = store.getState();
  emitter.emitStateUpdate({
    loan: newState.loan,
    borrowers: newState.borrowers,
    incomeRecords: newState.incomeRecords,
    accounts: newState.accounts,
    documents: newState.documents,
    validationFindings: newState.validationFindings,
    extractedFields: newState.extractedFields,
  });
}

export async function deleteDocumentAndReaggregate(documentId: string): Promise<void> {
  const doc = store.getDocument(documentId);
  if (!doc) return;

  // Delete file
  try {
    if (fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
    if (doc.rawTextPath && fs.existsSync(doc.rawTextPath)) fs.unlinkSync(doc.rawTextPath);
  } catch (e) {
    console.error("Error deleting files:", e);
  }

  store.deleteDocument(documentId);
  emitter.emit({ type: "document:deleted", documentId });

  await reaggregate();
}
