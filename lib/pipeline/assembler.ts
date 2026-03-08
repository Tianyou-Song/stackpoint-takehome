import type {
  Loan,
  Borrower,
  IncomeRecord,
  Account,
  DocumentExtraction,
  LoanDocument,
  SourceReference,
  Address,
} from "../types";
import { v4 as uuidv4 } from "uuid";

function parseAddress(raw?: string): Address | undefined {
  if (!raw) return undefined;
  return { full: raw };
}

function normalizeName(name?: string): string {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function findOrCreateBorrower(
  borrowers: Borrower[],
  name: string,
  role: Borrower["role"]
): Borrower {
  const norm = normalizeName(name);
  const existing = borrowers.find(
    (b) => normalizeName(b.fullName) === norm || normalizeName(b.fullName)?.includes(norm.split(" ")[0])
  );
  if (existing) return existing;
  const newBorrower: Borrower = {
    id: uuidv4(),
    role,
    fullName: name,
    sources: [],
  };
  borrowers.push(newBorrower);
  return newBorrower;
}

export function assembleFromExtractions(
  extractions: DocumentExtraction[],
  documents: LoanDocument[]
): {
  loan: Loan;
  borrowers: Borrower[];
  incomeRecords: IncomeRecord[];
  accounts: Account[];
} {
  const loan: Loan = { sources: [] };
  const borrowers: Borrower[] = [];
  const incomeRecords: IncomeRecord[] = [];
  const accounts: Account[] = [];

  const docMap = new Map(documents.map((d) => [d.id, d]));

  for (const extraction of extractions) {
    const doc = docMap.get(extraction.documentId);
    if (!doc) continue;
    const docName = doc.originalName;

    const makeSourceRef = (page?: number, quote?: string): SourceReference => ({
      documentId: extraction.documentId,
      documentName: docName,
      pageNumber: page ?? 1,
      exactQuote: quote ?? "",
    });

    // ---- Primary borrower ----
    if (extraction.primaryBorrowerName) {
      const b = findOrCreateBorrower(borrowers, extraction.primaryBorrowerName, "primary");
      b.fullName = b.fullName || extraction.primaryBorrowerName;
      b.ssn = b.ssn || (extraction.primaryBorrowerSSN ? maskSSN(extraction.primaryBorrowerSSN) : undefined);
      if (extraction.primaryBorrowerSSN && !b.ssnRaw) b.ssnRaw = extraction.primaryBorrowerSSN;
      b.dateOfBirth = b.dateOfBirth || extraction.primaryBorrowerDOB;
      b.phone = b.phone || extraction.primaryBorrowerPhone;
      b.email = b.email || extraction.primaryBorrowerEmail;
      b.currentAddress = b.currentAddress || parseAddress(extraction.primaryBorrowerAddress);
      b.employer = b.employer || extraction.primaryBorrowerEmployer;
      b.jobTitle = b.jobTitle || extraction.primaryBorrowerJobTitle;
      b.hireDate = b.hireDate || extraction.primaryBorrowerHireDate;
      b.annualSalary = b.annualSalary ?? extraction.primaryBorrowerSalary;
      if (!b.sources.some((s) => s.documentId === extraction.documentId)) {
        b.sources.push(makeSourceRef());
      }
    }

    // ---- Co-borrower ----
    if (extraction.coBorrowerName) {
      const b = findOrCreateBorrower(borrowers, extraction.coBorrowerName, "co-borrower");
      b.fullName = b.fullName || extraction.coBorrowerName;
      b.ssn = b.ssn || (extraction.coBorrowerSSN ? maskSSN(extraction.coBorrowerSSN) : undefined);
      if (extraction.coBorrowerSSN && !b.ssnRaw) b.ssnRaw = extraction.coBorrowerSSN;
      b.dateOfBirth = b.dateOfBirth || extraction.coBorrowerDOB;
      b.phone = b.phone || extraction.coBorrowerPhone;
      b.email = b.email || extraction.coBorrowerEmail;
      b.currentAddress = b.currentAddress || parseAddress(extraction.coBorrowerAddress);
      b.employer = b.employer || extraction.coBorrowerEmployer;
      b.jobTitle = b.jobTitle || extraction.coBorrowerJobTitle;
      b.hireDate = b.hireDate || extraction.coBorrowerHireDate;
      b.annualSalary = b.annualSalary ?? extraction.coBorrowerSalary;
      if (!b.sources.some((s) => s.documentId === extraction.documentId)) {
        b.sources.push(makeSourceRef());
      }
    }

    // ---- Income records ----
    for (const ir of extraction.incomeRecords ?? []) {
      if (ir.amount == null) continue;
      // Find borrower for this income record
      const borrower = ir.borrowerName
        ? borrowers.find((b) => normalizeName(b.fullName)?.includes(normalizeName(ir.borrowerName).split(" ")[0]))
        : borrowers[0];

      // Avoid duplicates: same borrower + year + source + amount + doc
      const isDuplicate = incomeRecords.some(
        (r) =>
          r.borrowerId === (borrower?.id ?? "") &&
          r.year === (ir.year ?? 0) &&
          r.source === ir.source &&
          Math.abs((r.amount ?? 0) - (ir.amount ?? 0)) < 1 &&
          r.sourceDoc === extraction.documentId
      );
      if (!isDuplicate) {
        incomeRecords.push({
          id: uuidv4(),
          borrowerId: borrower?.id ?? "",
          borrowerName: borrower?.fullName ?? ir.borrowerName,
          year: ir.year ?? 0,
          source: ir.source ?? "other",
          amount: ir.amount,
          description: ir.description,
          sourceDoc: extraction.documentId,
          sourceDocName: docName,
          sourcePages: ir.pageNumber ? [ir.pageNumber] : [],
          exactQuote: ir.exactQuote,
        });
      }
    }

    // ---- Accounts ----
    for (const acct of extraction.accounts ?? []) {
      const borrower = acct.borrowerName
        ? borrowers.find((b) => normalizeName(b.fullName)?.includes(normalizeName(acct.borrowerName ?? "").split(" ")[0]))
        : borrowers[0];

      // Avoid duplicates by account number + doc
      const isDuplicate = accounts.some(
        (a) =>
          a.sourceDoc === extraction.documentId &&
          a.accountNumberMasked === acct.accountNumberMasked &&
          a.institution === acct.institution
      );
      if (!isDuplicate) {
        accounts.push({
          id: uuidv4(),
          borrowerId: borrower?.id,
          borrowerName: borrower?.fullName ?? acct.borrowerName,
          institution: acct.institution,
          accountType: acct.accountType ?? "other",
          accountNumberMasked: acct.accountNumberMasked,
          balance: acct.balance,
          balanceDate: acct.balanceDate,
          sourceDoc: extraction.documentId,
          sourceDocName: docName,
        });
      }
    }

    // ---- Loan ----
    if (extraction.loanNumber && !loan.loanNumber) {
      loan.loanNumber = extraction.loanNumber;
      loan.sources.push(makeSourceRef());
    }
    if (extraction.loanAmount && !loan.loanAmount) loan.loanAmount = extraction.loanAmount;
    if (extraction.interestRate && !loan.interestRate) loan.interestRate = extraction.interestRate;
    if (extraction.loanTerm && !loan.loanTerm) loan.loanTerm = extraction.loanTerm;
    if (extraction.loanType && !loan.loanType) loan.loanType = extraction.loanType;
    if (extraction.loanPurpose && !loan.loanPurpose) loan.loanPurpose = extraction.loanPurpose;
    if (extraction.propertyAddress && !loan.propertyAddress) {
      loan.propertyAddress = parseAddress(extraction.propertyAddress);
    }
    if (extraction.salePrice && !loan.salePrice) loan.salePrice = extraction.salePrice;
    if (extraction.closingDate && !loan.closingDate) loan.closingDate = extraction.closingDate;
    if (extraction.lenderName && !loan.lenderName) loan.lenderName = extraction.lenderName;
  }

  return { loan, borrowers, incomeRecords, accounts };
}

function maskSSN(ssn: string): string {
  // Keep last 4 digits: XXX-XX-1234
  const digits = ssn.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `XXX-XX-${digits.slice(-4)}`;
  }
  return ssn;
}
