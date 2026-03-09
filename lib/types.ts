// ============================================================
// Core domain types for the Loan Document Extraction System
// ============================================================

export type DocumentStatus = "pending" | "extracting" | "extracted" | "completed" | "error";
export type DocumentType =
  | "tax_return_1040"
  | "w2"
  | "bank_statement"
  | "pay_stub"
  | "closing_disclosure"
  | "underwriting_summary"
  | "title_report"
  | "evoe"
  | "schedule_c"
  | "other"
  | "unknown";
export type BorrowerRole = "primary" | "co-borrower";
export type IncomeSource =
  | "base_salary"
  | "overtime"
  | "commission"
  | "bonus"
  | "self_employment"
  | "rental"
  | "other_income";
export type IncomeRecordKind = "component" | "doc_total" | "underwriting_total";
export type IncomePeriod = "annual" | "ytd" | "monthly";
export type IncomeTrend = "increasing" | "stable" | "declining" | "insufficient_data";
export type AccountType = "checking" | "savings" | "investment" | "other";
export type ValidationSeverity = "error" | "warning" | "info";

// Source reference: where an extracted value came from
export interface SourceReference {
  documentId: string;
  documentName: string;
  pageNumber: number;
  exactQuote: string;
}

// An uploaded and processed PDF document
export interface LoanDocument {
  id: string;
  fileName: string;
  originalName: string;
  displayName?: string; // canonical display name (built deterministically from type + years + borrowers)
  documentType: DocumentType;
  pageCount: number;
  status: DocumentStatus;
  errorMessage?: string;
  uploadedAt: string; // ISO timestamp
  processedAt?: string;
  filePath: string; // absolute path to saved PDF
}

// A borrower (primary or co-borrower)
export interface Borrower {
  id: string;
  role: BorrowerRole;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  ssn?: string; // masked: XXX-XX-1234
  ssnRaw?: string; // actual SSN from documents (for validation)
  dateOfBirth?: string;
  phone?: string;
  email?: string;
  currentAddress?: Address;
  previousAddress?: Address;
  employer?: string;
  jobTitle?: string;
  hireDate?: string;
  annualSalary?: number;
  sources: SourceReference[]; // which docs confirmed this borrower exists
  fieldSources?: Record<string, SourceReference>; // per-field provenance
}

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  full?: string;
}

// Income record per year per source
export interface IncomeRecord {
  id: string;
  borrowerId: string;
  borrowerName?: string;
  year: number;
  source: IncomeSource;
  kind?: IncomeRecordKind;
  period?: IncomePeriod;
  periodEndDate?: string;
  isJoint?: boolean;
  annualizedAmount?: number;
  amount: number;
  description?: string;
  sourceDoc: string; // document ID
  sourceDocName: string;
  sourceDocType?: DocumentType;
  sourcePages: number[];
  exactQuote?: string;
}

// Bank / financial account
export interface Account {
  id: string;
  borrowerId?: string;
  borrowerName?: string;
  institution?: string;
  accountType: AccountType;
  accountNumberMasked?: string;
  balance?: number;
  balanceDate?: string;
  sourceDoc: string;
  sourceDocName: string;
}

// Loan details
export interface Loan {
  loanNumber?: string;
  loanAmount?: number;
  interestRate?: number;
  loanTerm?: number; // months
  loanType?: string; // conventional, FHA, VA, etc.
  loanPurpose?: string; // purchase, refinance
  propertyAddress?: Address;
  salePrice?: number;
  closingDate?: string;
  lenderName?: string;
  sources: SourceReference[];
}

// A single extracted field with provenance
export interface ExtractedField {
  id: string;
  documentId: string;
  fieldName: string;
  fieldValue: string;
  confidence: "high" | "medium" | "low";
  pageNumber?: number;
  exactQuote?: string;
  category: "borrower" | "loan" | "income" | "account" | "property" | "other";
}

// Cross-document validation finding
export interface ValidationFinding {
  id: string;
  severity: ValidationSeverity;
  category: "ssn_mismatch" | "income_discrepancy" | "entity_mismatch" | "address_mismatch" | "other";
  message: string;
  field1Doc?: string;
  field1DocName?: string;
  field1FileName?: string;
  field1Value?: string;
  field2Doc?: string;
  field2DocName?: string;
  field2FileName?: string;
  field2Value?: string;
}

// Raw LLM extraction output per document
export interface DocumentExtraction {
  documentId: string;
  documentType: DocumentType;
  pageCount?: number;
  documentTitle?: string;
  documentYears?: number[]; // tax/calendar years this document covers

  // Borrower fields
  primaryBorrowerName?: string;
  primaryBorrowerSSN?: string;
  primaryBorrowerDOB?: string;
  primaryBorrowerPhone?: string;
  primaryBorrowerEmail?: string;
  primaryBorrowerAddress?: string;
  primaryBorrowerEmployer?: string;
  primaryBorrowerJobTitle?: string;
  primaryBorrowerHireDate?: string;
  primaryBorrowerSalary?: number;

  coBorrowerName?: string;
  coBorrowerSSN?: string;
  coBorrowerDOB?: string;
  coBorrowerPhone?: string;
  coBorrowerEmail?: string;
  coBorrowerAddress?: string;
  coBorrowerEmployer?: string;
  coBorrowerJobTitle?: string;
  coBorrowerHireDate?: string;
  coBorrowerSalary?: number;

  // Income records
  incomeRecords?: ExtractedIncomeRecord[];

  // Accounts
  accounts?: ExtractedAccount[];

  // Loan fields
  loanNumber?: string;
  loanAmount?: number;
  interestRate?: number;
  loanTerm?: number;
  loanType?: string;
  loanPurpose?: string;
  propertyAddress?: string;
  salePrice?: number;
  closingDate?: string;
  lenderName?: string;

  // Raw fields with provenance
  fields: ExtractedField[];
}

export interface ExtractedIncomeRecord {
  borrowerName?: string;
  year?: number;
  source?: IncomeSource;
  kind?: IncomeRecordKind;
  period?: IncomePeriod;
  periodEndDate?: string;
  isJoint?: boolean;
  amount?: number;
  description?: string;
  pageNumber?: number;
  exactQuote?: string;
}

export interface ExtractedAccount {
  borrowerName?: string;
  institution?: string;
  accountType?: AccountType;
  accountNumberMasked?: string;
  balance?: number;
  balanceDate?: string;
  pageNumber?: number;
}

// Full system state (serialized to JSON)
export interface SystemState {
  loan: Loan;
  borrowers: Borrower[];
  incomeRecords: IncomeRecord[];
  accounts: Account[];
  documents: LoanDocument[];
  extractions: DocumentExtraction[];
  extractedFields: ExtractedField[];
  validationFindings: ValidationFinding[];
  lastUpdated: string;
}

// SSE event types
export type SSEEventType =
  | "document:pending"
  | "document:extracting"
  | "document:extracted"
  | "document:completed"
  | "document:error"
  | "document:deleted"
  | "state:updated"
  | "ping";

export interface SSEEvent {
  type: SSEEventType;
  documentId?: string;
  message?: string;
  data?: Partial<SystemState>;
}
