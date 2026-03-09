"use client";

import { useState, useCallback } from "react";
import { useSSE } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SSEEvent, ValidationFinding } from "@/lib/types";
import { ShieldAlert, ShieldCheck, AlertTriangle, Info } from "lucide-react";

const SEVERITY_CONFIG = {
  error: { icon: ShieldAlert, color: "text-red-600", bg: "bg-red-50 border-red-200", badge: "destructive" as const },
  warning: { icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200", badge: "warning" as const },
  info: { icon: Info, color: "text-blue-600", bg: "bg-blue-50 border-blue-200", badge: "default" as const },
};

export default function ValidationPage() {
  const [findings, setFindings] = useState<ValidationFinding[]>([]);

  useSSE(
    useCallback((event: SSEEvent) => {
      if (event.type === "state:updated" && event.data?.validationFindings) {
        setFindings(event.data.validationFindings);
      }
    }, [])
  );

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");
  const ordered = [...errors, ...warnings, ...infos];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">Validation</h1>
        <div className="flex items-center gap-2">
          {errors.length > 0 && <Badge variant="destructive">{errors.length} error{errors.length !== 1 ? "s" : ""}</Badge>}
          {warnings.length > 0 && <Badge variant="warning">{warnings.length} warning{warnings.length !== 1 ? "s" : ""}</Badge>}
        </div>
      </div>

      {findings.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ShieldCheck className="h-10 w-10 text-green-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No validation findings yet. Upload and process documents to run checks.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {ordered.map((f) => {
            const cfg = SEVERITY_CONFIG[f.severity];
            const Icon = cfg.icon;
            return (
              <Card key={f.id} className={`border ${cfg.bg}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={cfg.badge} className="text-[10px]">
                          {f.category.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-900 font-medium">{f.message}</p>

                      {(f.field1Value || f.field2Value) && (
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          {f.field1Value && (
                            <div className="rounded bg-white/70 px-3 py-2 border border-white/50">
                              <p className="text-xs text-gray-500 mb-0.5 truncate">{f.field1DocName ?? f.field1Doc}</p>
                              {f.field1FileName && (
                                <p className="text-[10px] text-gray-400 truncate mb-0.5">{f.field1FileName}</p>
                              )}
                              <p className="text-sm font-mono text-gray-900">{f.field1Value}</p>
                            </div>
                          )}
                          {f.field2Value && (
                            <div className="rounded bg-white/70 px-3 py-2 border border-white/50">
                              <p className="text-xs text-gray-500 mb-0.5 truncate">{f.field2DocName ?? f.field2Doc ?? "Expected"}</p>
                              {f.field2FileName && (
                                <p className="text-[10px] text-gray-400 truncate mb-0.5">{f.field2FileName}</p>
                              )}
                              <p className="text-sm font-mono text-gray-900">{f.field2Value}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
