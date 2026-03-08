import { model } from "./client";
import { EXTRACTION_SCHEMA } from "./schema";
import { EXTRACTION_SYSTEM_PROMPT } from "./prompt";
import type { DocumentExtraction, ExtractedField } from "../types";
import { v4 as uuidv4 } from "uuid";

interface RawExtraction {
  documentType: string;
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
  incomeRecords?: Array<{
    borrowerName?: string;
    year?: number;
    source?: string;
    amount?: number;
    description?: string;
    pageNumber?: number;
    exactQuote?: string;
  }>;
  accounts?: Array<{
    borrowerName?: string;
    institution?: string;
    accountType?: string;
    accountNumberMasked?: string;
    balance?: number;
    balanceDate?: string;
    pageNumber?: number;
  }>;
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
  fields: Array<{
    fieldName: string;
    fieldValue: string;
    confidence: string;
    pageNumber?: number;
    exactQuote?: string;
    category: string;
  }>;
}

export async function extractFromDocument(
  documentId: string,
  documentName: string,
  fullText: string
): Promise<DocumentExtraction> {
  // Truncate text if too long (Gemini 3 Flash preview has ~1M token context but we stay conservative)
  const truncatedText = fullText.length > 200000 ? fullText.slice(0, 200000) + "\n[... truncated]" : fullText;

  const prompt = `${EXTRACTION_SYSTEM_PROMPT}

Document: ${documentName}

---
${truncatedText}
---

Extract all information from this document and return JSON matching the schema.`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EXTRACTION_SCHEMA as Parameters<typeof model.generateContent>[0] extends { generationConfig?: { responseSchema?: infer S } } ? S : never,
      temperature: 0.1,
    },
  });

  const responseText = result.response.text();
  let raw: RawExtraction;

  try {
    raw = JSON.parse(responseText);
  } catch {
    console.error("Failed to parse Gemini response:", responseText.slice(0, 500));
    throw new Error("Failed to parse extraction response from Gemini");
  }

  // Build typed extraction
  const fields: ExtractedField[] = (raw.fields || []).map((f) => ({
    id: uuidv4(),
    documentId,
    fieldName: f.fieldName,
    fieldValue: f.fieldValue,
    confidence: (f.confidence as "high" | "medium" | "low") || "medium",
    pageNumber: f.pageNumber,
    exactQuote: f.exactQuote,
    category: (f.category as ExtractedField["category"]) || "other",
  }));

  const extraction: DocumentExtraction = {
    documentId,
    documentType: raw.documentType as DocumentExtraction["documentType"],
    primaryBorrowerName: raw.primaryBorrowerName ?? undefined,
    primaryBorrowerSSN: raw.primaryBorrowerSSN ?? undefined,
    primaryBorrowerDOB: raw.primaryBorrowerDOB ?? undefined,
    primaryBorrowerPhone: raw.primaryBorrowerPhone ?? undefined,
    primaryBorrowerEmail: raw.primaryBorrowerEmail ?? undefined,
    primaryBorrowerAddress: raw.primaryBorrowerAddress ?? undefined,
    primaryBorrowerEmployer: raw.primaryBorrowerEmployer ?? undefined,
    primaryBorrowerJobTitle: raw.primaryBorrowerJobTitle ?? undefined,
    primaryBorrowerHireDate: raw.primaryBorrowerHireDate ?? undefined,
    primaryBorrowerSalary: raw.primaryBorrowerSalary ?? undefined,
    coBorrowerName: raw.coBorrowerName ?? undefined,
    coBorrowerSSN: raw.coBorrowerSSN ?? undefined,
    coBorrowerDOB: raw.coBorrowerDOB ?? undefined,
    coBorrowerPhone: raw.coBorrowerPhone ?? undefined,
    coBorrowerEmail: raw.coBorrowerEmail ?? undefined,
    coBorrowerAddress: raw.coBorrowerAddress ?? undefined,
    coBorrowerEmployer: raw.coBorrowerEmployer ?? undefined,
    coBorrowerJobTitle: raw.coBorrowerJobTitle ?? undefined,
    coBorrowerHireDate: raw.coBorrowerHireDate ?? undefined,
    coBorrowerSalary: raw.coBorrowerSalary ?? undefined,
    incomeRecords: (raw.incomeRecords || []).map((r) => ({
      borrowerName: r.borrowerName ?? undefined,
      year: r.year ?? undefined,
      source: (r.source as import("../types").IncomeSource) ?? undefined,
      amount: r.amount ?? undefined,
      description: r.description ?? undefined,
      pageNumber: r.pageNumber ?? undefined,
      exactQuote: r.exactQuote ?? undefined,
    })),
    accounts: (raw.accounts || []).map((a) => ({
      borrowerName: a.borrowerName ?? undefined,
      institution: a.institution ?? undefined,
      accountType: (a.accountType as import("../types").AccountType) ?? undefined,
      accountNumberMasked: a.accountNumberMasked ?? undefined,
      balance: a.balance ?? undefined,
      balanceDate: a.balanceDate ?? undefined,
      pageNumber: a.pageNumber ?? undefined,
    })),
    loanNumber: raw.loanNumber ?? undefined,
    loanAmount: raw.loanAmount ?? undefined,
    interestRate: raw.interestRate ?? undefined,
    loanTerm: raw.loanTerm ?? undefined,
    loanType: raw.loanType ?? undefined,
    loanPurpose: raw.loanPurpose ?? undefined,
    propertyAddress: raw.propertyAddress ?? undefined,
    salePrice: raw.salePrice ?? undefined,
    closingDate: raw.closingDate ?? undefined,
    lenderName: raw.lenderName ?? undefined,
    fields,
  };

  return extraction;
}
