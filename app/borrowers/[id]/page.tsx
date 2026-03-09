"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useSSE } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SourceDrawer } from "@/components/provenance/source-drawer";
import { formatCurrency, formatDate } from "@/lib/utils";
import type {
  Borrower,
  IncomeRecord,
  Account,
  Loan,
  SSEEvent,
  SystemState,
  ExtractedField,
  SourceReference,
} from "@/lib/types";
import { groupIncomeBySource, filterForQualifying, toCategory } from "@/lib/income";
import { QualifyingIncomeSummary, IncomeBySourceSection } from "@/components/income/income-sections";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { MapPin, ExternalLink } from "lucide-react";

interface BorrowerData {
  borrower: Borrower;
  incomeRecords: IncomeRecord[];
  accounts: Account[];
  fields: ExtractedField[];
  loan: Loan | null;
}

export default function BorrowerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<BorrowerData | null>(null);

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/borrowers/${id}`);
    if (res.ok) {
      const json = await res.json();
      setData(json);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useSSE(
    useCallback(
      (event: SSEEvent) => {
        if (event.type === "state:updated" && event.data) {
          const s = event.data as Partial<SystemState>;
          const borrower = s.borrowers?.find((b) => b.id === id);
          if (borrower) {
            const borrowerDocIds = new Set(borrower.sources.map((src) => src.documentId));
            setData((prev) => ({
              borrower,
              incomeRecords: s.incomeRecords?.filter((r) => r.borrowerId === id) ?? [],
              accounts: s.accounts?.filter((a) => a.borrowerId === id) ?? [],
              fields: s.extractedFields?.filter(
                (f) => f.category === "borrower" && borrowerDocIds.has(f.documentId)
              ) ?? [],
              loan: s.loan ?? prev?.loan ?? null,
            }));
          }
        }
      },
      [id]
    )
  );

  if (!data) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-32 bg-gray-200 rounded" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  const { borrower, incomeRecords, accounts, fields, loan } = data;

  // Build income chart data: group by year using qualifying categories
  const { qualifying: qualifyingRecords, corroborating: corroboratingRecords } = filterForQualifying(incomeRecords);
  const yearMap = new Map<number, { year: number; employment: number; self_employment: number; rental: number; other: number }>();
  for (const r of qualifyingRecords) {
    if (!r.year) continue;
    if (!yearMap.has(r.year)) {
      yearMap.set(r.year, { year: r.year, employment: 0, self_employment: 0, rental: 0, other: 0 });
    }
    const entry = yearMap.get(r.year)!;
    const cat = toCategory(r.source);
    const annualValue = r.annualizedAmount ?? r.amount;
    entry[cat] += annualValue;
  }
  const incomeChartData = Array.from(yearMap.values()).sort((a, b) => a.year - b.year);
  const incomeBySource = groupIncomeBySource(qualifyingRecords, corroboratingRecords);

  const getFieldSource = (fieldKey: string): SourceReference | undefined =>
    borrower.fieldSources?.[fieldKey] ?? borrower.sources[0];

  const getFieldConfidence = (...keywords: string[]): "high" | "medium" | "low" | undefined => {
    const lower = keywords.map((k) => k.toLowerCase());
    return fields.find((f) =>
      lower.some((k) => f.fieldName.toLowerCase().includes(k))
    )?.confidence;
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{borrower.fullName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={borrower.role === "primary" ? "default" : "secondary"}>
              {borrower.role === "primary" ? "Primary Borrower" : "Co-Borrower"}
            </Badge>
            {borrower.employer && <span className="text-sm text-gray-500">{borrower.employer}</span>}
          </div>
        </div>
      </div>

      {/* Card 1: Personal Information */}
      <Card>
        <CardHeader><CardTitle>Personal Information</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <PIIField
              label="SSN"
              value={borrower.ssn}
              source={getFieldSource("ssn")}
              confidence={getFieldConfidence("ssn", "social security")}
            />
            <PIIField
              label="Date of Birth"
              value={borrower.dateOfBirth}
              source={getFieldSource("dateOfBirth")}
              confidence={getFieldConfidence("date of birth", "dob", "birth")}
            />
            <PIIField
              label="Phone"
              value={borrower.phone}
              source={getFieldSource("phone")}
              confidence={getFieldConfidence("phone")}
            />
            <PIIField
              label="Email"
              value={borrower.email}
              source={getFieldSource("email")}
              confidence={getFieldConfidence("email")}
            />
          </div>
          {(borrower.currentAddress?.full || borrower.previousAddress?.full) && (
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
              {borrower.currentAddress?.full && (
                <AddressRow
                  label="Current Address"
                  address={borrower.currentAddress.full}
                  source={getFieldSource("currentAddress")}
                />
              )}
              {borrower.previousAddress?.full && (
                <AddressRow
                  label="Previous Address"
                  address={borrower.previousAddress.full}
                  source={borrower.sources[0]}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 2: Employment */}
      {(borrower.employer || borrower.jobTitle || borrower.hireDate || borrower.annualSalary != null) && (
        <Card>
          <CardHeader><CardTitle>Employment</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <PIIField
                label="Employer"
                value={borrower.employer}
                source={getFieldSource("employer")}
                confidence={getFieldConfidence("employer")}
              />
              <PIIField
                label="Job Title"
                value={borrower.jobTitle}
                source={getFieldSource("jobTitle")}
                confidence={getFieldConfidence("job title", "position", "occupation")}
              />
              <PIIField
                label="Hire Date"
                value={borrower.hireDate}
                source={getFieldSource("hireDate")}
                confidence={getFieldConfidence("hire date", "start date")}
              />
              <PIIField
                label="Annual Salary"
                value={formatCurrency(borrower.annualSalary)}
                source={getFieldSource("annualSalary")}
                confidence={getFieldConfidence("salary", "annual")}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Card 3: Loan Information */}
      {loan && (loan.loanNumber || loan.loanAmount || loan.interestRate || loan.loanType) && (
        <Card>
          <CardHeader><CardTitle>Loan Information</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <LoanField label="Loan Number" value={loan.loanNumber} />
              <LoanField label="Loan Amount" value={formatCurrency(loan.loanAmount)} />
              <LoanField label="Interest Rate" value={loan.interestRate != null ? `${loan.interestRate}%` : undefined} />
              <LoanField label="Loan Type" value={loan.loanType} />
              <LoanField label="Purpose" value={loan.loanPurpose} />
              <LoanField label="Loan Term" value={loan.loanTerm != null ? `${loan.loanTerm} years` : undefined} />
              <LoanField label="Lender" value={loan.lenderName} />
              <LoanField label="Closing Date" value={loan.closingDate ? formatDate(loan.closingDate) : undefined} />
              <LoanField label="Sale Price" value={formatCurrency(loan.salePrice)} />
            </div>
            {loan.propertyAddress?.full && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <AddressRow
                  label="Property Address"
                  address={loan.propertyAddress.full}
                  source={loan.sources[0]}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Qualifying Income Summary */}
      {incomeRecords.length > 0 && <QualifyingIncomeSummary groups={incomeBySource} />}

      {/* Income Chart */}
      {incomeChartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Income History</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={incomeChartData} margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => formatCurrency(v as number)} />
                <Legend />
                <Area type="monotone" dataKey="employment" stackId="1" stroke="#3b82f6" fill="#bfdbfe" name="Employment" />
                <Area type="monotone" dataKey="self_employment" stackId="1" stroke="#8b5cf6" fill="#ddd6fe" name="Self-Employment" />
                <Area type="monotone" dataKey="rental" stackId="1" stroke="#10b981" fill="#a7f3d0" name="Rental" />
                <Area type="monotone" dataKey="other" stackId="1" stroke="#f59e0b" fill="#fde68a" name="Other" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Income by Source */}
      {incomeRecords.length > 0 && <IncomeBySourceSection groups={incomeBySource} />}

      {/* Assets */}
      {accounts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Assets</CardTitle></CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-3">
              {accounts.map((a) => (
                <div key={a.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-sm text-gray-900">{a.institution ?? "Unknown Bank"}</p>
                    <Badge variant="outline" className="capitalize text-[10px]">{a.accountType}</Badge>
                  </div>
                  {a.accountNumberMasked && <p className="text-xs text-gray-500 mb-1">{a.accountNumberMasked}</p>}
                  {a.balance != null && (
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(a.balance)}</p>
                  )}
                  {a.balanceDate && <p className="text-xs text-gray-400">as of {formatDate(a.balanceDate)}</p>}
                  <p className="text-xs text-gray-400 mt-1">Source: {a.sourceDocName}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Source documents */}
      <Card>
        <CardHeader><CardTitle>Source Documents</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1">
            {borrower.sources.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <SourceDrawer source={s} trigger={
                  <button className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm">
                    <ExternalLink className="h-3 w-3" />
                    {s.documentName} (p. {s.pageNumber})
                  </button>
                } />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Borrower-specific sub-components ────────────────────────────────────────

function ConfidenceDot({ confidence }: { confidence?: "high" | "medium" | "low" }) {
  if (!confidence) return null;
  const colors = { high: "bg-green-500", medium: "bg-yellow-400", low: "bg-red-500" };
  const labels = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[confidence]}`}
      title={labels[confidence]}
    />
  );
}

function PIIField({
  label,
  value,
  source,
  confidence,
}: {
  label: string;
  value?: string | null;
  source?: SourceReference;
  confidence?: "high" | "medium" | "low";
}) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="flex items-center gap-1.5">
        <ConfidenceDot confidence={confidence} />
        <p className="text-sm text-gray-900">{value}</p>
        {source && (
          <SourceDrawer source={source} trigger={
            <button className="text-blue-400 hover:text-blue-600">
              <ExternalLink className="h-3 w-3" />
            </button>
          } />
        )}
      </div>
    </div>
  );
}

function LoanField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-gray-900">{value}</p>
    </div>
  );
}

function AddressRow({ label, address, source }: { label: string; address: string; source?: SourceReference }) {
  return (
    <div className="flex items-start gap-2">
      <MapPin className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className="text-sm text-gray-900">{address}</p>
      </div>
      {source && (
        <SourceDrawer source={source} trigger={
          <button className="ml-auto text-blue-500 hover:text-blue-700">
            <ExternalLink className="h-3 w-3" />
          </button>
        } />
      )}
    </div>
  );
}
