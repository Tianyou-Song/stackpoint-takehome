import fs from "fs";
import path from "path";

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface ParsedDocument {
  pageCount: number;
  pages: PageText[];
  fullText: string;
}

export async function extractTextFromPDF(filePath: string): Promise<ParsedDocument> {
  // Dynamically import pdfjs-dist to avoid SSR issues
  const pdfjsLib = await import("pdfjs-dist/build/pdf.mjs");

  // Disable worker for Node.js environment
  pdfjsLib.GlobalWorkerOptions.workerSrc = "";

  const fileBuffer = fs.readFileSync(filePath);
  const uint8Array = new Uint8Array(fileBuffer);

  const loadingTask = pdfjsLib.getDocument({
    data: uint8Array,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pages: PageText[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? (item.str ?? "") : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ pageNumber: i, text });
  }

  const fullText = pages.map((p) => `[Page ${p.pageNumber}]\n${p.text}`).join("\n\n");

  return { pageCount, pages, fullText };
}

export function saveRawText(docId: string, text: string): string {
  const rawTextDir = path.join(process.cwd(), "data", "raw-text");
  if (!fs.existsSync(rawTextDir)) fs.mkdirSync(rawTextDir, { recursive: true });
  const filePath = path.join(rawTextDir, `${docId}.txt`);
  fs.writeFileSync(filePath, text, "utf-8");
  return filePath;
}

export function readRawText(docId: string): string | null {
  const filePath = path.join(process.cwd(), "data", "raw-text", `${docId}.txt`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}
