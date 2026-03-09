import type { DocumentType, IncomeRecord, IncomeSource, IncomeTrend } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SourceGroup {
  source: IncomeSource;
  records: IncomeRecord[];
  corroboratingRecords: IncomeRecord[];
  years: number[];
  annualTotals: Map<number, number>;
  twoYearAvgAnnual: number;
  qualifyingAnnual: number;
  qualifyingMonthly: number;
  qualifyingMethod: string; // "2-yr avg" | "most recent year" | "single year"
  trend: IncomeTrend;
}

export interface DescriptionRow {
  description: string;
  amountByYear: Map<number, number>;
  representativeRecord: IncomeRecord;
  avgAnnual: number;
  avgMonthly: number;
}

export interface QualifyingResult {
  qualifying: IncomeRecord[];
  corroborating: IncomeRecord[];
}

export type QualifyingCategory = "employment" | "self_employment" | "rental" | "other";

// ─── Constants ───────────────────────────────────────────────────────────────

export const SOURCE_LABELS: Record<IncomeSource, string> = {
  base_salary:     "Base Salary",
  overtime:        "Overtime",
  commission:      "Commission",
  bonus:           "Bonus",
  self_employment: "Self-Employment",
  rental:          "Rental Income",
  other_income:    "Other Income",
};

export const SOURCE_COLORS: Record<IncomeSource, { accent: string; headerBg: string }> = {
  base_salary:     { accent: "text-blue-700",   headerBg: "bg-blue-50" },
  overtime:        { accent: "text-sky-700",    headerBg: "bg-sky-50" },
  commission:      { accent: "text-indigo-700", headerBg: "bg-indigo-50" },
  bonus:           { accent: "text-violet-700", headerBg: "bg-violet-50" },
  self_employment: { accent: "text-purple-700", headerBg: "bg-purple-50" },
  rental:          { accent: "text-green-700",  headerBg: "bg-green-50" },
  other_income:    { accent: "text-amber-700",  headerBg: "bg-amber-50" },
};

export const CATEGORY_LABELS: Record<QualifyingCategory, string> = {
  employment:      "Employment Income",
  self_employment: "Self-Employment",
  rental:          "Rental Income",
  other:           "Other Income",
};

// ─── Category mapping ────────────────────────────────────────────────────────

export function toCategory(source: IncomeSource): QualifyingCategory {
  if (["base_salary", "overtime", "commission", "bonus"].includes(source)) return "employment";
  if (source === "self_employment") return "self_employment";
  if (source === "rental") return "rental";
  return "other";
}

// ─── Document authority hierarchy ────────────────────────────────────────────
// Lower number = higher authority (wins cross-doc dedup)

function docAuthority(docType: DocumentType | undefined, source: IncomeSource): number {
  const isEmployment = ["base_salary", "overtime", "commission", "bonus"].includes(source);
  if (isEmployment) {
    switch (docType) {
      case "evoe": return 1;
      case "w2": return 2;
      case "pay_stub": return 3;
      case "tax_return_1040": return 4;
      default: return 5;
    }
  }
  switch (docType) {
    case "tax_return_1040":
    case "schedule_c": return 1;
    default: return 5;
  }
}

// ─── Qualifying income filter ────────────────────────────────────────────────
// Four stages:
//   A. Remove underwriting_total records (they double-count raw doc figures)
//   B. Remove doc_total when component records exist from same doc+source
//   C. Move isJoint records to corroborating
//   D. Cross-document dedup: for each (borrower, year, source), keep only
//      the records from the highest-authority document type

export function filterForQualifying(records: IncomeRecord[]): QualifyingResult {
  const corroborating: IncomeRecord[] = [];

  // A. Remove underwriting totals
  const withoutUnderwriting = records.filter((r) => r.kind !== "underwriting_total");

  // B. Remove doc_total when components exist from same doc+source
  const componentKeys = new Set(
    withoutUnderwriting
      .filter((r) => r.kind === "component")
      .map((r) => `${r.sourceDoc}-${r.source}`)
  );
  const withoutRedundantTotals = withoutUnderwriting.filter((r) => {
    if (r.kind !== "doc_total") return true;
    if (componentKeys.has(`${r.sourceDoc}-${r.source}`)) {
      corroborating.push(r);
      return false;
    }
    return true;
  });

  // C. Exclude joint records
  const nonJoint = withoutRedundantTotals.filter((r) => {
    if (r.isJoint || r.borrowerId === "joint") {
      corroborating.push(r);
      return false;
    }
    return true;
  });

  // D. Cross-document dedup using authority hierarchy
  const groups = new Map<string, IncomeRecord[]>();
  for (const r of nonJoint) {
    const key = `${r.borrowerId}-${r.year}-${r.source}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const qualifying: IncomeRecord[] = [];
  for (const group of groups.values()) {
    const uniqueDocTypes = new Set(group.map((r) => r.sourceDocType));
    if (uniqueDocTypes.size <= 1) {
      qualifying.push(...group);
    } else {
      const source = group[0].source;
      const bestAuthority = Math.min(...group.map((r) => docAuthority(r.sourceDocType, source)));
      for (const r of group) {
        if (docAuthority(r.sourceDocType, source) === bestAuthority) {
          qualifying.push(r);
        } else {
          corroborating.push(r);
        }
      }
    }
  }

  return { qualifying, corroborating };
}

// ─── Trending helpers ────────────────────────────────────────────────────────

export function getTrendIndicator(trend: IncomeTrend): { label: string; arrow: string; colorClass: string } {
  switch (trend) {
    case "increasing":
      return { label: "Increasing", arrow: "\u2191", colorClass: "text-green-600" };
    case "stable":
      return { label: "Stable", arrow: "\u2192", colorClass: "text-gray-500" };
    case "declining":
      return { label: "Declining", arrow: "\u2193", colorClass: "text-red-600" };
    case "insufficient_data":
      return { label: "1 year", arrow: "\u2014", colorClass: "text-gray-400" };
  }
}

// ─── Core logic ──────────────────────────────────────────────────────────────

export function groupIncomeBySource(qualifying: IncomeRecord[], corroborating: IncomeRecord[] = []): Map<IncomeSource, SourceGroup> {
  const result = new Map<IncomeSource, SourceGroup>();
  for (const r of qualifying) {
    if (!result.has(r.source)) {
      result.set(r.source, {
        source: r.source,
        records: [],
        corroboratingRecords: [],
        years: [],
        annualTotals: new Map(),
        twoYearAvgAnnual: 0,
        qualifyingAnnual: 0,
        qualifyingMonthly: 0,
        qualifyingMethod: "2-yr avg",
        trend: "insufficient_data",
      });
    }
    result.get(r.source)!.records.push(r);
  }

  // Attach corroborating records to the matching source group (only if group exists)
  for (const r of corroborating) {
    if (result.has(r.source)) {
      result.get(r.source)!.corroboratingRecords.push(r);
    }
  }

  for (const group of result.values()) {
    const totals = new Map<number, number>();
    for (const r of group.records) {
      if (!r.year) continue;
      // Prefer annualizedAmount for YTD/monthly records; fall back to raw amount
      const annualValue = r.annualizedAmount ?? r.amount;
      totals.set(r.year, (totals.get(r.year) ?? 0) + annualValue);
    }
    group.annualTotals = totals;
    group.years = Array.from(totals.keys()).sort((a, b) => a - b);

    const recentYears = group.years.slice(-2);
    const avg = recentYears.length > 0
      ? recentYears.reduce((s, y) => s + (totals.get(y) ?? 0), 0) / recentYears.length
      : 0;
    group.twoYearAvgAnnual = avg;

    // Fannie Mae trending logic
    if (recentYears.length < 2) {
      group.trend = "insufficient_data";
      group.qualifyingAnnual = recentYears.length === 1 ? (totals.get(recentYears[0]) ?? 0) : 0;
      group.qualifyingMethod = "single year";
    } else {
      const priorYear = totals.get(recentYears[0]) ?? 0;
      const recentYear = totals.get(recentYears[1]) ?? 0;
      if (recentYear < priorYear) {
        group.trend = "declining";
        group.qualifyingAnnual = recentYear;
        group.qualifyingMethod = "most recent year";
      } else if (recentYear > priorYear) {
        group.trend = "increasing";
        group.qualifyingAnnual = avg;
        group.qualifyingMethod = "2-yr avg";
      } else {
        group.trend = "stable";
        group.qualifyingAnnual = avg;
        group.qualifyingMethod = "2-yr avg";
      }
    }
    group.qualifyingMonthly = group.qualifyingAnnual / 12;
  }
  return result;
}

export function buildDescriptionRows(group: SourceGroup): DescriptionRow[] {
  const byDesc = new Map<string, IncomeRecord[]>();
  for (const r of group.records) {
    const key = r.description ?? "";
    if (!byDesc.has(key)) byDesc.set(key, []);
    byDesc.get(key)!.push(r);
  }
  return Array.from(byDesc.entries()).map(([desc, recs]) => {
    const amountByYear = new Map<number, number>();
    for (const r of recs) {
      if (!r.year) continue;
      const annualValue = r.annualizedAmount ?? r.amount;
      amountByYear.set(r.year, (amountByYear.get(r.year) ?? 0) + annualValue);
    }
    const recentYears = group.years.slice(-2);
    const avg = recentYears.length > 0
      ? recentYears.reduce((s, y) => s + (amountByYear.get(y) ?? 0), 0) / recentYears.length
      : 0;
    return { description: desc, amountByYear, representativeRecord: recs[0], avgAnnual: avg, avgMonthly: avg / 12 };
  });
}
