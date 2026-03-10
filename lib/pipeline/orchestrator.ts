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
  if (updates.status) {
    console.log(`[orchestrator] Status: ${doc.originalName} → ${updates.status}`);
  }
  return updated;
}

export async function processDocument(doc: LoanDocument): Promise<void> {
  let current = doc;
  const t0 = Date.now();
  console.log(`[orchestrator] processDocument START: ${doc.originalName} (id=${doc.id})`);

  try {
    // 1. Extract (send PDF directly to Gemini)
    current = updateDocStatus(current, { status: "extracting" });
    emitter.emit({ type: "document:extracting", documentId: doc.id, message: "Extracting..." });
    emitter.emitStateUpdate({ documents: store.getDocuments() }, doc.id);

    console.log(`[orchestrator] → extractFromDocument START: ${doc.originalName} at +${Date.now() - t0}ms`);
    const extraction = await extractFromDocument(doc.id, doc.originalName, doc.filePath);
    console.log(`[orchestrator] ← extractFromDocument DONE: ${doc.originalName} in ${Date.now() - t0}ms`);

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
    console.log(`[orchestrator] processDocument DONE: ${doc.originalName} total=${Date.now() - t0}ms`);
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
  console.log(`[orchestrator] processBatch START: [${docs.map((d) => d.originalName).join(", ")}]`);
  // Process all docs in parallel
  await Promise.allSettled(docs.map((doc) => processDocument(doc)));
  console.log(`[orchestrator] processBatch DONE`);
  // Re-aggregate after all are done
  await reaggregate();
}

export async function reaggregate(): Promise<void> {
  const t0 = Date.now();
  const state = store.getState();
  const completedExtractions = state.extractions.filter((e) =>
    state.documents.find((d) => d.id === e.documentId && d.status === "completed")
  );
  const completedDocs = state.documents.filter((d) => d.status === "completed");
  console.log(`[orchestrator] reaggregate START (${completedExtractions.length} completed extractions)`);

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

  console.log(`[orchestrator] reaggregate → assembleFromExtractions`);
  const { loan, borrowers, incomeRecords, accounts } = assembleFromExtractions(
    completedExtractions,
    completedDocs
  );

  const allExtractedFields = completedExtractions.flatMap((e) => e.fields);

  console.log(`[orchestrator] reaggregate → runValidation (${loan ? "loan present" : "no loan"}, ${borrowers.length} borrowers)`);
  const validationFindings = runValidation(
    completedExtractions,
    borrowers,
    incomeRecords,
    completedDocs
  );

  console.log(`[orchestrator] reaggregate → setAggregated (${validationFindings.length} validation findings)`);
  store.setAggregated({
    loan,
    borrowers,
    incomeRecords,
    accounts,
    extractedFields: allExtractedFields,
    validationFindings,
  });

  console.log(`[orchestrator] reaggregate → persist`);
  store.persist();

  // Emit full state update
  console.log(`[orchestrator] reaggregate → emitStateUpdate`);
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
  console.log(`[orchestrator] reaggregate DONE in ${Date.now() - t0}ms`);
}

export async function deleteDocumentAndReaggregate(documentId: string): Promise<void> {
  const t0 = Date.now();
  const doc = store.getDocument(documentId);
  if (!doc) return;
  console.log(`[orchestrator] deleteDocument START: ${documentId} (${doc.originalName})`);

  // Delete file
  try {
    if (fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
  } catch (e) {
    console.error("Error deleting files:", e);
  }

  console.log(`[orchestrator] deleteDocument → store.deleteDocument`);
  store.deleteDocument(documentId);
  emitter.emit({ type: "document:deleted", documentId });

  console.log(`[orchestrator] deleteDocument → reaggregate`);
  await reaggregate();
  console.log(`[orchestrator] deleteDocument DONE in ${Date.now() - t0}ms`);
}
