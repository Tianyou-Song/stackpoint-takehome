"use client";

import { useState, useCallback } from "react";
import { useSSE } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import type { SSEEvent, Borrower, IncomeRecord, Account } from "@/lib/types";
import { filterForQualifying, groupIncomeBySource } from "@/lib/income";
import Link from "next/link";
import { Users } from "lucide-react";

export default function BorrowersPage() {
  const [borrowers, setBorrowers] = useState<Borrower[]>([]);
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useSSE(
    useCallback((event: SSEEvent) => {
      if (event.type === "state:updated" && event.data) {
        if (event.data.borrowers) setBorrowers(event.data.borrowers);
        if (event.data.incomeRecords) setIncomeRecords(event.data.incomeRecords);
        if (event.data.accounts) setAccounts(event.data.accounts);
      }
    }, [])
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Borrowers</h1>

      {borrowers.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No borrowers extracted yet. Upload documents on the dashboard.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {borrowers.map((b) => {
            const borrowerIncome = incomeRecords.filter((r) => r.borrowerId === b.id);
            const borrowerAccounts = accounts.filter((a) => a.borrowerId === b.id);
            const qualifyingMonthly = computeQualifyingMonthly(borrowerIncome);
            // Flag borrowers with no PII and no income — likely from an unrelated document (e.g. title report)
            const isUnrelated = !b.ssn && !b.employer && !b.email && !b.phone && borrowerIncome.length === 0;
            return (
              <Link key={b.id} href={`/borrowers/${b.id}`}>
                <Card className={`hover:shadow-md transition-shadow cursor-pointer h-full ${isUnrelated ? "opacity-60 border-dashed" : ""}`}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="truncate">{b.fullName ?? "Unknown"}</CardTitle>
                      <div className="flex gap-1.5 shrink-0">
                        {isUnrelated && (
                          <Badge variant="destructive">Unrelated Entity</Badge>
                        )}
                        <Badge variant={b.role === "primary" ? "default" : "secondary"}>
                          {b.role === "primary" ? "Primary" : "Co-Borrower"}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {isUnrelated ? (
                      <p className="text-xs text-amber-600">No PII or income extracted. This entity may be from an unrelated document — see Validation for details.</p>
                    ) : (
                      <>
                        {b.ssn && <Row label="SSN" value={b.ssn} />}
                        {b.employer && <Row label="Employer" value={b.employer} />}
                        {b.jobTitle && <Row label="Title" value={b.jobTitle} />}
                        {b.annualSalary && <Row label="Salary" value={formatCurrency(b.annualSalary)} />}
                        {b.phone && <Row label="Phone" value={b.phone} />}
                        {b.email && <Row label="Email" value={b.email} />}
                        {b.currentAddress?.full && <Row label="Address" value={b.currentAddress.full} />}
                      </>
                    )}
                    {/* Summary metrics */}
                    <div className="pt-2 mt-2 border-t border-gray-100 flex gap-4">
                      {qualifyingMonthly > 0 && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase">Qualifying Income</p>
                          <p className="text-sm font-semibold text-gray-900">{formatCurrency(qualifyingMonthly)}/mo</p>
                        </div>
                      )}
                      {borrowerAccounts.length > 0 && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase">Accounts</p>
                          <p className="text-sm font-semibold text-gray-900">{borrowerAccounts.length}</p>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 pt-1">Source: {b.sources.length} document{b.sources.length !== 1 ? "s" : ""}</p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function computeQualifyingMonthly(records: IncomeRecord[]): number {
  if (records.length === 0) return 0;
  const { qualifying, corroborating } = filterForQualifying(records);
  const groups = groupIncomeBySource(qualifying, corroborating);
  let total = 0;
  for (const g of groups.values()) total += g.qualifyingMonthly;
  return total;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 w-20 shrink-0">{label}</span>
      <span className="text-gray-900 truncate">{value}</span>
    </div>
  );
}
