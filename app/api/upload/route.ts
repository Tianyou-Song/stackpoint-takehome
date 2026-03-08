import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import store from "@/lib/store";
import emitter from "@/lib/events";
import { processBatch } from "@/lib/pipeline/orchestrator";
import type { LoanDocument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), "data", "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const docs: LoanDocument[] = [];

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        continue;
      }

      const id = uuidv4();
      const safeFileName = `${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const filePath = path.join(uploadsDir, safeFileName);

      // Save file
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      const doc: LoanDocument = {
        id,
        fileName: safeFileName,
        originalName: file.name,
        documentType: "unknown",
        pageCount: 0,
        status: "pending",
        uploadedAt: new Date().toISOString(),
        filePath,
      };

      store.upsertDocument(doc);
      docs.push(doc);

      emitter.emit({ type: "document:pending", documentId: id, message: `Uploaded ${file.name}` });
    }

    if (docs.length === 0) {
      return NextResponse.json({ error: "No valid PDF files found" }, { status: 400 });
    }

    // Process asynchronously (don't await — return immediately so client gets SSE updates)
    processBatch(docs).catch((e) => console.error("Batch processing error:", e));

    return NextResponse.json({
      success: true,
      documents: docs.map((d) => ({ id: d.id, name: d.originalName })),
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
