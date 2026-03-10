"use client";

import { useState, useCallback, useEffect } from "react";
import { useSSE } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { SSEEvent, IncomeRecord } from "@/lib/types";
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
import { TrendingUp } from "lucide-react";

type IncomeChartRow = {
  year: number;
  employment: number;
  self_employment: number;
  rental: number;
  other: number;
};

const AREA_SERIES: Array<{
  key: keyof Omit<IncomeChartRow, "year">;
  stroke: string;
  fill: string;
  name: string;
}> = [
  { key: "employment", stroke: "#3b82f6", fill: "#bfdbfe", name: "Employment" },
  { key: "self_employment", stroke: "#8b5cf6", fill: "#ddd6fe", name: "Self-Employment" },
  { key: "rental", stroke: "#10b981", fill: "#a7f3d0", name: "Rental" },
  { key: "other", stroke: "#f59e0b", fill: "#fde68a", name: "Other" },
];

export default function IncomePage() {
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);

  useEffect(() => {
    fetch("/api/income")
      .then((r) => r.json())
      .then((data: IncomeRecord[]) => {
        if (Array.isArray(data)) setIncomeRecords(data);
      })
      .catch(() => {});
  }, []);

  useSSE(
    useCallback((event: SSEEvent) => {
      if (event.type === "state:updated" && event.data?.incomeRecords) {
        setIncomeRecords(event.data.incomeRecords);
      }
    }, [])
  );

  // Build chart data: group by year, stack by qualifying category
  const { qualifying: qualifyingRecords } = filterForQualifying(incomeRecords);
  const yearMap = new Map<number, IncomeChartRow>();
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
  const chartData = Array.from(yearMap.values()).sort((a, b) => a.year - b.year);
  const activeSeries = AREA_SERIES.filter((series) => chartData.some((row) => row[series.key] > 0));

  // Build reconciliation: compare annual doc_total records of the same kind across docs
  const reconciliation = new Map<string, IncomeRecord[]>();
  for (const r of incomeRecords) {
    if (r.isJoint || r.borrowerId === "joint") continue;
    if (r.kind !== "doc_total" || r.period !== "annual") continue;
    const key = `${r.borrowerName}-${r.year}-${r.source}`;
    if (!reconciliation.has(key)) reconciliation.set(key, []);
    reconciliation.get(key)!.push(r);
  }
  const borrowerNames = Array.from(new Set(
    qualifyingRecords.filter(r => r.borrowerId !== "joint").map((r) => r.borrowerName ?? "Unknown")
  ));

  const discrepancies = Array.from(reconciliation.entries()).filter(([, records]: [string, IncomeRecord[]]) => {
    if (records.length < 2) return false;
    const uniqueDocs = new Set(records.map((r) => r.sourceDoc));
    if (uniqueDocs.size < 2) return false;
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
                    {activeSeries.map((series) => (
                      <Area
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        stackId="1"
                        stroke={series.stroke}
                        fill={series.fill}
                        name={series.name}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Per-borrower income sections */}
          {borrowerNames.map((name) => {
            const { qualifying: borrowerQualifying, corroborating: borrowerCorroborating } = filterForQualifying(incomeRecords.filter((r) => (r.borrowerName ?? "Unknown") === name && r.borrowerId !== "joint"));
            const groups = groupIncomeBySource(borrowerQualifying, borrowerCorroborating);
            const totalMonthly = Array.from(groups.values()).reduce((s, g) => s + g.qualifyingMonthly, 0);
            return (
              <div key={name} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-800">{name}</h2>
                  <span className="text-sm text-gray-500">Total qualifying: <span className="font-semibold text-gray-900">{formatCurrency(totalMonthly)}/mo</span></span>
                </div>
                <QualifyingIncomeSummary groups={groups} />
                <IncomeBySourceSection groups={groups} />
              </div>
            );
          })}

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
