"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LoanDocument, DocumentExtraction, ExtractedField } from "@/lib/types";
import { FileText } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface DocumentDetail {
  document: LoanDocument;
  extraction: DocumentExtraction | null;
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "success",
  medium: "warning",
  low: "destructive",
};

const CATEGORY_ORDER: ExtractedField["category"][] = [
  "borrower",
  "loan",
  "property",
  "income",
  "account",
  "other",
];

const CATEGORY_LABELS: Record<ExtractedField["category"], string> = {
  borrower: "Borrower",
  loan: "Loan",
  property: "Property",
  income: "Income",
  account: "Account",
  other: "Other",
};

const CURRENCY_FIELD_PATTERN = /amount|salary|wages|income|price|balance|profit|proceeds|total|gross|net|cost|value|fee|tax|payment/i;

function formatFieldValue(f: ExtractedField): string {
  const raw = f.fieldValue;
  if (f.category === "income" || f.category === "account" || f.category === "loan" || f.category === "property") {
    if (CURRENCY_FIELD_PATTERN.test(f.fieldName)) {
      const num = parseFloat(String(raw).replace(/[$,]/g, ""));
      if (!isNaN(num) && isFinite(num)) return formatCurrency(num);
    }
  }
  return String(raw ?? "—");
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DocumentDetail | null>(null);

  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then((r) => r.json())
      .then(setData);
  }, [id]);

  if (!data) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  const { document: doc, extraction } = data;

  // Group fields by category
  const grouped = new Map<ExtractedField["category"], ExtractedField[]>();
  for (const f of extraction?.fields ?? []) {
    if (!grouped.has(f.category)) grouped.set(f.category, []);
    grouped.get(f.category)!.push(f);
  }
  const presentCategories = CATEGORY_ORDER.filter((c) => grouped.has(c));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start gap-3">
        <FileText className="h-6 w-6 text-gray-400 mt-0.5 shrink-0" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">{doc.displayName || doc.originalName}</h1>
          {doc.displayName && doc.displayName !== doc.originalName && (
            <p className="text-xs text-gray-400 mt-0.5">{doc.originalName}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary">{doc.documentType.replace(/_/g, " ")}</Badge>
            <span className="text-xs text-gray-500">{doc.pageCount} pages</span>
            <Badge variant={doc.status === "completed" ? "success" : doc.status === "error" ? "destructive" : "secondary"}>
              {doc.status}
            </Badge>
          </div>
        </div>
      </div>

      {extraction && presentCategories.length > 0 && presentCategories.map((category) => {
        const fields = grouped.get(category)!;
        return (
          <Card key={category}>
            <CardHeader>
              <CardTitle>{CATEGORY_LABELS[category]} Fields <span className="text-sm font-normal text-gray-400">({fields.length})</span></CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide w-1/4">Field</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Value</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide w-20">Page</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide w-24">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {fields.map((f: ExtractedField) => (
                    <tr key={f.id} className="hover:bg-gray-50" title={f.exactQuote}>
                      <td className="px-6 py-2.5 text-gray-600 font-medium">{f.fieldName}</td>
                      <td className="px-6 py-2.5 text-gray-900 max-w-xs truncate">{formatFieldValue(f)}</td>
                      <td className="px-6 py-2.5 text-gray-500">{f.pageNumber ?? "—"}</td>
                      <td className="px-6 py-2.5">
                        <Badge variant={(CONFIDENCE_COLOR[f.confidence] as "success" | "warning" | "destructive") ?? "secondary"}>
                          {f.confidence}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

      {extraction && presentCategories.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-gray-400">No fields extracted from this document.</CardContent>
        </Card>
      )}
    </div>
  );
}
