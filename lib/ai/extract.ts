import fs from "fs";
import { Poppler } from "node-poppler";
import openai, { MODEL_ID } from "./client";
import { getResponseFormat } from "./schema";
import { EXTRACTION_SYSTEM_PROMPT } from "./prompt";
import type { DocumentExtraction, ExtractedField } from "../types";
import { v4 as uuidv4 } from "uuid";

const poppler = new Poppler();

/**
 * Attempt to repair truncated JSON by closing open arrays/objects.
 * Handles cases where Gemini output was cut off mid-response.
 */
function repairTruncatedJson(text: string): string {
  // First, if truncated mid-string, close the string
  let repaired = text;

  // Remove any trailing partial key-value or comma
  repaired = repaired.replace(/,\s*"[^"]*$/, ""); // trailing partial key
  repaired = repaired.replace(/,\s*$/, ""); // trailing comma
  repaired = repaired.replace(/"[^"]*$/, '""'); // close open string

  // Count unclosed brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
  }

  // Close open structures
  while (openBrackets > 0) { repaired += "]"; openBrackets--; }
  while (openBraces > 0) { repaired += "}"; openBraces--; }

  return repaired;
}

async function pdfToText(filePath: string): Promise<{ text: string; pageCount: number }> {
  const output = await poppler.pdfToText(filePath, undefined, {
    maintainLayout: true,
  }) as string;
  const pages = output.split("\f").filter((p: string) => p.trim());
  const marked = pages.map((p: string, i: number) => `--- Page ${i + 1} ---\n${p.trim()}`).join("\n\n");
  return { text: marked, pageCount: pages.length };
}

interface RawExtraction {
  documentType: string;
  pageCount?: number;
  documentTitle?: string;
  documentYears?: number[];
  primaryBorrowerName?: string;
  primaryBorrowerSSN?: string;
  primaryBorrowerDOB?: string;
  primaryBorrowerPhone?: string;
  primaryBorrowerEmail?: string;
  primaryBorrowerAddress?: string;
  primaryBorrowerEmployer?: string;
  primaryBorrowerJobTitle?: string;
  primaryBorrowerHireDate?: string;
  primaryBorrowerSalary?: string | number;
  coBorrowerName?: string;
  coBorrowerSSN?: string;
  coBorrowerDOB?: string;
  coBorrowerPhone?: string;
  coBorrowerEmail?: string;
  coBorrowerAddress?: string;
  coBorrowerEmployer?: string;
  coBorrowerJobTitle?: string;
  coBorrowerHireDate?: string;
  coBorrowerSalary?: string | number;
  incomeRecords?: Array<{
    borrowerName?: string;
    year?: number;
    source?: string;
    kind?: string;
    period?: string;
    periodEndDate?: string;
    isJoint?: boolean;
    amount?: string | number;
    description?: string;
    pageNumber?: number;
    exactQuote?: string;
  }>;
  accounts?: Array<{
    borrowerName?: string;
    institution?: string;
    accountType?: string;
    accountNumberMasked?: string;
    balance?: string | number;
    balanceDate?: string;
    pageNumber?: number;
  }>;
  loanNumber?: string;
  loanAmount?: string | number;
  interestRate?: string | number;
  loanTerm?: number;
  loanType?: string;
  loanPurpose?: string;
  propertyAddress?: string;
  salePrice?: string | number;
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
  filePath: string
): Promise<DocumentExtraction> {
  const t0 = Date.now();
  console.log(`[extract] START ${documentName}`);

  const { text: pdfText, pageCount } = await pdfToText(filePath);
  console.log(`[extract] Parsed ${documentName}: ${pageCount} pages, ${pdfText.length} chars`);

  const isScanned = pdfText.length < 50;
  let messages: Parameters<typeof openai.chat.completions.create>[0]["messages"];
  if (isScanned) {
    const fileSizeKB = Math.round(fs.statSync(filePath).size / 1024);
    console.log(`[extract] pdfToText returned ${pdfText.length} chars — sending PDF as base64 (${fileSizeKB} KB)`);
    const pdfBase64 = fs.readFileSync(filePath).toString("base64");
    messages = [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Document: ${documentName}\n\nThe PDF text could not be extracted (scanned/image PDF). Read it directly and extract all information. Return JSON matching the schema.` },
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
        ] as any,
      },
    ];
  } else {
    messages = [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Document: ${documentName} (${pageCount} pages)\n\n${pdfText}\n\nExtract all information from this document and return JSON matching the schema.`,
      },
    ];
  }

  console.log(`[extract] → API call START (${documentName}) at +${Date.now() - t0}ms`);
  let result: Awaited<ReturnType<typeof openai.chat.completions.create>>;
  try {
    result = await openai.chat.completions.create({
      model: MODEL_ID,
      temperature: 0.1,
      max_tokens: 16000,
      response_format: getResponseFormat(),
      messages,
      signal: AbortSignal.timeout(120_000),
    } as any);
  } catch (err) {
    console.error(`[extract] ERROR ${documentName} after ${Date.now() - t0}ms:`, err);
    throw err;
  }

  const elapsed = Date.now() - t0;
  const usage = result.usage;
  const finishReason = result.choices[0]?.finish_reason;
  console.log(`[extract] ← API call DONE (${documentName}) in ${elapsed}ms | finish_reason=${finishReason} | tokens in=${usage?.prompt_tokens} out=${usage?.completion_tokens}`);

  if ((finishReason as string) === "length") {
    console.warn(`[extract] *** TRUNCATED OUTPUT for ${documentName} (${usage?.completion_tokens} tokens) — will attempt repair ***`);
  }

  let responseText = result.choices[0]?.message?.content;
  if (!responseText) {
    throw new Error("Empty response from API");
  }

  // Fix Gemini decimal runaway bug: patterns like 350000.0000...0000 or "350000.00e0000...0000"
  // These are numbers followed by hundreds/thousands of trailing zeros that exhaust token limits
  const preFixLen = responseText.length;
  responseText = responseText.replace(/(\d+\.\d{0,2})(?:e?0{20,})/g, "$1");
  if (responseText.length !== preFixLen) {
    console.warn(`[extract] Fixed Gemini decimal runaway for ${documentName}: trimmed ${preFixLen - responseText.length} chars of trailing zeros`);
  }

  // If truncated (finish_reason=length), try to repair the JSON by closing open structures
  if ((finishReason as string) === "length") {
    console.warn(`[extract] Output was truncated for ${documentName}, attempting JSON repair...`);
    responseText = repairTruncatedJson(responseText);
  }

  let raw: RawExtraction;

  try {
    raw = JSON.parse(responseText);
  } catch {
    console.error(`[extract] Failed to parse API response for ${documentName} (${responseText.length} chars):`, responseText.slice(0, 2000));
    throw new Error("Failed to parse extraction response");
  }

  console.log(`[extract] Raw response for ${documentName}: type=${raw.documentType}, primary=${raw.primaryBorrowerName}, co=${raw.coBorrowerName}, fields=${raw.fields?.length}, incomes=${raw.incomeRecords?.length}, accounts=${raw.accounts?.length}, salePrice=${raw.salePrice}, loanAmount=${raw.loanAmount}`);

  // Sanitize string "null", "N/A", "none", "" → undefined
  function sanitizeNull(v: string | undefined | null): string | undefined {
    if (v == null) return undefined;
    const trimmed = v.trim();
    if (!trimmed || /^(null|n\/a|none|unknown)$/i.test(trimmed)) return undefined;
    return trimmed;
  }
  // Parse string-or-number to number (handles schema change from number→string to prevent Gemini decimal runaway)
  function parseNum(v: string | number | undefined | null): number | undefined {
    if (v == null) return undefined;
    const n = typeof v === "string" ? parseFloat(v) : v;
    if (isNaN(n) || n === 0) return undefined;
    return Math.round(n * 100) / 100; // round to 2 decimal places
  }

  // Apply sanitizers to raw fields
  raw.primaryBorrowerName = sanitizeNull(raw.primaryBorrowerName);
  raw.primaryBorrowerSSN = sanitizeNull(raw.primaryBorrowerSSN);
  raw.primaryBorrowerDOB = sanitizeNull(raw.primaryBorrowerDOB);
  raw.primaryBorrowerPhone = sanitizeNull(raw.primaryBorrowerPhone);
  raw.primaryBorrowerEmail = sanitizeNull(raw.primaryBorrowerEmail);
  raw.primaryBorrowerAddress = sanitizeNull(raw.primaryBorrowerAddress);
  raw.primaryBorrowerEmployer = sanitizeNull(raw.primaryBorrowerEmployer);
  raw.primaryBorrowerJobTitle = sanitizeNull(raw.primaryBorrowerJobTitle);
  raw.primaryBorrowerHireDate = sanitizeNull(raw.primaryBorrowerHireDate);
  raw.coBorrowerName = sanitizeNull(raw.coBorrowerName);
  raw.coBorrowerSSN = sanitizeNull(raw.coBorrowerSSN);
  raw.coBorrowerDOB = sanitizeNull(raw.coBorrowerDOB);
  raw.coBorrowerPhone = sanitizeNull(raw.coBorrowerPhone);
  raw.coBorrowerEmail = sanitizeNull(raw.coBorrowerEmail);
  raw.coBorrowerAddress = sanitizeNull(raw.coBorrowerAddress);
  raw.coBorrowerEmployer = sanitizeNull(raw.coBorrowerEmployer);
  raw.coBorrowerJobTitle = sanitizeNull(raw.coBorrowerJobTitle);
  raw.coBorrowerHireDate = sanitizeNull(raw.coBorrowerHireDate);
  raw.loanNumber = sanitizeNull(raw.loanNumber);
  raw.loanType = sanitizeNull(raw.loanType);
  raw.loanPurpose = sanitizeNull(raw.loanPurpose);
  raw.propertyAddress = sanitizeNull(raw.propertyAddress);
  raw.closingDate = sanitizeNull(raw.closingDate);
  raw.lenderName = sanitizeNull(raw.lenderName);
  raw.documentTitle = sanitizeNull(raw.documentTitle);

  // Parse numeric fields from strings (schema uses strings to prevent Gemini decimal runaway bug)
  const parsedSalaryPrimary = parseNum(raw.primaryBorrowerSalary);
  const parsedSalaryCo = parseNum(raw.coBorrowerSalary);
  const parsedLoanAmount = parseNum(raw.loanAmount);
  const parsedInterestRate = parseNum(raw.interestRate);
  const parsedLoanTerm = raw.loanTerm != null && raw.loanTerm !== 0 ? raw.loanTerm : undefined;
  const parsedSalePrice = parseNum(raw.salePrice);
  // Parse income/account amounts
  raw.incomeRecords?.forEach((r) => { (r as any)._parsedAmount = parseNum(r.amount); });
  raw.accounts?.forEach((a) => { (a as any)._parsedBalance = parseNum(a.balance); });

  // Recover top-level fields from fields[] if Gemini didn't populate them (e.g., truncated output)
  const fieldMap = new Map((raw.fields || []).map((f) => [f.fieldName, f.fieldValue]));
  // Also build a lowercase lookup for fuzzy matching field names
  const fieldMapLower = new Map((raw.fields || []).map((f) => [f.fieldName.toLowerCase(), f.fieldValue]));
  const recoverStr = (current: string | undefined, key: string): string | undefined => {
    if (current) return current;
    const v = sanitizeNull(fieldMap.get(key));
    if (v) console.log(`[extract] Recovered ${key} = "${v}" from fields[] array`);
    return v;
  };
  raw.primaryBorrowerName = recoverStr(raw.primaryBorrowerName, "primaryBorrowerName");
  raw.primaryBorrowerSSN = recoverStr(raw.primaryBorrowerSSN, "primaryBorrowerSSN");
  raw.primaryBorrowerDOB = recoverStr(raw.primaryBorrowerDOB, "primaryBorrowerDOB");
  raw.primaryBorrowerPhone = recoverStr(raw.primaryBorrowerPhone, "primaryBorrowerPhone");
  raw.primaryBorrowerEmail = recoverStr(raw.primaryBorrowerEmail, "primaryBorrowerEmail");
  raw.primaryBorrowerAddress = recoverStr(raw.primaryBorrowerAddress, "primaryBorrowerAddress");
  raw.primaryBorrowerEmployer = recoverStr(raw.primaryBorrowerEmployer, "primaryBorrowerEmployer");
  raw.primaryBorrowerJobTitle = recoverStr(raw.primaryBorrowerJobTitle, "primaryBorrowerJobTitle");
  raw.primaryBorrowerHireDate = recoverStr(raw.primaryBorrowerHireDate, "primaryBorrowerHireDate");
  raw.coBorrowerName = recoverStr(raw.coBorrowerName, "coBorrowerName");
  raw.coBorrowerSSN = recoverStr(raw.coBorrowerSSN, "coBorrowerSSN");
  raw.coBorrowerDOB = recoverStr(raw.coBorrowerDOB, "coBorrowerDOB");
  raw.coBorrowerPhone = recoverStr(raw.coBorrowerPhone, "coBorrowerPhone");
  raw.coBorrowerEmail = recoverStr(raw.coBorrowerEmail, "coBorrowerEmail");
  raw.coBorrowerAddress = recoverStr(raw.coBorrowerAddress, "coBorrowerAddress");
  raw.coBorrowerEmployer = recoverStr(raw.coBorrowerEmployer, "coBorrowerEmployer");
  raw.coBorrowerJobTitle = recoverStr(raw.coBorrowerJobTitle, "coBorrowerJobTitle");
  raw.coBorrowerHireDate = recoverStr(raw.coBorrowerHireDate, "coBorrowerHireDate");

  // Also recover co-borrower name from common field[] names
  if (!raw.coBorrowerName) {
    const coName = sanitizeNull(fieldMapLower.get("co-borrower name") ?? fieldMapLower.get("coborrower name") ?? fieldMapLower.get("co-borrower"));
    if (coName) { raw.coBorrowerName = coName; console.log(`[extract] Recovered coBorrowerName = "${coName}" from fields[] array`); }
  }

  // Recover loan fields from fields[] (handles truncated responses where top-level fields were never generated)
  const recoverNumFromFields = (current: number | undefined, ...fieldNames: string[]): number | undefined => {
    if (current != null) return current;
    for (const name of fieldNames) {
      const v = fieldMapLower.get(name.toLowerCase());
      if (v) {
        const n = parseNum(v);
        if (n != null) { console.log(`[extract] Recovered ${name} = ${n} from fields[] array`); return n; }
      }
    }
    return undefined;
  };
  const recoverStrFromFields = (current: string | undefined, ...fieldNames: string[]): string | undefined => {
    if (current) return current;
    for (const name of fieldNames) {
      const v = sanitizeNull(fieldMapLower.get(name.toLowerCase()));
      if (v) { console.log(`[extract] Recovered ${name} = "${v}" from fields[] array`); return v; }
    }
    return undefined;
  };

  // Re-parse numeric fields in case they were recovered from fields[]
  const finalLoanAmount = recoverNumFromFields(parsedLoanAmount, "loan amount", "loanAmount");
  const finalInterestRate = recoverNumFromFields(parsedInterestRate, "interest rate", "interestRate");
  const finalSalePrice = recoverNumFromFields(parsedSalePrice, "sale price", "salePrice");
  const finalLoanTerm = recoverNumFromFields(parsedLoanTerm, "loan term", "loanTerm");
  raw.loanType = recoverStrFromFields(raw.loanType, "loan type", "loanType");
  raw.loanPurpose = recoverStrFromFields(raw.loanPurpose, "loan purpose", "loanPurpose");
  raw.loanNumber = recoverStrFromFields(raw.loanNumber, "loan id", "loan number", "loanNumber", "loan id #");
  raw.lenderName = recoverStrFromFields(raw.lenderName, "lender name", "lenderName", "lender");

  // Build typed extraction (numeric fields already parsed via parseNum above)
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
    pageCount: pageCount || raw.pageCount || undefined,
    documentTitle: raw.documentTitle ?? undefined,
    documentYears: raw.documentYears?.length ? raw.documentYears : undefined,
    primaryBorrowerName: raw.primaryBorrowerName ?? undefined,
    primaryBorrowerSSN: raw.primaryBorrowerSSN ?? undefined,
    primaryBorrowerDOB: raw.primaryBorrowerDOB ?? undefined,
    primaryBorrowerPhone: raw.primaryBorrowerPhone ?? undefined,
    primaryBorrowerEmail: raw.primaryBorrowerEmail ?? undefined,
    primaryBorrowerAddress: raw.primaryBorrowerAddress ?? undefined,
    primaryBorrowerEmployer: raw.primaryBorrowerEmployer ?? undefined,
    primaryBorrowerJobTitle: raw.primaryBorrowerJobTitle ?? undefined,
    primaryBorrowerHireDate: raw.primaryBorrowerHireDate ?? undefined,
    primaryBorrowerSalary: parsedSalaryPrimary,
    coBorrowerName: raw.coBorrowerName ?? undefined,
    coBorrowerSSN: raw.coBorrowerSSN ?? undefined,
    coBorrowerDOB: raw.coBorrowerDOB ?? undefined,
    coBorrowerPhone: raw.coBorrowerPhone ?? undefined,
    coBorrowerEmail: raw.coBorrowerEmail ?? undefined,
    coBorrowerAddress: raw.coBorrowerAddress ?? undefined,
    coBorrowerEmployer: raw.coBorrowerEmployer ?? undefined,
    coBorrowerJobTitle: raw.coBorrowerJobTitle ?? undefined,
    coBorrowerHireDate: raw.coBorrowerHireDate ?? undefined,
    coBorrowerSalary: parsedSalaryCo,
    incomeRecords: (raw.incomeRecords || []).map((r) => ({
      borrowerName: r.borrowerName ?? undefined,
      year: r.year ?? undefined,
      source: (r.source as import("../types").IncomeSource) ?? undefined,
      kind: r.kind as import("../types").IncomeRecordKind ?? undefined,
      period: r.period as import("../types").IncomePeriod ?? undefined,
      periodEndDate: r.periodEndDate ?? undefined,
      isJoint: r.isJoint ?? undefined,
      amount: (r as any)._parsedAmount ?? undefined,
      description: r.description ?? undefined,
      pageNumber: r.pageNumber ?? undefined,
      exactQuote: r.exactQuote ?? undefined,
    })),
    accounts: (raw.accounts || []).map((a) => ({
      borrowerName: a.borrowerName ?? undefined,
      institution: a.institution ?? undefined,
      accountType: (a.accountType as import("../types").AccountType) ?? undefined,
      accountNumberMasked: a.accountNumberMasked ?? undefined,
      balance: (a as any)._parsedBalance ?? undefined,
      balanceDate: a.balanceDate ?? undefined,
      pageNumber: a.pageNumber ?? undefined,
    })),
    loanNumber: raw.loanNumber ?? undefined,
    loanAmount: finalLoanAmount,
    interestRate: finalInterestRate,
    loanTerm: finalLoanTerm,
    loanType: raw.loanType ?? undefined,
    loanPurpose: raw.loanPurpose ?? undefined,
    propertyAddress: raw.propertyAddress ?? undefined,
    salePrice: finalSalePrice,
    closingDate: raw.closingDate ?? undefined,
    lenderName: raw.lenderName ?? undefined,
    fields,
  };

  console.log(`[extract] DONE ${documentName} — ${fields.length} fields extracted`);
  return extraction;
}
