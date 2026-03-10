import type {
  Borrower,
  DocumentExtraction,
  DocumentType,
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
  console.log(`[validator] START: ${borrowers.length} borrowers, ${extractions.length} extractions`);
  const findings: ValidationFinding[] = [];
  const docMap = new Map(documents.map((d) => [d.id, d]));

  // ---- SSN consistency checks ----
  // For each borrower, collect all SSNs seen across documents
  for (const borrower of borrowers) {
    const ssnSightings: Array<{ ssn: string; docId: string; docName: string; fileName?: string }> = [];

    for (const extraction of extractions) {
      const d = docMap.get(extraction.documentId);
      const docName = d?.displayName ?? d?.originalName ?? extraction.documentId;

      // Check primary
      if (extraction.primaryBorrowerSSN && extraction.primaryBorrowerName) {
        const nameLower = (extraction.primaryBorrowerName ?? "").toLowerCase();
        const borrowerLower = (borrower.fullName ?? "").toLowerCase();
        if (borrowerLower.includes(nameLower.split(" ")[0]) || nameLower.includes(borrowerLower.split(" ")[0])) {
          console.log(`[validator] SSN sighting: ${borrower.fullName} = ${maskSSN(normalize(extraction.primaryBorrowerSSN))} (from ${extraction.documentType})`);
          ssnSightings.push({
            ssn: normalize(extraction.primaryBorrowerSSN),
            docId: extraction.documentId,
            docName,
            fileName: d?.originalName,
          });
        }
      }
      // Check co-borrower
      if (extraction.coBorrowerSSN && extraction.coBorrowerName) {
        const nameLower = (extraction.coBorrowerName ?? "").toLowerCase();
        const borrowerLower = (borrower.fullName ?? "").toLowerCase();
        if (borrowerLower.includes(nameLower.split(" ")[0]) || nameLower.includes(borrowerLower.split(" ")[0])) {
          console.log(`[validator] SSN sighting: ${borrower.fullName} = ${maskSSN(normalize(extraction.coBorrowerSSN))} (from ${extraction.documentType})`);
          ssnSightings.push({
            ssn: normalize(extraction.coBorrowerSSN),
            docId: extraction.documentId,
            docName,
            fileName: d?.originalName,
          });
        }
      }
    }

    // Check for mismatches — partial (redacted) SSNs are compatible if their digits are a suffix match
    for (let i = 0; i < ssnSightings.length - 1; i++) {
      for (let j = i + 1; j < ssnSightings.length; j++) {
        const a = ssnSightings[i];
        const b = ssnSightings[j];
        if (ssnCompatible(a.ssn, b.ssn)) continue;
        console.log(`[validator] SSN MISMATCH: ${borrower.fullName} — ${maskSSN(a.ssn)} vs ${maskSSN(b.ssn)}`);
        findings.push({
          id: uuidv4(),
          severity: "error",
          category: "ssn_mismatch",
          message: `SSN mismatch for ${borrower.fullName}: different values found in different documents`,
          field1Doc: a.docId,
          field1DocName: a.docName,
          field1FileName: a.fileName,
          field1Value: maskSSN(a.ssn),
          field2Doc: b.docId,
          field2DocName: b.docName,
          field2FileName: b.fileName,
          field2Value: maskSSN(b.ssn),
        });
      }
    }
  }

  // ---- Income consistency checks ----
  // Build a map from documentId → documentType for targeted comparisons
  const docTypeMap = new Map(extractions.map((e) => [e.documentId, e.documentType]));

  // Check 1: W-2 Box 1 vs EVOE Total (most meaningful cross-doc income check)
  // Only compare annual doc_total records from W-2s against EVOE doc_totals for the same borrower+year
  const w2TotalsByKey = new Map<string, IncomeRecord>();
  const evoeTotalsByKey = new Map<string, IncomeRecord>();
  for (const r of incomeRecords) {
    if (r.isJoint || !r.borrowerId || r.borrowerId === "joint") continue;
    if (r.kind !== "doc_total" || r.period !== "annual" || !r.year) continue;
    const dt = docTypeMap.get(r.sourceDoc);
    const key = `${r.borrowerId}-${r.year}`;
    if (dt === "w2" && !w2TotalsByKey.has(key)) w2TotalsByKey.set(key, r);
    if (dt === "evoe" && !evoeTotalsByKey.has(key)) evoeTotalsByKey.set(key, r);
  }
  for (const [key, w2r] of w2TotalsByKey) {
    const evoer = evoeTotalsByKey.get(key);
    if (!evoer) continue;
    const diff = Math.abs(w2r.amount - evoer.amount) / Math.min(w2r.amount, evoer.amount);
    const pct = Math.round(diff * 100);
    console.log(`[validator] Income check: ${w2r.borrowerName ?? "borrower"} W2=$${w2r.amount} EVOE=$${evoer.amount} diff=${pct}%`);
    if (diff > 0.10) {
      console.log(`[validator] Income DISCREPANCY: ${w2r.borrowerName ?? "borrower"} diff=${pct}% (threshold=10%)`);
      findings.push({
        id: uuidv4(),
        severity: "warning",
        category: "income_discrepancy",
        message: `W-2 Box 1 vs EVOE total for ${w2r.borrowerName ?? "borrower"} (${w2r.year}): ${Math.round(diff * 100)}% difference — W-2 excludes certain pre-tax deductions`,
        field1Doc: w2r.sourceDoc,
        field1DocName: w2r.sourceDocName,
        field1FileName: docMap.get(w2r.sourceDoc)?.originalName,
        field1Value: `$${w2r.amount.toLocaleString()} (W-2 Box 1)`,
        field2Doc: evoer.sourceDoc,
        field2DocName: evoer.sourceDocName,
        field2FileName: docMap.get(evoer.sourceDoc)?.originalName,
        field2Value: `$${evoer.amount.toLocaleString()} (EVOE total)`,
      });
    }
  }

  // Fallback: compare like-for-like annual doc_total records across different docs of the same type
  // (e.g., two W-2s from different employers for the same year — genuinely unexpected)
  const annualDocTotals = new Map<string, IncomeRecord[]>();
  for (const r of incomeRecords) {
    if (r.isJoint || r.borrowerId === "joint" || !r.borrowerId) continue;
    if (r.kind !== "doc_total" || r.period !== "annual" || !r.year) continue;
    const dt = docTypeMap.get(r.sourceDoc);
    const key = `${r.borrowerId}-${r.year}-${r.source}-${dt ?? ""}`;
    if (!annualDocTotals.has(key)) annualDocTotals.set(key, []);
    annualDocTotals.get(key)!.push(r);
  }
  for (const [, records] of annualDocTotals) {
    if (records.length < 2) continue;
    const uniqueDocs = new Set(records.map((r) => r.sourceDoc));
    if (uniqueDocs.size < 2) continue;
    const amounts = records.map((r) => r.amount);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    if (min > 0 && (max - min) / min > 0.1) {
      findings.push({
        id: uuidv4(),
        severity: "warning",
        category: "income_discrepancy",
        message: `Income discrepancy for ${records[0].borrowerName ?? "borrower"} (${records[0].source}, ${records[0].year}): values differ by ${Math.round(((max - min) / min) * 100)}%`,
        field1Doc: records[0].sourceDoc,
        field1DocName: records[0].sourceDocName,
        field1FileName: docMap.get(records[0].sourceDoc)?.originalName,
        field1Value: `$${records[0].amount.toLocaleString()}`,
        field2Doc: records[records.length - 1].sourceDoc,
        field2DocName: records[records.length - 1].sourceDocName,
        field2FileName: docMap.get(records[records.length - 1].sourceDoc)?.originalName,
        field2Value: `$${records[records.length - 1].amount.toLocaleString()}`,
      });
    }
  }

  // ---- Property address consistency checks ----
  // Compare non-title documents that explicitly provide a property address.
  const addressSightings = extractions
    .filter((e) => e.propertyAddress && e.documentType !== "title_report")
    .map((e) => {
      const d = docMap.get(e.documentId);
      return {
        docId: e.documentId,
        docName: d?.displayName ?? d?.originalName ?? e.documentId,
        fileName: d?.originalName,
        address: e.propertyAddress ?? "",
        normalized: normalizeAddress(e.propertyAddress),
        docType: e.documentType,
      };
    })
    .filter((s) => s.normalized.length > 0);

  if (addressSightings.length >= 2) {
    const distinctAddresses = new Set(addressSightings.map((s) => s.normalized));
    if (distinctAddresses.size > 1) {
      const ranked = [...addressSightings].sort(
        (a, b) => propertyAddressDocAuthority(a.docType) - propertyAddressDocAuthority(b.docType)
      );
      const baseline = ranked[0];
      const mismatch = ranked.find(
        (s) => s.docId !== baseline.docId && !addressesCompatible(baseline.normalized, s.normalized)
      );

      if (baseline && mismatch) {
        findings.push({
          id: uuidv4(),
          severity: "warning",
          category: "address_mismatch",
          message: `Property address mismatch across documents: ${baseline.docName} and ${mismatch.docName} list different property addresses.`,
          field1Doc: baseline.docId,
          field1DocName: baseline.docName,
          field1FileName: baseline.fileName,
          field1Value: baseline.address,
          field2Doc: mismatch.docId,
          field2DocName: mismatch.docName,
          field2FileName: mismatch.fileName,
          field2Value: mismatch.address,
        });
      }
    }
  }

  // ---- Entity mismatch: Title Report different party ----
  const titleExtractions = extractions.filter((e) => e.documentType === "title_report");

  // Build a docType lookup from all extractions
  const docTypeByDocId = new Map(extractions.map((e) => [e.documentId, e.documentType]));

  // Only compare against borrowers whose sources include at least one non-title-report document
  const nonTitleBorrowers = borrowers.filter((b) =>
    b.sources.some((s) => docTypeByDocId.get(s.documentId) !== "title_report")
  );

  for (const titleExt of titleExtractions) {
    const titleBorrowerName = titleExt.primaryBorrowerName ?? titleExt.coBorrowerName;
    if (!titleBorrowerName) continue;

    // Check if title report parties match the known non-title borrowers
    const knownBorrowerNames = nonTitleBorrowers.map((b) => normalizeName(b.fullName));
    const titleNameNorm = normalizeName(titleBorrowerName);
    const matches = knownBorrowerNames.some(
      (n) => n.includes(titleNameNorm.split(" ")[0]) || titleNameNorm.includes(n.split(" ")[0])
    );

    console.log(`[validator] Entity check: title parties=[${titleBorrowerName}] vs borrowers=[${nonTitleBorrowers.map((b) => b.fullName).join(", ")}]`);
    if (!matches) {
      console.log(`[validator] Entity MISMATCH: title report references different parties`);
      findings.push({
        id: uuidv4(),
        severity: "warning",
        category: "entity_mismatch",
        message: `Title Report references "${titleBorrowerName}" — this party does not match the loan borrowers. This document may belong to a different transaction.`,
        field1Doc: titleExt.documentId,
        field1DocName: docMap.get(titleExt.documentId)?.displayName ?? docMap.get(titleExt.documentId)?.originalName ?? titleExt.documentId,
        field1FileName: docMap.get(titleExt.documentId)?.originalName,
        field1Value: titleBorrowerName,
        field2Value: nonTitleBorrowers.map((b) => b.fullName).join(", "),
      });
    }
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  console.log(`[validator] DONE — ${findings.length} findings (${errors} errors, ${warnings} warnings)`);
  return findings;
}

function normalize(ssn: string): string {
  return ssn.replace(/\D/g, "");
}

function isPartialSSN(normalized: string): boolean {
  return normalized.length < 9;
}

function ssnCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  if (isPartialSSN(a) && b.endsWith(a)) return true;
  if (isPartialSSN(b) && a.endsWith(b)) return true;
  return false;
}

function maskSSN(ssn: string): string {
  if (ssn.length >= 4) return `XXX-XX-${ssn.slice(-4)}`;
  return ssn;
}

function normalizeName(name?: string): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function propertyAddressDocAuthority(docType: DocumentType): number {
  switch (docType) {
    case "underwriting_summary":
      return 1;
    case "closing_disclosure":
      return 2;
    default:
      return 3;
  }
}

function normalizeAddress(raw?: string): string {
  if (!raw) return "";
  let normalized = raw.toLowerCase();
  const replacements: Array<[RegExp, string]> = [
    [/\bstreet\b/g, "st"],
    [/\bavenue\b/g, "ave"],
    [/\bdrive\b/g, "dr"],
    [/\broad\b/g, "rd"],
    [/\bboulevard\b/g, "blvd"],
    [/\bplace\b/g, "pl"],
    [/\bcourt\b/g, "ct"],
    [/\blane\b/g, "ln"],
    [/\bterrace\b/g, "ter"],
    [/\bapartment\b/g, "apt"],
    [/\bsuite\b/g, "ste"],
  ];
  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addressesCompatible(a: string, b: string): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  const smallerSize = Math.min(aTokens.size, bTokens.size);
  if (smallerSize === 0) return false;
  return overlap / smallerSize >= 0.8;
}
