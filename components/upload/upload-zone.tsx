"use client";

import { useCallback, useState } from "react";
import { Upload, Loader2, CheckCircle2, XCircle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileStatus {
  name: string;
  status: "uploading" | "processing" | "done" | "error";
}

interface UploadZoneProps {
  onUploaded?: (docIds: string[]) => void;
}

export function UploadZone({ onUploaded }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<FileStatus[]>([]);

  const upload = useCallback(
    async (selectedFiles: File[]) => {
      const pdfs = selectedFiles.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (pdfs.length === 0) return;

      setFiles(pdfs.map((f) => ({ name: f.name, status: "uploading" })));

      const form = new FormData();
      pdfs.forEach((f) => form.append("files", f));

      try {
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        setFiles(pdfs.map((f) => ({ name: f.name, status: "processing" })));
        onUploaded?.(data.documents?.map((d: { id: string }) => d.id) ?? []);
        // Clear after a bit
        setTimeout(() => setFiles([]), 8000);
      } catch {
        setFiles(pdfs.map((f) => ({ name: f.name, status: "error" })));
      }
    },
    [onUploaded]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      upload(Array.from(e.dataTransfer.files));
    },
    [upload]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      upload(Array.from(e.target.files ?? []));
      e.target.value = "";
    },
    [upload]
  );

  return (
    <div className="space-y-3">
      <label
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors py-10",
          dragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".pdf"
          multiple
          className="sr-only"
          onChange={onInputChange}
        />
        <Upload className={cn("h-8 w-8", dragging ? "text-blue-500" : "text-gray-400")} />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">
            Drop PDFs here or <span className="text-blue-600">browse</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">Supports single or batch upload</p>
        </div>
      </label>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.name} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <FileText className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="flex-1 truncate text-gray-700">{f.name}</span>
              {f.status === "uploading" && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
              {f.status === "processing" && <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />}
              {f.status === "done" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
              {f.status === "error" && <XCircle className="h-4 w-4 text-red-500" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
