"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SourceDrawer } from "@/components/provenance/source-drawer";
import { formatCurrency } from "@/lib/utils";
import type { IncomeRecord, IncomeSource } from "@/lib/types";
import type { SourceGroup } from "@/lib/income";
import {
  SOURCE_LABELS,
  SOURCE_COLORS,
  getTrendIndicator,
  buildDescriptionRows,
} from "@/lib/income";
import {
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Minus,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ─── Trend icon helper ───────────────────────────────────────────────────────

function TrendIcon({ trend }: { trend: SourceGroup["trend"] }) {
  const { colorClass } = getTrendIndicator(trend);
  const cls = `h-4 w-4 ${colorClass}`;
  switch (trend) {
    case "increasing":
      return <TrendingUp className={cls} />;
    case "declining":
      return <TrendingDown className={cls} />;
    case "stable":
      return <ArrowRight className={cls} />;
    case "insufficient_data":
      return <Minus className={cls} />;
  }
}

// ─── QualifyingIncomeSummary ─────────────────────────────────────────────────

export function QualifyingIncomeSummary({ groups }: { groups: Map<IncomeSource, SourceGroup> }) {
  const rows = Array.from(groups.values()).filter((g) => g.qualifyingMonthly > 0);
  if (rows.length === 0) return null;
  const totalMonthly = rows.reduce((s, g) => s + g.qualifyingMonthly, 0);
  return (
    <Card>
      <CardHeader><CardTitle>Qualifying Income Summary</CardTitle></CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Source</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Trend</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Qualifying Annual</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Monthly</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((g) => {
              const ti = getTrendIndicator(g.trend);
              const isDeclining = g.trend === "declining";
              return (
                <tr key={g.source} className={isDeclining ? "bg-red-50 hover:bg-red-100" : "hover:bg-gray-50"}>
                  <td className="px-6 py-3 text-gray-700">{SOURCE_LABELS[g.source]}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${ti.colorClass}`}>
                      <TrendIcon trend={g.trend} />
                      {ti.label}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right text-gray-900">
                    <div className="text-right">
                      <p>
                        {formatCurrency(g.qualifyingAnnual)}
                        <span
                          className="text-xs text-gray-400 ml-1"
                          title={g.qualifyingMethodDetail}
                        >
                          ({g.qualifyingMethod})
                        </span>
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{g.qualifyingMethodDetail}</p>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right font-medium text-gray-900">{formatCurrency(g.qualifyingMonthly)}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-gray-200 bg-gray-50">
              <td className="px-6 py-3 font-bold text-gray-900">Total Qualifying</td>
              <td className="px-4 py-3"></td>
              <td className="px-6 py-3"></td>
              <td className="px-6 py-3 text-right font-bold text-gray-900">{formatCurrency(totalMonthly)}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── SourceGroupCard ─────────────────────────────────────────────────────────

function CorroboratingRows({ records, years }: { records: IncomeRecord[]; years: number[] }) {
  if (records.length === 0) return null;
  return (
    <>
      <tr>
        <td
          colSpan={years.length + 4}
          className="px-6 pt-3 pb-1"
        >
          <div className="flex items-center gap-2">
            <div className="flex-1 border-t border-dashed border-gray-300" />
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Cross-Reference</span>
            <div className="flex-1 border-t border-dashed border-gray-300" />
          </div>
        </td>
      </tr>
      {records.map((r) => {
        const annualValue = r.annualizedAmount ?? r.amount;
        return (
          <tr key={r.id} className="opacity-60 italic">
            <td className="px-6 py-1.5 text-gray-400 text-xs">{r.description || r.sourceDocName}</td>
            {years.map((y) => (
              <td key={y} className="px-4 py-1.5 text-right text-gray-400 text-xs">
                {r.year === y ? formatCurrency(annualValue) : "\u2014"}
              </td>
            ))}
            <td className="px-4 py-1.5 text-right text-gray-400 text-xs">\u2014</td>
            <td className="px-4 py-1.5 text-right text-gray-400 text-xs">\u2014</td>
            <td className="px-4 py-1.5 text-gray-400 text-[10px] truncate max-w-[120px]">{r.sourceDocName}</td>
            <td className="px-4 py-1.5">
              {r.sourceDoc && (
                <SourceDrawer
                  source={{
                    documentId: r.sourceDoc,
                    documentName: r.sourceDocName,
                    pageNumber: r.sourcePages?.[0] ?? 1,
                    exactQuote: r.exactQuote ?? "",
                  }}
                  trigger={
                    <button className="text-gray-300 hover:text-gray-500">
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  }
                />
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function SourceGroupCard({ group }: { group: SourceGroup }) {
  const [collapsed, setCollapsed] = useState(false);
  const colors = SOURCE_COLORS[group.source];
  const descRows = buildDescriptionRows(group);
  const ti = getTrendIndicator(group.trend);
  const methodLabel = `${group.qualifyingMethod}: ${formatCurrency(group.qualifyingAnnual)}/yr`;

  return (
    <Card className="overflow-hidden">
      <button
        className={`w-full flex items-center justify-between px-6 py-4 ${colors.headerBg} hover:brightness-95 transition-all`}
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className={`${colors.accent} capitalize`}>
            {SOURCE_LABELS[group.source]}
          </Badge>
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${ti.colorClass}`}>
            <TrendIcon trend={group.trend} />
            {ti.label}
          </span>
          <span className={`text-sm font-semibold ${colors.accent}`}>
            Qualifying: {formatCurrency(group.qualifyingMonthly)}/mo
          </span>
          <span className="text-xs text-gray-500" title={group.qualifyingMethodDetail}>
            ({methodLabel})
          </span>
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronUp className="h-4 w-4 text-gray-500" />}
      </button>
      {!collapsed && (
        <div>
          <div className="px-6 py-2.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-600">
            {group.qualifyingMethodDetail}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Description</th>
                {group.years.map((y) => (
                  <th key={y} className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">{y}</th>
                ))}
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Avg (Latest 2 Yrs)</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Monthly</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Doc</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {descRows.map((row) => (
                <tr key={row.description} className="hover:bg-gray-50">
                  <td className="px-6 py-2.5 text-gray-600 text-xs">{row.description || "\u2014"}</td>
                  {group.years.map((y) => (
                    <td key={y} className="px-4 py-2.5 text-right text-gray-900">
                      {row.amountByYear.has(y) ? formatCurrency(row.amountByYear.get(y)!) : "\u2014"}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right text-gray-700">{formatCurrency(row.avgAnnual)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">{formatCurrency(row.avgMonthly)}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs truncate max-w-[120px]">{row.representativeRecord.sourceDocName}</td>
                  <td className="px-4 py-2.5">
                    {row.representativeRecord.sourceDoc && (
                      <SourceDrawer
                        source={{
                          documentId: row.representativeRecord.sourceDoc,
                          documentName: row.representativeRecord.sourceDocName,
                          pageNumber: row.representativeRecord.sourcePages?.[0] ?? 1,
                          exactQuote: row.representativeRecord.exactQuote ?? "",
                        }}
                        trigger={
                          <button className="text-blue-400 hover:text-blue-600">
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                <td className="px-6 py-2.5 text-gray-700 text-xs uppercase">Annual Total</td>
                {group.years.map((y) => (
                  <td key={y} className="px-4 py-2.5 text-right text-gray-900">
                    {formatCurrency(group.annualTotals.get(y) ?? 0)}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right text-gray-900">{formatCurrency(group.twoYearAvgAnnual)}</td>
                <td className="px-4 py-2.5 text-right text-gray-900">{formatCurrency(group.qualifyingMonthly)}</td>
                <td colSpan={2}></td>
              </tr>
              <CorroboratingRows records={group.corroboratingRecords} years={group.years} />
            </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── IncomeBySourceSection ───────────────────────────────────────────────────

export function IncomeBySourceSection({ groups }: { groups: Map<IncomeSource, SourceGroup> }) {
  const order: IncomeSource[] = ["base_salary", "overtime", "commission", "bonus", "self_employment", "rental", "other_income"];
  const present = order.filter((s) => groups.has(s));
  if (present.length === 0) return null;
  return (
    <div className="space-y-3">
      {present.map((s) => <SourceGroupCard key={s} group={groups.get(s)!} />)}
    </div>
  );
}
