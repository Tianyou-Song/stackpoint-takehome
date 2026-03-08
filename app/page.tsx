"use client";

import { useState, useCallback } from "react";
import { useSSE } from "@/hooks/useSSE";
import { UploadZone } from "@/components/upload/upload-zone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import type { SSEEvent, SystemState, LoanDocument } from "@/lib/types";
import { FileText, Users, ShieldAlert, TrendingUp, Loader2, CheckCircle2, XCircle, Clock, Cpu } from "lucide-react";
import Link from "next/link";

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3 w-3 text-gray-400" />,
  parsing: <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />,
  parsed: <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />,
  extracting: <Cpu className="h-3 w-3 text-amber-500 animate-spin" style={{ animation: "spin 1.5s linear infinite" }} />,
  extracted: <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />,
  completed: <CheckCircle2 className="h-3 w-3 text-green-500" />,
  error: <XCircle className="h-3 w-3 text-red-500" />,
};

export default function DashboardPage() {
  const [state, setState] = useState<Partial<SystemState>>({});

  useSSE(
    useCallback((event: SSEEvent) => {
      console.log("[Dashboard] SSE event received:", event.type, event.data ? Object.keys(event.data) : "no data");
      if (event.type === "state:updated" && event.data) {
        setState((prev) => ({ ...prev, ...event.data }));
      }
    }, [])
  );

  const loan = state.loan;
  const borrowers = state.borrowers ?? [];
  const documents = state.documents ?? [];
  const findings = state.validationFindings ?? [];
  const fields = state.extractedFields ?? [];

  const completed = documents.filter((d) => d.status === "completed").length;
  const inProgress = documents.filter((d) => !["completed", "error"].includes(d.status) && d.status !== "pending").length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Loan 214 — Document Extraction</h1>
        <p className="text-sm text-gray-500 mt-0.5">Upload mortgage PDFs to extract borrower records, income history, and loan details.</p>
      </div>

      {/* Upload Zone */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadZone onUploaded={() => {}} />
        </CardContent>
      </Card>

      {/* Stats row */}
      {documents.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Documents" value={`${completed}/${documents.length}`} sub="processed" icon={<FileText className="h-4 w-4 text-blue-500" />} />
          <StatCard label="Borrowers" value={borrowers.length} sub="identified" icon={<Users className="h-4 w-4 text-purple-500" />} />
          <StatCard label="Fields" value={fields.length} sub="extracted" icon={<TrendingUp className="h-4 w-4 text-green-500" />} />
          <StatCard label="Issues" value={findings.filter(f => f.severity === "error").length} sub={`${findings.length} total findings`} icon={<ShieldAlert className="h-4 w-4 text-red-500" />} />
        </div>
      )}

      {/* Processing progress */}
      {inProgress > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              Processing {inProgress} document{inProgress !== 1 ? "s" : ""}...
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {documents.filter((d) => !["completed", "error"].includes(d.status)).map((d) => (
                <DocProgressRow key={d.id} doc={d} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loan Overview */}
      {(loan?.loanNumber || loan?.loanAmount) && (
        <Card>
          <CardHeader>
            <CardTitle>Loan Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Loan Number" value={loan?.loanNumber} />
              <Field label="Loan Amount" value={formatCurrency(loan?.loanAmount)} />
              <Field label="Interest Rate" value={formatPercent(loan?.interestRate)} />
              <Field label="Loan Type" value={loan?.loanType} />
              <Field label="Purpose" value={loan?.loanPurpose} />
              <Field label="Closing Date" value={formatDate(loan?.closingDate)} />
              <Field label="Sale Price" value={formatCurrency(loan?.salePrice)} className="col-span-2 sm:col-span-1" />
              <Field label="Lender" value={loan?.lenderName} className="col-span-2 sm:col-span-2" />
              {loan?.propertyAddress?.full && (
                <Field label="Property Address" value={loan.propertyAddress.full} className="col-span-2 sm:col-span-3" />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Borrower Cards */}
      {borrowers.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Borrowers</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {borrowers.map((b) => (
              <Link key={b.id} href={`/borrowers/${b.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">{b.fullName ?? "Unknown"}</p>
                        <p className="text-xs text-gray-500 capitalize">{b.role}</p>
                      </div>
                      <Badge variant="secondary">{b.role === "primary" ? "Primary" : "Co-Borrower"}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {b.ssn && <Field label="SSN" value={b.ssn} small />}
                      {b.employer && <Field label="Employer" value={b.employer} small />}
                      {b.annualSalary && <Field label="Salary" value={formatCurrency(b.annualSalary)} small />}
                      {b.phone && <Field label="Phone" value={b.phone} small />}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Validation Alerts */}
      {findings.filter((f) => f.severity === "error").length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="bg-red-50 rounded-t-xl">
            <CardTitle className="text-red-800 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" /> Validation Errors
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-3">
            {findings.filter((f) => f.severity === "error").map((f) => (
              <div key={f.id} className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{f.message}</div>
            ))}
            <Link href="/validation" className="text-xs text-blue-600 hover:underline block mt-2">
              View all findings →
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Document list (compact) */}
      {documents.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Documents</CardTitle>
            <Link href="/documents" className="text-xs text-blue-600 hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {documents.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-6 py-2.5">
                  {STATUS_ICON[d.status] ?? <FileText className="h-3 w-3 text-gray-400" />}
                  <span className="flex-1 text-sm text-gray-700 truncate">{d.originalName}</span>
                  <DocTypeBadge type={d.documentType} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: number | string; sub: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs font-medium text-gray-500">{label}</span></div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-400">{sub}</p>
      </CardContent>
    </Card>
  );
}

function DocProgressRow({ doc }: { doc: LoanDocument }) {
  const label: Record<string, string> = {
    pending: "Waiting",
    parsing: "Parsing PDF...",
    parsed: "Parsed",
    extracting: "Extracting with Gemini...",
    extracted: "Extracted",
    completed: "Done",
    error: "Error",
  };
  return (
    <div className="flex items-center gap-3 text-sm">
      {STATUS_ICON[doc.status]}
      <span className="flex-1 truncate text-gray-700">{doc.originalName}</span>
      <span className="text-xs text-gray-400">{label[doc.status]}</span>
    </div>
  );
}

function Field({ label, value, className, small }: { label: string; value?: string | null; className?: string; small?: boolean }) {
  if (!value || value === "—") return null;
  return (
    <div className={className}>
      <p className={`font-medium text-gray-500 uppercase tracking-wide ${small ? "text-[10px]" : "text-xs"} mb-0.5`}>{label}</p>
      <p className={`text-gray-900 ${small ? "text-xs" : "text-sm"}`}>{value}</p>
    </div>
  );
}

function DocTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    tax_return_1040: "1040",
    w2: "W-2",
    bank_statement: "Bank Stmt",
    pay_stub: "Pay Stub",
    closing_disclosure: "CD",
    underwriting_summary: "Underwriting",
    title_report: "Title",
    evoe: "EVOE",
    schedule_c: "Sch. C",
    other: "Other",
    unknown: "Unknown",
  };
  return <Badge variant="outline" className="text-[10px]">{labels[type] ?? type}</Badge>;
}
