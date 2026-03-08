import type {
  Borrower,
  DocumentExtraction,
  LoanDocument,
  ValidationFinding,
  IncomeRecord,
} from "../types";
import { v4 as uuidv4 } from "uuid";

export function runValidation(
  extractions: DocumentExtraction[],
  borrowers: Borrower[],
  incomeRecords: IncomeRecord[],
  documents: LoanDocument[]
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const docMap = new Map(documents.map((d) => [d.id, d]));

  // ---- SSN consistency checks ----
  // For each borrower, collect all SSNs seen across documents
  for (const borrower of borrowers) {
    const ssnSightings: Array<{ ssn: string; docId: string; docName: string }> = [];

    for (const extraction of extractions) {
      const docName = docMap.get(extraction.documentId)?.originalName ?? extraction.documentId;

      // Check primary
      if (extraction.primaryBorrowerSSN && extraction.primaryBorrowerName) {
        const nameLower = (extraction.primaryBorrowerName ?? "").toLowerCase();
        const borrowerLower = (borrower.fullName ?? "").toLowerCase();
        if (borrowerLower.includes(nameLower.split(" ")[0]) || nameLower.includes(borrowerLower.split(" ")[0])) {
          ssnSightings.push({
            ssn: normalize(extraction.primaryBorrowerSSN),
            docId: extraction.documentId,
            docName,
          });
        }
      }
      // Check co-borrower
      if (extraction.coBorrowerSSN && extraction.coBorrowerName) {
        const nameLower = (extraction.coBorrowerName ?? "").toLowerCase();
        const borrowerLower = (borrower.fullName ?? "").toLowerCase();
        if (borrowerLower.includes(nameLower.split(" ")[0]) || nameLower.includes(borrowerLower.split(" ")[0])) {
          ssnSightings.push({
            ssn: normalize(extraction.coBorrowerSSN),
            docId: extraction.documentId,
            docName,
          });
        }
      }
    }

    // Check for mismatches
    const uniqueSSNs = Array.from(new Set(ssnSightings.map((s) => s.ssn)));
    if (uniqueSSNs.length > 1) {
      // SSN mismatch!
      for (let i = 0; i < ssnSightings.length - 1; i++) {
        for (let j = i + 1; j < ssnSightings.length; j++) {
          if (ssnSightings[i].ssn !== ssnSightings[j].ssn) {
            findings.push({
              id: uuidv4(),
              severity: "error",
              category: "ssn_mismatch",
              message: `SSN mismatch for ${borrower.fullName}: different values found in different documents`,
              field1Doc: ssnSightings[i].docId,
              field1DocName: ssnSightings[i].docName,
              field1Value: maskSSN(ssnSightings[i].ssn),
              field2Doc: ssnSightings[j].docId,
              field2DocName: ssnSightings[j].docName,
              field2Value: maskSSN(ssnSightings[j].ssn),
            });
          }
        }
      }
    }
  }

  // ---- Income consistency checks ----
  // For each borrower+year, check if income values are very different across docs
  const incomeByBorrowerYear = new Map<string, IncomeRecord[]>();
  for (const r of incomeRecords) {
    const key = `${r.borrowerId}-${r.year}-${r.source}`;
    if (!incomeByBorrowerYear.has(key)) incomeByBorrowerYear.set(key, []);
    incomeByBorrowerYear.get(key)!.push(r);
  }

  for (const [, records] of Array.from(incomeByBorrowerYear.entries())) {
    if (records.length < 2) continue;
    const amounts = records.map((r: IncomeRecord) => r.amount);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    // Flag if discrepancy > 10%
    if (min > 0 && (max - min) / min > 0.1) {
      findings.push({
        id: uuidv4(),
        severity: "warning",
        category: "income_discrepancy",
        message: `Income discrepancy for ${records[0].borrowerName ?? "borrower"} (${records[0].source}, ${records[0].year}): values differ by ${Math.round(((max - min) / min) * 100)}%`,
        field1Doc: records[0].sourceDoc,
        field1DocName: records[0].sourceDocName,
        field1Value: `$${records[0].amount.toLocaleString()}`,
        field2Doc: records[records.length - 1].sourceDoc,
        field2DocName: records[records.length - 1].sourceDocName,
        field2Value: `$${records[records.length - 1].amount.toLocaleString()}`,
      });
    }
  }

  // ---- Entity mismatch: Title Report different party ----
  const titleExtractions = extractions.filter((e) => e.documentType === "title_report");
  for (const titleExt of titleExtractions) {
    const titleBorrowerName = titleExt.primaryBorrowerName ?? titleExt.coBorrowerName;
    if (!titleBorrowerName) continue;

    // Check if title report parties match the known borrowers
    const knownBorrowerNames = borrowers.map((b) => normalizeName(b.fullName));
    const titleNameNorm = normalizeName(titleBorrowerName);
    const matches = knownBorrowerNames.some(
      (n) => n.includes(titleNameNorm.split(" ")[0]) || titleNameNorm.includes(n.split(" ")[0])
    );

    if (!matches) {
      findings.push({
        id: uuidv4(),
        severity: "warning",
        category: "entity_mismatch",
        message: `Title Report references "${titleBorrowerName}" — this party does not match the loan borrowers. This document may belong to a different transaction.`,
        field1Doc: titleExt.documentId,
        field1DocName: docMap.get(titleExt.documentId)?.originalName ?? titleExt.documentId,
        field1Value: titleBorrowerName,
        field2Value: borrowers.map((b) => b.fullName).join(", "),
      });
    }
  }

  return findings;
}

function normalize(ssn: string): string {
  return ssn.replace(/\D/g, "");
}

function maskSSN(ssn: string): string {
  if (ssn.length >= 4) return `XXX-XX-${ssn.slice(-4)}`;
  return ssn;
}

function normalizeName(name?: string): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
