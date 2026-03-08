"use client";

import { useState, useCallback } from "react";
import { useSSE } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import type { SSEEvent, Borrower } from "@/lib/types";
import Link from "next/link";
import { Users } from "lucide-react";

export default function BorrowersPage() {
  const [borrowers, setBorrowers] = useState<Borrower[]>([]);

  useSSE(
    useCallback((event: SSEEvent) => {
      if (event.type === "state:updated" && event.data?.borrowers) {
        setBorrowers(event.data.borrowers);
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
          {borrowers.map((b) => (
            <Link key={b.id} href={`/borrowers/${b.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{b.fullName ?? "Unknown"}</CardTitle>
                    <Badge variant={b.role === "primary" ? "default" : "secondary"}>
                      {b.role === "primary" ? "Primary" : "Co-Borrower"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {b.ssn && <Row label="SSN" value={b.ssn} />}
                  {b.employer && <Row label="Employer" value={b.employer} />}
                  {b.jobTitle && <Row label="Title" value={b.jobTitle} />}
                  {b.annualSalary && <Row label="Salary" value={formatCurrency(b.annualSalary)} />}
                  {b.phone && <Row label="Phone" value={b.phone} />}
                  {b.email && <Row label="Email" value={b.email} />}
                  {b.currentAddress?.full && <Row label="Address" value={b.currentAddress.full} />}
                  <p className="text-xs text-gray-400 pt-1">Source: {b.sources.length} document{b.sources.length !== 1 ? "s" : ""}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 w-20 shrink-0">{label}</span>
      <span className="text-gray-900 truncate">{value}</span>
    </div>
  );
}
