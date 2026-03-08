"use client";

import { useState, useCallback } from "react";
import { useSSE } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import type { SSEEvent, IncomeRecord } from "@/lib/types";
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
import { TrendingUp } from "lucide-react";

export default function IncomePage() {
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);

  useSSE(
    useCallback((event: SSEEvent) => {
      if (event.type === "state:updated" && event.data?.incomeRecords) {
        setIncomeRecords(event.data.incomeRecords);
      }
    }, [])
  );

  // Build chart data: group by year, stack by source
  const yearMap = new Map<number, { year: number; w2_wages: number; self_employment: number; rental: number; other: number }>();
  for (const r of incomeRecords) {
    if (!yearMap.has(r.year)) {
      yearMap.set(r.year, { year: r.year, w2_wages: 0, self_employment: 0, rental: 0, other: 0 });
    }
    const entry = yearMap.get(r.year)!;
    const key = r.source as keyof typeof entry;
    if (key in entry && key !== "year") {
      (entry[key] as number) += r.amount;
    }
  }
  const chartData = Array.from(yearMap.values()).sort((a, b) => a.year - b.year);

  // Build reconciliation: same borrower + year + source across multiple docs
  const reconciliation = new Map<string, IncomeRecord[]>();
  for (const r of incomeRecords) {
    const key = `${r.borrowerName}-${r.year}-${r.source}`;
    if (!reconciliation.has(key)) reconciliation.set(key, []);
    reconciliation.get(key)!.push(r);
  }
  const discrepancies = Array.from(reconciliation.entries()).filter(([, records]: [string, IncomeRecord[]]) => {
    if (records.length < 2) return false;
    const amounts = records.map((r) => r.amount);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    return min > 0 && (max - min) / min > 0.05;
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Income Analysis</h1>

      {incomeRecords.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <TrendingUp className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No income records extracted yet.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {chartData.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Income by Year</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
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

          {/* Full income table */}
          <Card>
            <CardHeader><CardTitle>All Income Records</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Borrower</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Year</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Source</th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Document</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {incomeRecords.sort((a, b) => b.year - a.year).map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-6 py-2.5 text-gray-900">{r.borrowerName ?? "—"}</td>
                      <td className="px-6 py-2.5 text-gray-600">{r.year || "—"}</td>
                      <td className="px-6 py-2.5">
                        <Badge variant="secondary" className="capitalize text-xs">{r.source.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-6 py-2.5 text-right font-medium text-gray-900">{formatCurrency(r.amount)}</td>
                      <td className="px-6 py-2.5 text-gray-400 text-xs truncate max-w-[180px]">{r.sourceDocName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Cross-document reconciliation */}
          {discrepancies.length > 0 && (
            <Card className="border-yellow-200">
              <CardHeader className="bg-yellow-50 rounded-t-xl">
                <CardTitle className="text-yellow-800">Cross-Document Discrepancies</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {discrepancies.map(([key, records]: [string, IncomeRecord[]]) => (
                  <div key={key} className="bg-yellow-50 rounded-lg p-4">
                    <p className="text-sm font-medium text-yellow-900 mb-2">
                      {records[0].borrowerName} — {records[0].source.replace(/_/g, " ")} {records[0].year}
                    </p>
                    <div className="space-y-1">
                      {records.map((r) => (
                        <div key={r.id} className="flex items-center justify-between text-xs">
                          <span className="text-yellow-700 truncate">{r.sourceDocName}</span>
                          <span className="font-medium text-yellow-900">{formatCurrency(r.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
