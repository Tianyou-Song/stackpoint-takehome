# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Take-home assignment: build an unstructured data extraction system from mortgage loan documents.

**Choice made:** Loan Documents (`Engineer take home docs 2026/Loan Documents/Loan 214/`) — extract PII and structured borrower records with source provenance from 10 PDFs.

**Deliverables:**
- `README.md` — setup instructions + architecture decisions
- `docs/SYSTEM_DESIGN.md` — architecture diagram, pipeline design, LLM strategy, scaling
- Working Next.js app (this repo)

## Tech Stack

| Concern | Choice |
|---------|--------|
| Framework | Next.js 15, App Router, TypeScript |
| LLM | Gemini 3 Flash (preview) via `@google/generative-ai` |
| PDF parsing | `pdfjs-dist` (v5, legacy build, Node.js) |
| Real-time | Server-Sent Events (SSE) |
| Storage | In-memory singleton + JSON file (`data/extraction-results.json`) |
| UI | Tailwind CSS v4 + Radix UI primitives + Recharts |

## Project Structure

```
app/
  api/upload/route.ts          # POST: accept PDFs, trigger pipeline async
  api/events/route.ts          # GET: SSE stream (real-time updates)
  api/documents/route.ts       # GET: all documents
  api/documents/[id]/route.ts  # GET: detail + raw text; DELETE: remove + re-aggregate
  api/borrowers/route.ts       # GET: all borrowers
  api/borrowers/[id]/route.ts  # GET: borrower + income + accounts
  api/loan/route.ts            # GET: loan overview
  api/validation/route.ts      # GET: validation findings
  page.tsx                     # Dashboard: upload zone + live stats + borrower cards
  borrowers/page.tsx           # Borrower list
  borrowers/[id]/page.tsx      # PII grid + income chart + accounts
  documents/page.tsx           # Document grid + delete buttons
  documents/[id]/page.tsx      # Extracted fields table + raw text
  income/page.tsx              # Income chart + cross-doc reconciliation
  validation/page.tsx          # Validation findings

lib/
  types.ts                     # All TypeScript interfaces — the source of truth
  store.ts                     # In-memory singleton + JSON read/write
  events.ts                    # SSE emitter singleton
  utils.ts                     # cn(), formatCurrency(), formatDate(), formatPercent()
  pdf/parser.ts                # pdfjs-dist: extractTextFromPDF(), saveRawText(), readRawText()
  ai/client.ts                 # Gemini client (model: gemini-3-flash-preview)
  ai/schema.ts                 # Universal JSON schema for responseSchema
  ai/prompt.ts                 # Extraction system prompt
  ai/extract.ts                # extractFromDocument(): text → DocumentExtraction
  pipeline/orchestrator.ts     # processDocument(), processBatch(), reaggregate(), deleteDocumentAndReaggregate()
  pipeline/assembler.ts        # assembleFromExtractions(): merge all docs → Loan/Borrower/Income/Account
  pipeline/validator.ts        # runValidation(): SSN mismatch, income discrepancy, entity mismatch

components/
  layout/sidebar.tsx           # Nav sidebar
  upload/upload-zone.tsx       # Drag-and-drop + file picker
  provenance/source-drawer.tsx # Slide-out drawer: doc + page + exact quote
  ui/badge.tsx                 # Badge component
  ui/button.tsx                # Button component
  ui/card.tsx                  # Card, CardHeader, CardTitle, CardContent
  ui/progress.tsx              # Progress bar

hooks/
  useSSE.ts                    # EventSource hook; merges state:updated into React state

data/                          # Runtime, gitignored
  extraction-results.json      # Persisted system state
  uploads/                     # Saved PDF files
  raw-text/                    # Per-document extracted text

docs/
  SYSTEM_DESIGN.md             # Required deliverable
```

## Key Patterns

**Pipeline flow (per document):**
`pending → parsing → parsed → extracting → extracted → completed`
Each stage emits an SSE event. After a batch completes, `reaggregate()` runs assembler + validator and emits `state:updated` with the full new state.

**Single-pass LLM extraction:**
One universal `responseSchema` (all loan fields, all optional). Gemini fills what it finds and identifies the `documentType`. No separate classification step.

**Store pattern:**
`store.ts` is a singleton. Call `store.init()` (idempotent) before use. All API routes read from and write to this store. SSE events carry full state slices — the browser merges them into React state.

**SSE pattern:**
`emitter.emit(event)` in `lib/events.ts` reaches all connected browsers. `useSSE(callback)` in the browser subscribes. Ping every 25s keeps connections alive.

## Environment

- `GOOGLE_API_KEY` must be in `.env.local`
- `npm run dev` starts the dev server at localhost:3000
- `npx next build` for production build

## Known Data Quirks (sample corpus)

- **Title Report**: belongs to Robert/Andrea VanAssen (FL), not the Homeowner loan — flagged as entity mismatch
- **Mary's SSN**: `500-22-2000` on the 1040 vs `500-60-2222` on the underwriting summary — flagged as SSN mismatch error
- **Income**: John has W-2 wages + Schedule C self-employment across multiple tax years

## Tailwind v4 Notes

- No `tailwind.config.ts` — config is CSS-based
- Import in CSS: `@import "tailwindcss"`
- PostCSS plugin: `@tailwindcss/postcss` (not `tailwindcss` directly)

## pdfjs-dist v5 Notes

- Import from `pdfjs-dist/legacy/build/pdf.mjs` (not the default entry)
- Set `GlobalWorkerOptions.workerSrc = ""` for Node.js (no worker thread)
- TextItem check: `"str" in item` (not type casting) — items can be `TextItem | TextMarkedContent`
