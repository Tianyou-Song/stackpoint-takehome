"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LoanDocument, DocumentExtraction, ExtractedField } from "@/lib/types";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";

interface DocumentDetail {
  document: LoanDocument;
  extraction: DocumentExtraction | null;
  rawText: string | null;
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "success",
  medium: "warning",
  low: "destructive",
};

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DocumentDetail | null>(null);
  const [showRaw, setShowRaw] = useState(false);

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

  const { document: doc, extraction, rawText } = data;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start gap-3">
        <FileText className="h-6 w-6 text-gray-400 mt-0.5 shrink-0" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">{doc.originalName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary">{doc.documentType.replace(/_/g, " ")}</Badge>
            <span className="text-xs text-gray-500">{doc.pageCount} pages</span>
            <Badge variant={doc.status === "completed" ? "success" : doc.status === "error" ? "destructive" : "secondary"}>
              {doc.status}
            </Badge>
          </div>
        </div>
      </div>

      {extraction && extraction.fields.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Extracted Fields ({extraction.fields.length})</CardTitle></CardHeader>
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
                {extraction.fields.map((f: ExtractedField) => (
                  <tr key={f.id} className="hover:bg-gray-50" title={f.exactQuote}>
                    <td className="px-6 py-2.5 text-gray-600 font-medium">{f.fieldName}</td>
                    <td className="px-6 py-2.5 text-gray-900 max-w-xs truncate">{f.fieldValue}</td>
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
      )}

      {rawText && (
        <Card>
          <CardHeader>
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="flex items-center gap-2 w-full text-left"
            >
              <CardTitle>Raw Extracted Text</CardTitle>
              {showRaw ? <ChevronUp className="h-4 w-4 text-gray-400 ml-auto" /> : <ChevronDown className="h-4 w-4 text-gray-400 ml-auto" />}
            </button>
          </CardHeader>
          {showRaw && (
            <CardContent>
              <pre className="text-xs text-gray-600 bg-gray-50 rounded p-4 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                {rawText}
              </pre>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
