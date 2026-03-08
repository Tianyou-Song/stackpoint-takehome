# Loan Document Extraction System

An unstructured data extraction system for mortgage loan documents. Upload PDFs via a drag-and-drop UI; the system extracts PII and structured borrower records with source document provenance, updating the UI in real-time as each document is processed.

## Quick Start

### Prerequisites
- Node.js 18+
- A Google Gemini API key ([get one free](https://aistudio.google.com/app/apikey))

### Setup

```bash
# Install dependencies
npm install

# Add your API key
echo "GOOGLE_API_KEY=your_key_here" > .env.local

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Using the App

1. **Upload** — Drag-and-drop PDF loan documents onto the upload zone (single or batch). The system processes each file immediately.
2. **Watch it process** — Real-time progress updates via SSE: Parsing → Extracting → Completed.
3. **Explore results** — Navigate to Borrowers, Income, Documents, or Validation pages.
4. **Delete** — Remove a document from the Documents page; data re-aggregates live.

## Architecture

See [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) for the full system design document.

### High-level pipeline

```
Upload PDFs → Save to data/uploads/
           → pdfjs-dist: extract page-level text
           → Gemini API: single-pass extraction with universal JSON schema
           → Assembler: merge all documents into Borrower/Loan/Income/Account objects
           → Validator: cross-document SSN and income consistency checks
           → SSE: push updated state to all connected browsers
           → Persist to data/extraction-results.json
```

### Tech choices

| Concern | Choice | Reason |
|---------|--------|--------|
| Framework | Next.js 15 (App Router) | Full-stack, API routes, SSR |
| LLM | Gemini 3 Flash (preview) | Top ExtractBench score, structured JSON output via `responseSchema` |
| PDF parsing | pdfjs-dist | Page-level text, no OCR dependency, runs in Node |
| Real-time | Server-Sent Events | One-way push, no WebSocket overhead |
| Storage | In-memory + JSON file | Zero-config for a POC; trivially swappable for Postgres |
| UI | Tailwind CSS + Radix UI | Polished without heavy component library |
| Charts | Recharts | Income history visualization |

### Project structure

```
app/                    # Next.js App Router pages
  api/                  # API routes (upload, documents, borrowers, events, loan, validation)
  borrowers/[id]/       # Borrower detail: PII, income chart, accounts
  documents/[id]/       # Document detail: extracted fields, raw text
  income/               # Income analysis + cross-doc reconciliation
  validation/           # Validation findings

lib/
  types.ts              # All TypeScript interfaces
  store.ts              # In-memory store + JSON persistence
  events.ts             # SSE event emitter
  ai/                   # Gemini client, universal extraction schema, prompt
  pdf/                  # pdfjs-dist wrapper
  pipeline/             # orchestrator, assembler, validator

components/
  upload/               # Drag-and-drop zone
  provenance/           # Source drawer (click any field to see page + quote)
  layout/               # Sidebar nav
  ui/                   # Button, Badge, Card, Progress

data/                   # Runtime data (gitignored)
  extraction-results.json
  uploads/
  raw-text/
```

## Key Design Decisions

**Single-pass extraction**: One universal Zod/JSON schema covering every possible loan field. Gemini fills in what it finds per document; missing fields return null. No document classification step needed — Gemini identifies the `documentType` as part of extraction.

**Source provenance**: Every extracted field carries `documentId + pageNumber + exactQuote`. Click any field in the UI to open a drawer showing where the value came from.

**Cross-document validation**: After every upload or delete, the validator runs SSN consistency checks (Mary Homeowner's SSN differs between the 1040 and underwriting summary), income discrepancy detection, and entity mismatch detection (Title Report belongs to a different transaction).

**SSE for real-time updates**: Each pipeline stage emits an SSE event. The `useSSE` hook merges state updates into React state without polling.

## Known Quirks in the Sample Data

- **Title Report**: belongs to Robert/Andrea VanAssen (FL property), not the Homeowner transaction — flagged as entity mismatch
- **Mary's SSN**: `500-22-2000` on the 1040 vs `500-60-2222` on the underwriting summary — flagged as SSN mismatch error
- **Income sources**: John has W-2 wages + Schedule C self-employment income across multiple tax years

## Scaling (see System Design for details)

- **10x**: Add a job queue (BullMQ/Redis) instead of `Promise.allSettled`; move storage to Postgres; use Next.js API routes behind a load balancer.
- **100x**: Separate extraction workers (containerized), vector store for semantic retrieval, streaming LLM responses, multi-tenant data isolation.
