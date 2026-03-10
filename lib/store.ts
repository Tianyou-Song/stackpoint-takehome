import fs from "fs";
import path from "path";
import type {
  SystemState,
  LoanDocument,
  Borrower,
  IncomeRecord,
  Account,
  Loan,
  ExtractedField,
  ValidationFinding,
  DocumentExtraction,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "extraction-results.json");

function emptyState(): SystemState {
  return {
    loan: { sources: [] },
    borrowers: [],
    incomeRecords: [],
    accounts: [],
    documents: [],
    extractions: [],
    extractedFields: [],
    validationFindings: [],
    lastUpdated: new Date().toISOString(),
  };
}

class Store {
  private state: SystemState = emptyState();
  private initialized = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(path.join(DATA_DIR, "uploads"))) fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });
    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        this.state = JSON.parse(raw);
        console.log(`[Store] Loaded state from disk: ${this.state.documents.length} docs`);
        // Migrate: reset any stale parsing/parsed status from old pipeline
        for (const doc of this.state.documents) {
          if ((doc.status as string) === "parsing" || (doc.status as string) === "parsed" || doc.status === "extracting") {
            doc.status = "pending";
          }
          delete (doc as unknown as Record<string, unknown>).rawTextPath;
        }
      } catch {
        this.state = emptyState();
      }
    }
  }

  persist() {
    this.state.lastUpdated = new Date().toISOString();
    try {
      const json = JSON.stringify(this.state, null, 2);
      fs.writeFileSync(STATE_FILE, json);
      console.log(`[store] persisted state (${this.state.documents.length} docs, ${json.length} bytes)`);
    } catch (e) {
      console.error("Failed to persist state:", e);
    }
  }

  getState(): SystemState {
    this.init();
    return this.state;
  }

  // Documents
  getDocuments(): LoanDocument[] {
    this.init();
    return this.state.documents;
  }

  getDocument(id: string): LoanDocument | undefined {
    this.init();
    return this.state.documents.find((d) => d.id === id);
  }

  upsertDocument(doc: LoanDocument) {
    this.init();
    const idx = this.state.documents.findIndex((d) => d.id === doc.id);
    if (idx >= 0) {
      this.state.documents[idx] = doc;
    } else {
      this.state.documents.push(doc);
    }
  }

  deleteDocument(id: string) {
    this.init();
    const deletedExtractions = this.state.extractions.filter((e) => e.documentId === id).length;
    const deletedFields = this.state.extractedFields.filter((f) => f.documentId === id).length;
    console.log(`[store] delete: ${id} — removing doc + ${deletedExtractions} extractions, ${deletedFields} fields`);
    this.state.documents = this.state.documents.filter((d) => d.id !== id);
    this.state.extractions = this.state.extractions.filter((e) => e.documentId !== id);
    this.state.extractedFields = this.state.extractedFields.filter((f) => f.documentId !== id);
  }

  // Extractions
  getExtraction(documentId: string): DocumentExtraction | undefined {
    this.init();
    return this.state.extractions.find((e) => e.documentId === documentId);
  }

  upsertExtraction(extraction: DocumentExtraction) {
    this.init();
    const idx = this.state.extractions.findIndex((e) => e.documentId === extraction.documentId);
    if (idx >= 0) this.state.extractions[idx] = extraction;
    else this.state.extractions.push(extraction);
  }

  // Aggregated data (set by assembler)
  setAggregated(data: {
    loan: Loan;
    borrowers: Borrower[];
    incomeRecords: IncomeRecord[];
    accounts: Account[];
    extractedFields: ExtractedField[];
    validationFindings: ValidationFinding[];
  }) {
    this.init();
    console.log(`[store] setAggregated: loan=${!!data.loan}, borrowers=${data.borrowers.length}, income=${data.incomeRecords.length}, accounts=${data.accounts.length}, findings=${data.validationFindings.length}`);
    this.state.loan = data.loan;
    this.state.borrowers = data.borrowers;
    this.state.incomeRecords = data.incomeRecords;
    this.state.accounts = data.accounts;
    this.state.extractedFields = data.extractedFields;
    this.state.validationFindings = data.validationFindings;
  }
}

declare global {
  var _store: Store | undefined;
}

if (!globalThis._store) {
  console.log("[store] Creating new Store singleton");
  globalThis._store = new Store();
}

const store = globalThis._store;
export default store;
