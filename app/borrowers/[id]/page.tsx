"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useSSE } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SourceDrawer } from "@/components/provenance/source-drawer";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Borrower, IncomeRecord, Account, SSEEvent, SystemState } from "@/lib/types";
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
            setData({
              borrower,
              incomeRecords: s.incomeRecords?.filter((r) => r.borrowerId === id) ?? [],
              accounts: s.accounts?.filter((a) => a.borrowerId === id) ?? [],
            });
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

  const { borrower, incomeRecords, accounts } = data;

  // Build income chart data: group by year
  const yearMap = new Map<number, { year: number; w2_wages: number; self_employment: number; rental: number; other: number }>();
  for (const r of incomeRecords) {
    if (!yearMap.has(r.year)) {
      yearMap.set(r.year, { year: r.year, w2_wages: 0, self_employment: 0, rental: 0, other: 0 });
    }
    const entry = yearMap.get(r.year)!;
    entry[r.source as keyof typeof entry] = (entry[r.source as keyof typeof entry] as number) + r.amount;
  }
  const incomeChartData = Array.from(yearMap.values()).sort((a, b) => a.year - b.year);

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

      {/* PII Grid */}
      <Card>
        <CardHeader><CardTitle>Personal Information</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <PIIField label="SSN" value={borrower.ssn} source={borrower.sources[0]} />
            <PIIField label="Date of Birth" value={borrower.dateOfBirth} source={borrower.sources[0]} />
            <PIIField label="Phone" value={borrower.phone} source={borrower.sources[0]} />
            <PIIField label="Email" value={borrower.email} source={borrower.sources[0]} />
            <PIIField label="Employer" value={borrower.employer} source={borrower.sources[0]} />
            <PIIField label="Job Title" value={borrower.jobTitle} source={borrower.sources[0]} />
            <PIIField label="Hire Date" value={borrower.hireDate} source={borrower.sources[0]} />
            <PIIField label="Annual Salary" value={formatCurrency(borrower.annualSalary)} source={borrower.sources[0]} />
          </div>
          {borrower.currentAddress?.full && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Current Address</p>
                  <p className="text-sm text-gray-900">{borrower.currentAddress.full}</p>
                </div>
                {borrower.sources[0] && (
                  <SourceDrawer source={borrower.sources[0]} trigger={
                    <button className="ml-auto text-blue-500 hover:text-blue-700">
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  } />
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
                <Area type="monotone" dataKey="w2_wages" stackId="1" stroke="#3b82f6" fill="#bfdbfe" name="W-2 Wages" />
                <Area type="monotone" dataKey="self_employment" stackId="1" stroke="#8b5cf6" fill="#ddd6fe" name="Self-Employment" />
                <Area type="monotone" dataKey="rental" stackId="1" stroke="#10b981" fill="#a7f3d0" name="Rental" />
                <Area type="monotone" dataKey="other" stackId="1" stroke="#f59e0b" fill="#fde68a" name="Other" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Income Table */}
      {incomeRecords.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Income Records</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Year</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {incomeRecords.sort((a, b) => b.year - a.year).map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-900">{r.year || "—"}</td>
                    <td className="px-6 py-3">
                      <Badge variant="secondary" className="capitalize">{r.source.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-gray-900">{formatCurrency(r.amount)}</td>
                    <td className="px-6 py-3 text-gray-500 text-xs truncate max-w-[200px]">{r.sourceDocName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Accounts */}
      {accounts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Bank Accounts</CardTitle></CardHeader>
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

function PIIField({ label, value, source }: { label: string; value?: string | null; source?: import("@/lib/types").SourceReference }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="flex items-center gap-1.5">
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
