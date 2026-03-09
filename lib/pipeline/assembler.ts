import type {
  Loan,
  Borrower,
  IncomeRecord,
  Account,
  DocumentExtraction,
  LoanDocument,
  SourceReference,
  Address,
  DocumentType,
} from "../types";
import { v4 as uuidv4 } from "uuid";

function findFieldRef(
  extraction: DocumentExtraction,
  ...keywords: string[]
): { page?: number; quote?: string } | undefined {
  const lower = keywords.map((k) => k.toLowerCase());
  const f = extraction.fields.find((f) =>
    lower.some((k) => f.fieldName.toLowerCase().includes(k))
  );
  if (!f) return undefined;
  return { page: f.pageNumber, quote: f.exactQuote };
}

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
    const docName = doc.displayName || extraction.documentTitle || doc.originalName;

    const makeSourceRef = (page?: number, quote?: string): SourceReference => ({
      documentId: extraction.documentId,
      documentName: docName,
      pageNumber: page ?? 1,
      exactQuote: quote ?? "",
    });

    const setFieldSource = (b: Borrower, field: string, ...keywords: string[]) => {
      if (!b.fieldSources) b.fieldSources = {};
      if (b.fieldSources[field]) return; // first-write-wins
      const ref = findFieldRef(extraction, ...keywords);
      b.fieldSources[field] = makeSourceRef(ref?.page, ref?.quote);
    };

    // ---- Primary borrower ----
    if (extraction.primaryBorrowerName) {
      const b = findOrCreateBorrower(borrowers, extraction.primaryBorrowerName, "primary");
      b.fullName = b.fullName || extraction.primaryBorrowerName;
      if (!b.ssn && extraction.primaryBorrowerSSN) {
        b.ssn = maskSSN(extraction.primaryBorrowerSSN);
        setFieldSource(b, "ssn", "ssn", "social security");
      }
      if (extraction.primaryBorrowerSSN && !b.ssnRaw) b.ssnRaw = extraction.primaryBorrowerSSN;
      if (!b.dateOfBirth && extraction.primaryBorrowerDOB) { b.dateOfBirth = extraction.primaryBorrowerDOB; setFieldSource(b, "dateOfBirth", "date of birth", "dob", "birth"); }
      if (!b.phone && extraction.primaryBorrowerPhone) { b.phone = extraction.primaryBorrowerPhone; setFieldSource(b, "phone", "phone"); }
      if (!b.email && extraction.primaryBorrowerEmail) { b.email = extraction.primaryBorrowerEmail; setFieldSource(b, "email", "email"); }
      if (!b.currentAddress && extraction.primaryBorrowerAddress) { b.currentAddress = parseAddress(extraction.primaryBorrowerAddress); setFieldSource(b, "currentAddress", "address"); }
      if (!b.employer && extraction.primaryBorrowerEmployer) { b.employer = extraction.primaryBorrowerEmployer; setFieldSource(b, "employer", "employer"); }
      if (!b.jobTitle && extraction.primaryBorrowerJobTitle) { b.jobTitle = extraction.primaryBorrowerJobTitle; setFieldSource(b, "jobTitle", "job title", "position", "occupation"); }
      if (!b.hireDate && extraction.primaryBorrowerHireDate) { b.hireDate = extraction.primaryBorrowerHireDate; setFieldSource(b, "hireDate", "hire date", "start date"); }
      if (b.annualSalary == null && extraction.primaryBorrowerSalary != null) { b.annualSalary = extraction.primaryBorrowerSalary; setFieldSource(b, "annualSalary", "salary", "annual"); }
      if (!b.sources.some((s) => s.documentId === extraction.documentId)) {
        b.sources.push(makeSourceRef());
      }
    }

    // ---- Co-borrower ----
    if (extraction.coBorrowerName) {
      const b = findOrCreateBorrower(borrowers, extraction.coBorrowerName, "co-borrower");
      b.fullName = b.fullName || extraction.coBorrowerName;
      if (!b.ssn && extraction.coBorrowerSSN) {
        b.ssn = maskSSN(extraction.coBorrowerSSN);
        setFieldSource(b, "ssn", "ssn", "social security");
      }
      if (extraction.coBorrowerSSN && !b.ssnRaw) b.ssnRaw = extraction.coBorrowerSSN;
      if (!b.dateOfBirth && extraction.coBorrowerDOB) { b.dateOfBirth = extraction.coBorrowerDOB; setFieldSource(b, "dateOfBirth", "date of birth", "dob", "birth"); }
      if (!b.phone && extraction.coBorrowerPhone) { b.phone = extraction.coBorrowerPhone; setFieldSource(b, "phone", "phone"); }
      if (!b.email && extraction.coBorrowerEmail) { b.email = extraction.coBorrowerEmail; setFieldSource(b, "email", "email"); }
      if (!b.currentAddress && extraction.coBorrowerAddress) { b.currentAddress = parseAddress(extraction.coBorrowerAddress); setFieldSource(b, "currentAddress", "address"); }
      if (!b.employer && extraction.coBorrowerEmployer) { b.employer = extraction.coBorrowerEmployer; setFieldSource(b, "employer", "employer"); }
      if (!b.jobTitle && extraction.coBorrowerJobTitle) { b.jobTitle = extraction.coBorrowerJobTitle; setFieldSource(b, "jobTitle", "job title", "position", "occupation"); }
      if (!b.hireDate && extraction.coBorrowerHireDate) { b.hireDate = extraction.coBorrowerHireDate; setFieldSource(b, "hireDate", "hire date", "start date"); }
      if (b.annualSalary == null && extraction.coBorrowerSalary != null) { b.annualSalary = extraction.coBorrowerSalary; setFieldSource(b, "annualSalary", "salary", "annual"); }
      if (!b.sources.some((s) => s.documentId === extraction.documentId)) {
        b.sources.push(makeSourceRef());
      }
    }

    // ---- Income records (skip bank statements — they are asset docs, not income docs) ----
    if (extraction.documentType !== "bank_statement") {
    for (const ir of extraction.incomeRecords ?? []) {
      if (ir.amount == null) continue;

      // Infer isJoint for 1040 records Gemini didn't flag
      const isJoint = ir.isJoint || (
        extraction.documentType === "tax_return_1040" &&
        (/\bjoint\b/i.test(ir.description ?? "") || /\band\b/i.test(ir.borrowerName ?? ""))
      );

      // Joint 1040 records are not attributed to a single borrower
      const borrower = isJoint
        ? undefined
        : ir.borrowerName
          ? borrowers.find((b) => normalizeName(b.fullName)?.includes(normalizeName(ir.borrowerName!).split(" ")[0]))
          : borrowers[0];

      const effectiveBorrowerId = isJoint ? "joint" : (borrower?.id ?? "");

      // Avoid duplicates: same borrower + year + source + kind + description + amount + doc
      const isDuplicate = incomeRecords.some(
        (r) =>
          r.borrowerId === effectiveBorrowerId &&
          r.year === (ir.year ?? 0) &&
          r.source === (ir.source ?? "other_income") &&
          r.kind === ir.kind &&
          (r.description ?? "") === (ir.description ?? "") &&
          Math.abs((r.amount ?? 0) - (ir.amount ?? 0)) < 1 &&
          r.sourceDoc === extraction.documentId
      );
      if (!isDuplicate) {
        incomeRecords.push({
          id: uuidv4(),
          borrowerId: effectiveBorrowerId,
          borrowerName: isJoint ? "Joint" : (borrower?.fullName ?? ir.borrowerName),
          year: ir.year ?? 0,
          source: ir.source ?? "other_income",
          kind: ir.kind,
          period: ir.period,
          periodEndDate: ir.periodEndDate,
          isJoint,
          amount: ir.amount,
          description: ir.description,
          sourceDoc: extraction.documentId,
          sourceDocName: docName,
          sourceDocType: extraction.documentType,
          sourcePages: ir.pageNumber ? [ir.pageNumber] : [],
          exactQuote: ir.exactQuote,
        });
      }
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
    if (extraction.lenderName && !loan.lenderName &&
        (extraction.documentType === "closing_disclosure" || extraction.documentType === "underwriting_summary")) {
      loan.lenderName = extraction.lenderName;
    }
  }

  // ---- Second pass: override employment fields from EVOE (authoritative source) ----
  for (const extraction of extractions) {
    if (extraction.documentType !== "evoe") continue;
    const doc2 = docMap.get(extraction.documentId);
    if (!doc2) continue;
    const docName2 = doc2.displayName || extraction.documentTitle || doc2.originalName;
    const makeRef2 = (page?: number, quote?: string): SourceReference => ({
      documentId: extraction.documentId,
      documentName: docName2,
      pageNumber: page ?? 1,
      exactQuote: quote ?? "",
    });
    if (extraction.primaryBorrowerName && extraction.primaryBorrowerJobTitle) {
      const b = borrowers.find((b) => normalizeName(b.fullName) === normalizeName(extraction.primaryBorrowerName!));
      if (b) {
        b.jobTitle = extraction.primaryBorrowerJobTitle;
        if (!b.fieldSources) b.fieldSources = {};
        const ref = findFieldRef(extraction, "job title", "position", "occupation", "title");
        b.fieldSources["jobTitle"] = makeRef2(ref?.page, ref?.quote);
      }
    }
    if (extraction.coBorrowerName && extraction.coBorrowerJobTitle) {
      const b = borrowers.find((b) => normalizeName(b.fullName) === normalizeName(extraction.coBorrowerName!));
      if (b) {
        b.jobTitle = extraction.coBorrowerJobTitle;
        if (!b.fieldSources) b.fieldSources = {};
        const ref = findFieldRef(extraction, "job title", "position", "occupation", "title");
        b.fieldSources["jobTitle"] = makeRef2(ref?.page, ref?.quote);
      }
    }
  }

  // ---- Normalize income records (kind, period, annualizedAmount) ----
  const docTypeByDocId = new Map<string, DocumentType>(extractions.map((e) => [e.documentId, e.documentType]));
  for (const ir of incomeRecords) {
    const docType = docTypeByDocId.get(ir.sourceDoc);

    // A. Default inference from documentType when Gemini left these null
    if (!ir.kind) {
      if (docType === "w2") ir.kind = "doc_total";
      else if (docType === "underwriting_summary") ir.kind = "underwriting_total";
      else if (docType === "evoe") {
        ir.kind = /\btotal\b/i.test(ir.description ?? "") ? "doc_total" : "component";
      } else if (docType === "pay_stub") {
        ir.kind = /\b(gross pay|total gross)\b/i.test(ir.description ?? "") ? "doc_total" : "component";
      } else if (docType === "tax_return_1040" || docType === "schedule_c") {
        ir.kind = "doc_total";
      }
    }
    if (!ir.period) {
      if (docType === "w2" || docType === "tax_return_1040" || docType === "schedule_c") ir.period = "annual";
      else if (docType === "pay_stub") ir.period = "ytd";
      else if (docType === "underwriting_summary") ir.period = "monthly";
      // EVOE: leave period as-is so Gemini's "ytd" flows to the annualization logic below
    }

    // B. Compute annualizedAmount
    if (ir.period === "annual") {
      ir.annualizedAmount = ir.amount;
    } else if (ir.period === "monthly") {
      ir.annualizedAmount = ir.amount * 12;
    } else if (ir.period === "ytd" && ir.periodEndDate) {
      const endDate = new Date(ir.periodEndDate);
      const startOfYear = new Date(endDate.getFullYear(), 0, 1);
      const msElapsed = endDate.getTime() - startOfYear.getTime();
      const daysElapsed = Math.ceil(msElapsed / (1000 * 60 * 60 * 24)) + 1;
      if (daysElapsed > 0) {
        ir.annualizedAmount = (ir.amount / daysElapsed) * 365;
      }
    }
  }

  // ---- Heuristic: annualize EVOE partial-year records missing periodEndDate ----
  // If the latest year's amount is < 85% of the prior year's annualized amount,
  // the record is almost certainly a YTD partial year. Annualize by ratio.
  const evoeByGroupKey = new Map<string, IncomeRecord[]>();
  for (const ir of incomeRecords) {
    if (docTypeByDocId.get(ir.sourceDoc) !== "evoe") continue;
    const key = `${ir.borrowerId}|${ir.source}|${ir.kind}`;
    if (!evoeByGroupKey.has(key)) evoeByGroupKey.set(key, []);
    evoeByGroupKey.get(key)!.push(ir);
  }
  for (const [, group] of evoeByGroupKey) {
    group.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    const latest = group[0];
    const prior = group[1];
    if (!latest || !prior) continue;
    if (latest.annualizedAmount != null) continue; // already annualized
    const priorAnnualized = prior.annualizedAmount ?? prior.amount ?? 0;
    if (!priorAnnualized) continue;
    const latestAmount = latest.amount ?? 0;
    if (latestAmount > 0 && latestAmount < priorAnnualized * 0.85) {
      // Partial year: annualize by the fraction elapsed (amount / prior_annual)
      const fractionElapsed = latestAmount / priorAnnualized;
      latest.period = "ytd";
      latest.annualizedAmount = latestAmount / fractionElapsed;
    }
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
