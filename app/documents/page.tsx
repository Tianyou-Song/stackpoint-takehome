"use client";

import { useState, useCallback } from "react";
import { useSSE } from "@/hooks/useSSE";
import { UploadZone } from "@/components/upload/upload-zone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SSEEvent, LoanDocument } from "@/lib/types";
import { CheckCircle2, XCircle, Loader2, Cpu, Clock, FileText, Trash2, RefreshCw } from "lucide-react";
import Link from "next/link";

const TYPE_LABELS: Record<string, string> = {
  tax_return_1040: "1040 Tax Return",
  w2: "W-2",
  bank_statement: "Bank Statement",
  pay_stub: "Pay Stub",
  closing_disclosure: "Closing Disclosure",
  underwriting_summary: "Underwriting Summary",
  title_report: "Title Report",
  evoe: "EVOE",
  schedule_c: "Schedule C",
  other: "Other",
  unknown: "Unknown",
};

const TYPE_COLOR: Record<string, string> = {
  tax_return_1040: "bg-purple-100 text-purple-800",
  w2: "bg-blue-100 text-blue-800",
  bank_statement: "bg-green-100 text-green-800",
  pay_stub: "bg-teal-100 text-teal-800",
  closing_disclosure: "bg-orange-100 text-orange-800",
  underwriting_summary: "bg-pink-100 text-pink-800",
  title_report: "bg-yellow-100 text-yellow-800",
  evoe: "bg-indigo-100 text-indigo-800",
  schedule_c: "bg-violet-100 text-violet-800",
  other: "bg-gray-100 text-gray-800",
  unknown: "bg-gray-100 text-gray-500",
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<LoanDocument[]>([]);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  useSSE(
    useCallback((event: SSEEvent) => {
      if (event.type === "state:updated" && event.data?.documents) {
        setDocuments(event.data.documents);
      }
    }, [])
  );

  async function handleDelete(id: string) {
    if (!confirm("Delete this document? Borrower and loan data will be re-aggregated.")) return;
    setDeleting((prev) => new Set(prev).add(id));
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    // SSE will update the list
    setDeleting((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function handleRetry(id: string) {
    setRetrying((prev) => new Set(prev).add(id));
    await fetch(`/api/documents/${id}`, { method: "POST" });
    setRetrying((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Documents</h1>

      <Card>
        <CardHeader><CardTitle>Upload More Documents</CardTitle></CardHeader>
        <CardContent><UploadZone onUploaded={() => {}} /></CardContent>
      </Card>

      {documents.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No documents uploaded yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {documents.map((d) => (
            <Card key={d.id} className="flex flex-col">
              <CardContent className="pt-4 flex-1">
                <div className="flex items-start gap-3">
                  <StatusIcon status={d.status} />
                  <div className="flex-1 min-w-0">
                    <Link href={`/documents/${d.id}`}>
                      <p className="text-sm font-medium text-gray-900 truncate hover:text-blue-600">{d.displayName || d.originalName}</p>
                      {d.displayName && d.displayName !== d.originalName && (
                        <p className="text-[10px] text-gray-400 truncate">{d.originalName}</p>
                      )}
                    </Link>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_COLOR[d.documentType] ?? "bg-gray-100 text-gray-600"}`}>
                        {TYPE_LABELS[d.documentType] ?? d.documentType}
                      </span>
                      {d.pageCount > 0 && (
                        <span className="text-[10px] text-gray-400">{d.pageCount}p</span>
                      )}
                    </div>
                    {d.errorMessage && (
                      <p className="text-xs text-red-600 mt-1">{d.errorMessage}</p>
                    )}
                    {(d.status === "error" || d.status === "pending" || d.status === "extracting") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 h-7 text-xs gap-1.5"
                        disabled={retrying.has(d.id)}
                        onClick={() => handleRetry(d.id)}
                      >
                        {retrying.has(d.id)
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <RefreshCw className="h-3 w-3" />
                        }
                        Retry
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-gray-400 hover:text-red-600 shrink-0"
                    disabled={deleting.has(d.id)}
                    onClick={() => handleDelete(d.id)}
                  >
                    {deleting.has(d.id)
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />
                    }
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />;
  if (status === "pending") return <Clock className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />;
  if (status === "extracting" || status === "extracted") return <Cpu className="h-4 w-4 text-amber-500 mt-0.5 shrink-0 animate-spin" />;
  return <Loader2 className="h-4 w-4 text-blue-500 mt-0.5 shrink-0 animate-spin" />;
}
