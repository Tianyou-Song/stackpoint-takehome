import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { DocumentType } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount?: number): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

export function formatPercent(rate?: number): string {
  if (rate == null) return "—";
  return `${rate.toFixed(3)}%`;
}

export function formatDate(date?: string): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return date;
  }
}

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  tax_return_1040: "Form 1040",
  w2: "W-2",
  bank_statement: "Bank Statement",
  pay_stub: "Pay Stub",
  closing_disclosure: "Closing Disclosure",
  underwriting_summary: "Underwriting Summary",
  title_report: "Title Report",
  evoe: "EVOE",
  schedule_c: "Schedule C",
  other: "Other",
  unknown: "Document",
};

export function buildDisplayName(
  documentType: DocumentType,
  options: {
    documentYears?: number[];
    primaryBorrowerName?: string;
    coBorrowerName?: string;
    documentTitle?: string;
  }
): string {
  const { documentYears, primaryBorrowerName, coBorrowerName, documentTitle } = options;

  // For truly unknown/other types, fall back to documentTitle if available
  let typeLabel = DOCUMENT_TYPE_LABELS[documentType] ?? "Document";
  if ((documentType === "other" || documentType === "unknown") && documentTitle) {
    typeLabel = documentTitle;
  }

  // Build years suffix
  let yearsSuffix = "";
  if (documentYears && documentYears.length > 0) {
    const sorted = [...documentYears].sort((a, b) => a - b);
    yearsSuffix = ` (${sorted.join(", ")})`;
  }

  // Build borrower suffix — combine names if they share a last name
  let borrowerSuffix = "";
  if (primaryBorrowerName && coBorrowerName) {
    const primaryParts = primaryBorrowerName.trim().split(/\s+/);
    const coParts = coBorrowerName.trim().split(/\s+/);
    const primaryLast = primaryParts[primaryParts.length - 1];
    const coLast = coParts[coParts.length - 1];
    if (primaryLast && coLast && primaryLast.toLowerCase() === coLast.toLowerCase()) {
      // Same last name: "John & Mary Homeowner"
      borrowerSuffix = ` \u2014 ${primaryParts[0]} & ${coBorrowerName.trim()}`;
    } else {
      borrowerSuffix = ` \u2014 ${primaryBorrowerName.trim()} & ${coBorrowerName.trim()}`;
    }
  } else if (primaryBorrowerName) {
    borrowerSuffix = ` \u2014 ${primaryBorrowerName.trim()}`;
  } else if (coBorrowerName) {
    borrowerSuffix = ` \u2014 ${coBorrowerName.trim()}`;
  }

  return `${typeLabel}${yearsSuffix}${borrowerSuffix}`;
}

export function formatErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || /quota/i.test(msg)) {
    return "Rate limit exceeded — the Gemini API quota has been reached. Please wait a moment and retry.";
  }
  if (msg.includes("401") || msg.includes("403") || /api.?key/i.test(msg)) {
    return "Gemini API key is invalid or unauthorized. Check GOOGLE_API_KEY in .env.local.";
  }
  if (msg.includes("400") && /gemini|generative/i.test(msg)) {
    return "Gemini rejected the request — the document may be too long or contain unsupported content.";
  }
  if (/GoogleGenerativeAI/i.test(msg)) {
    const cleaned = msg
      .replace(/\[GoogleGenerativeAI Error\]:\s*/i, "")
      .replace(/Error fetching from https?:\/\/\S+:\s*/i, "")
      .trim();
    return `Gemini API error: ${cleaned.slice(0, 300)}`;
  }
  return msg.slice(0, 400);
}
