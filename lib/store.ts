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
    if (!fs.existsSync(path.join(DATA_DIR, "raw-text"))) fs.mkdirSync(path.join(DATA_DIR, "raw-text"), { recursive: true });
    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        this.state = JSON.parse(raw);
        console.log(`[Store] Loaded state from disk: ${this.state.documents.length} docs`);
      } catch {
        this.state = emptyState();
      }
    }
  }

  persist() {
    this.state.lastUpdated = new Date().toISOString();
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
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
    if (idx >= 0) this.state.documents[idx] = doc;
    else this.state.documents.push(doc);
  }

  deleteDocument(id: string) {
    this.init();
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
    this.state.loan = data.loan;
    this.state.borrowers = data.borrowers;
    this.state.incomeRecords = data.incomeRecords;
    this.state.accounts = data.accounts;
    this.state.extractedFields = data.extractedFields;
    this.state.validationFindings = data.validationFindings;
  }
}

// Singleton
const store = new Store();
export default store;
