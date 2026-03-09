import fs from "fs";
import type { LoanDocument } from "../types";
import store from "../store";
import emitter from "../events";
import { extractFromDocument } from "../ai/extract";
import { assembleFromExtractions } from "./assembler";
import { runValidation } from "./validator";
import { formatErrorMessage, buildDisplayName } from "../utils";

function updateDocStatus(doc: LoanDocument, updates: Partial<LoanDocument>) {
  const updated = { ...doc, ...updates };
  store.upsertDocument(updated);
  return updated;
}

export async function processDocument(doc: LoanDocument): Promise<void> {
  let current = doc;

  try {
    // 1. Extract (send PDF directly to Gemini)
    current = updateDocStatus(current, { status: "extracting" });
    emitter.emit({ type: "document:extracting", documentId: doc.id, message: "Extracting with Gemini..." });
    emitter.emitStateUpdate({ documents: store.getDocuments() }, doc.id);

    const extraction = await extractFromDocument(doc.id, doc.originalName, doc.filePath);

    // Update doc type, page count, and display name from extraction
    const displayName = buildDisplayName(extraction.documentType, {
      documentYears: extraction.documentYears,
      primaryBorrowerName: extraction.primaryBorrowerName,
      coBorrowerName: extraction.coBorrowerName,
      documentTitle: extraction.documentTitle,
    });
    current = updateDocStatus(current, {
      status: "extracted",
      documentType: extraction.documentType,
      pageCount: extraction.pageCount ?? current.pageCount,
      displayName,
    });
    store.upsertExtraction(extraction);
    emitter.emit({ type: "document:extracted", documentId: doc.id, message: `Extracted ${extraction.fields.length} fields` });
    emitter.emitStateUpdate({ documents: store.getDocuments() }, doc.id);

    // 2. Mark complete
    current = updateDocStatus(current, {
      status: "completed",
      processedAt: new Date().toISOString(),
    });
    emitter.emit({ type: "document:completed", documentId: doc.id });
    emitter.emitStateUpdate({ documents: store.getDocuments() }, doc.id);
  } catch (err) {
    const errorMessage = formatErrorMessage(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(
      `[orchestrator] processDocument failed for ${doc.originalName} (id=${doc.id}):`,
      errorMessage,
      stack ?? ""
    );
    updateDocStatus(current, { status: "error", errorMessage });
    emitter.emit({ type: "document:error", documentId: doc.id, message: errorMessage });
    emitter.emitStateUpdate({ documents: store.getDocuments() }, doc.id);
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

  // Back-fill displayName for documents processed before this feature was added
  for (const doc of completedDocs) {
    if (!doc.displayName) {
      const extraction = completedExtractions.find((e) => e.documentId === doc.id);
      if (extraction) {
        const displayName = buildDisplayName(extraction.documentType, {
          documentYears: extraction.documentYears,
          primaryBorrowerName: extraction.primaryBorrowerName,
          coBorrowerName: extraction.coBorrowerName,
          documentTitle: extraction.documentTitle,
        });
        store.upsertDocument({ ...doc, displayName });
      }
    }
  }

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
  } catch (e) {
    console.error("Error deleting files:", e);
  }

  store.deleteDocument(documentId);
  emitter.emit({ type: "document:deleted", documentId });

  await reaggregate();
}
