# Loan Document Extraction System

An unstructured data extraction system for mortgage loan documents. Upload PDFs via a drag-and-drop UI; the system extracts PII and structured borrower records with source document provenance, updating the UI in real-time as each document is processed. This is a proof-of-concept demonstrating the extraction pipeline — see [Future Directions](#future-directions) for what productionizing would entail.

## Quick Start

### Prerequisites
- Node.js 18+
- A Google Gemini API key ([get one free](https://aistudio.google.com/app/apikey))

### Setup

```bash
# Install dependencies
npm install

# Add your API key
cp .env.example .env.local
# then edit .env.local and replace the placeholder with your key

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Using the App

1. **Upload** — Drag-and-drop PDF loan documents onto the upload zone (single or batch). The system processes each file immediately.
2. **Watch it process** — Real-time progress updates via SSE: Extracting → Completed.
3. **Explore results** — Navigate to Borrowers, Income, Documents, or Validation pages.
4. **Delete** — Remove a document from the Documents page; data re-aggregates live.

## Architecture

See [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md) for the full system design document.

### High-level pipeline

```
Upload PDFs → Save to data/uploads/
           → Gemini API: direct PDF extraction (base64 inlineData) with universal JSON schema
           → Assembler: merge all documents into Borrower/Loan/Income/Account objects
           → Validator: cross-document SSN and income consistency checks
           → SSE: push updated state to all connected browsers
           → Persist to data/extraction-results.json
```

### Tech choices

| Concern | Choice | Reason |
|---------|--------|--------|
| Framework | Next.js 15 (App Router) | Full-stack, API routes, SSR |
| LLM | Gemini 3 Flash (preview) | Top ExtractBench score, native PDF input (base64 inlineData), structured JSON via `responseSchema` |
| Real-time | Server-Sent Events | One-way push, no WebSocket overhead |
| Storage | In-memory + JSON file | Zero-config for a POC; trivially swappable for Postgres |
| UI | Tailwind CSS + Radix UI | Polished without heavy component library |
| Charts | Recharts | Income history visualization |

### Project structure

```
app/                    # Next.js App Router pages
  api/                  # API routes (upload, documents, borrowers, events, loan, validation)
  borrowers/[id]/       # Borrower detail: PII, income chart, accounts
  documents/[id]/       # Document detail: extracted fields
  income/               # Income analysis + cross-doc reconciliation
  validation/           # Validation findings

lib/
  types.ts              # All TypeScript interfaces
  store.ts              # In-memory store + JSON persistence
  events.ts             # SSE event emitter
  ai/                   # Gemini client, universal extraction schema, prompt
  pipeline/             # orchestrator, assembler, validator

components/
  upload/               # Drag-and-drop zone
  provenance/           # Source drawer (click any field to see page + quote)
  layout/               # Sidebar nav
  ui/                   # Button, Badge, Card, Progress

data/                   # Runtime data (gitignored)
  extraction-results.json
  uploads/
```

## Key Design Decisions

**Single-pass extraction**: One universal Zod/JSON schema covering every possible loan field. Gemini fills in what it finds per document; missing fields return null. No document classification step needed — Gemini identifies the `documentType` as part of extraction.

**Source provenance**: Every extracted field carries `documentId + pageNumber + exactQuote`. Click any field in the UI to open a drawer showing where the value came from.

**Cross-document validation**: After every upload or delete, the validator runs SSN consistency checks (Mary Homeowner's SSN differs between the 1040 and underwriting summary), income discrepancy detection, and entity mismatch detection (Title Report belongs to a different transaction).

**SSE for real-time updates**: Each pipeline stage emits an SSE event. The `useSSE` hook merges state updates into React state without polling.

## Testing

Test coverage was intentionally deferred at this POC stage. Industry practice for demos and spikes is to validate via manual end-to-end testing (upload the sample PDFs, verify extracted fields, confirm provenance drawers, trigger error paths) rather than investing in unit/integration tests for code that may be substantially restructured before production. See [Future Directions](#future-directions) for what a production test strategy would include.

## Known Quirks in the Sample Data

- **Title Report**: belongs to Robert/Andrea VanAssen (FL property), not the Homeowner transaction — flagged as entity mismatch
- **Mary's SSN**: `500-22-2000` on the 1040 vs `500-60-2222` on the underwriting summary — flagged as SSN mismatch error
- **Income sources**: John has W-2 wages + Schedule C self-employment income across multiple tax years

## Future Directions

The full scaling story is in [`SYSTEM_DESIGN.md §9`](SYSTEM_DESIGN.md). Beyond raw throughput, productionizing this system would involve:

1. **Database layer** — Replace the in-memory + JSON store with PostgreSQL (via Prisma) for durability, concurrent writes, transactions, and query flexibility.
2. **Test coverage** — Unit tests for assembler merge logic and validator checks; integration tests for the extraction pipeline with fixture PDFs and mocked Gemini responses; E2E tests (Playwright) for the upload → dashboard flow.
3. **Authentication & multi-tenancy** — JWT/session auth on all API routes; tenant-scoped data isolation (loan file ID + org ID); row-level security in Postgres.
4. **Backend service separation** — Extract the pipeline into a standalone worker service (e.g., a Node.js worker or FastAPI service) behind a job queue, fully decoupled from the Next.js frontend.
5. **Job queue & retries** — BullMQ + Redis for reliable async processing with dead-letter queues and configurable retry back-off. Critically, this also handles Gemini API rate limits: a per-document job queue can enforce concurrency limits, catch 429/503 responses, and apply exponential back-off before retrying — so a burst of uploads doesn't exhaust the API quota or silently drop documents.
6. **PDF storage** — Move `data/uploads/` to S3/GCS object storage; workers download from object storage rather than local disk.
7. **Observability** — OpenTelemetry traces through pipeline stages, structured logging, Gemini token usage tracking per tenant, and error-rate alerting.
