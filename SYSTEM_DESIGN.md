# System Design: Loan Document Extraction System

## 1. Overview

A web-based pipeline that ingests unstructured mortgage loan PDFs, extracts structured data (borrower PII, income records, account details, loan terms) using an LLM, validates consistency across documents, and presents results through a real-time dashboard with source provenance.

> **POC scope**: This document describes a proof-of-concept implementation. Architectural choices prioritize speed of iteration and demonstrability over production hardening. See §9 (Scaling) and §10 (Testing Strategy) for what a production system would add.

**Framework choice — Next.js 15**: Next.js was selected because it colocates the React UI and API routes in a single repository and process, eliminating the need for a separate backend service during the POC phase. A single `npm run dev` command starts the full stack (pages, REST endpoints, SSE stream), making the demo immediately runnable by any reviewer. App Router file-based routing reduces boilerplate; TypeScript support is first-class; and the Node.js runtime is well-suited to streaming SSE responses and async pipeline processing.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│  ┌──────────────┐   Upload (multipart)  ┌─────────────────────────┐ │
│  │  Upload Zone │──────────────────────▶│  POST /api/upload       │ │
│  └──────────────┘                       └────────────┬────────────┘ │
│                                                      │              │
│  ┌──────────────┐   SSE stream          ┌────────────▼────────────┐ │
│  │  useSSE hook │◀──────────────────────│  GET /api/events        │ │
│  └──────────────┘                       └─────────────────────────┘ │
│         │                                                           │
│  React state update → re-render all pages                           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Next.js Server (Node.js)                                           │
│                                                                     │
│  POST /api/upload                                                   │
│       │                                                             │
│       ├─ Save PDF to data/uploads/{uuid}-{name}.pdf                 │
│       ├─ Create Document record (status: pending)                   │
│       └─ processBatch(docs) — runs in background, returns 200       │
│                                                                     │
│  Per-document pipeline (parallel):                                  │
│  ┌────────────────────────┐   ┌──────────────┐   ┌─────────────┐    │
│  │  Extract               │──▶│  Upsert      │──▶│  Mark done  │    │
│  │  Gemini (PDF base64)   │   │  extraction  │   │             │    │
│  └────────────────────────┘   └──────────────┘   └─────────────┘    │
│         │                                               │           │
│  SSE emit (extracting)                          SSE emit (completed)│
│                                                                     │
│  reaggregate() — runs once after batch completes:                   │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────────────────┐   │
│  │  Assembler   │──▶│   Validator    │──▶│  store.setAggregated │   │
│  │ (merge all   │   │ (SSN/income/   │   │  + persist JSON      │   │
│  │ extractions) │   │  entity checks)│   │  + SSE state:updated │   │
│  └──────────────┘   └────────────────┘   └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Storage (file system)                                              │
│  data/                                                              │
│    extraction-results.json  ← full system state, rehydrated on boot │
│    uploads/{uuid}-{name}.pdf                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Pipeline Design

### Stage 1: Ingest
- Accept multipart form upload (single or batch).
- Validate MIME type (PDF only).
- Generate UUID, save file to `data/uploads/`.
- Create `LoanDocument` record with `status: pending`.
- Emit SSE `document:pending`.
- Return HTTP 200 immediately; processing is async.

### Stage 2: Extract (Gemini API — single pass, native PDF input)
- Read PDF file from `data/uploads/`, encode as base64.
- Send PDF as `inlineData` (`mimeType: "application/pdf"`) alongside the extraction prompt.
- Gemini reads layout, tables, and scanned content directly — no text flattening step.
- Gemini returns structured JSON with all findable fields including `pageCount`.
- Schema covers: borrower PII, co-borrower PII, income records (array), bank accounts (array), loan terms, document type.
- Each field in the `fields` array includes `pageNumber` and `exactQuote` for provenance.
- Parse JSON response, build `DocumentExtraction` object.
- Upsert extraction to in-memory store.
- Emit SSE `document:extracted`.

### Stage 3: Aggregate (after batch completes)
**Assembler:**
- Entity resolution: normalize borrower names, match across documents.
- Merge loan fields (first-seen wins for scalar fields).
- Deduplicate income records (same borrower + year + source + amount + doc).
- Deduplicate accounts (same institution + account number + doc).

**Validator:**
- SSN consistency: collect all SSNs per borrower across all documents; flag if any differ.
- Income discrepancy: flag if same borrower + year + source appears in >1 doc with >10% variance.
- Entity mismatch: if Title Report names don't match known borrowers, flag as warning.

**Persist:**
- Write full state to `data/extraction-results.json`.
- Emit SSE `state:updated` with full updated state.

### Stage 4: Delete & Re-aggregate
- Remove PDF from `data/uploads/`.
- Remove document + extraction from store.
- Re-run assembler + validator on remaining documents.
- Emit SSE `document:deleted` + `state:updated`.

---

## 4. AI/LLM Integration Strategy

### Model selection
**Gemini 3 Flash (preview)** — selected for its top score on ExtractBench (arxiv.org/html/2602.12247v2), the benchmark specifically designed for structured data extraction from documents. Flash variant provides excellent speed/cost at minimal quality trade-off.

### Single-pass universal schema approach
Instead of a multi-step pipeline (classify → route → extract), we use one universal schema containing every possible field across all document types. Gemini fills in what it finds; missing fields return `null`. This approach:
- Eliminates a classification API call
- Handles mixed-format documents gracefully
- Requires only one prompt engineering effort
- Degrades gracefully (unknown doc type returns partial data)

### Structured output
We use Gemini's `responseSchema` (native JSON schema constraint) rather than prompt-based JSON. This guarantees:
- Valid JSON output (no parsing failures from markdown fences)
- Correct field types (numbers as numbers, arrays as arrays)
- No hallucinated field names

### Provenance via the `fields` array
Every extraction returns a `fields[]` array in addition to the top-level named fields. Each entry has `fieldName`, `fieldValue`, `pageNumber`, `exactQuote`, and `confidence`. This powers the source provenance drawer in the UI.

### Rate limiting & API failure handling

**Free-tier availability caveat**: AI Studio API keys run on shared, best-effort capacity. During demand spikes, Gemini returns `503 Service Unavailable` regardless of the caller's own quota usage — this is a Google-side capacity issue, not a per-key rate limit. For a production deployment, use [Vertex AI](https://cloud.google.com/vertex-ai) with [Provisioned Throughput](https://cloud.google.com/vertex-ai/generative-ai/docs/provisioned-throughput). No tier within Google AI Studio — free or paid — guarantees uninterrupted access during peak usage; 503s reflect shared infrastructure contention. Vertex AI Provisioned Throughput allocates dedicated model capacity (gen units/sec) to your project, providing a capacity SLA. AI Studio keys (any tier) are suitable for development and demos only.

The POC calls Gemini once per document with no retry logic. In production:
- Wrap every Gemini call in a queue job (BullMQ) so concurrency to the API is bounded.
- On 429 (quota exceeded) or 503 (transient failure), apply exponential back-off with jitter and re-enqueue the job — Gemini Flash has per-minute token and request limits that a batch upload can easily hit.
- Set a max-attempts threshold; permanently failed jobs move to a dead-letter queue and mark the document `error` with the last failure reason.
- Track quota headroom via Gemini's `x-ratelimit-remaining-requests` / `x-ratelimit-remaining-tokens` headers and proactively throttle before hitting the limit.

### Prompt design
The system prompt instructs the model to:
- Return actual SSN values (masking handled in code)
- Return dollar amounts as numbers without formatting
- Create one income record per source per year
- Identify document type as part of extraction

---

## 5. Data Model

```typescript
SystemState {
  loan: Loan                        // Scalar loan fields, first-seen wins
  borrowers: Borrower[]             // Entity-resolved borrower list
  incomeRecords: IncomeRecord[]     // Per-borrower, per-year, per-source
  accounts: Account[]               // Bank/financial accounts
  documents: LoanDocument[]         // Upload + processing metadata
  extractions: DocumentExtraction[] // Raw LLM output per document
  extractedFields: ExtractedField[] // All fields with provenance
  validationFindings: Finding[]     // Cross-document issues
}
```

Every `IncomeRecord` and `Account` carries `sourceDoc + sourceDocName` for traceability. Every `Borrower` has a `sources[]` array listing which documents confirmed it. Every `ExtractedField` has `documentId + pageNumber + exactQuote`.

---

## 6. API Design

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/upload | Accept PDF(s), trigger pipeline, return document IDs |
| GET | /api/events | SSE stream for real-time updates |
| GET | /api/documents | All documents with status |
| GET | /api/documents/[id] | Document detail + extraction |
| DELETE | /api/documents/[id] | Delete document, trigger re-aggregation |
| GET | /api/loan | Loan overview |
| GET | /api/borrowers | All borrowers |
| GET | /api/borrowers/[id] | Borrower + income records + accounts |
| GET | /api/validation | All validation findings |

---

## 7. Real-time Updates (SSE)

The server maintains a list of connected SSE clients in memory. Each pipeline stage emits a typed event:

```
document:pending → document:extracting → document:extracted → document:completed
state:updated (after aggregation)
document:deleted (after deletion)
```

The browser's `useSSE` hook merges `state:updated` payloads into React state, which re-renders all pages without polling.

SSE was chosen over WebSockets because:
- The flow is one-directional (server → client)
- Built-in reconnection
- Works through HTTP/2 proxies
- No additional library needed

---

## 8. Error Handling

| Scenario | Handling |
|----------|----------|
| Non-PDF upload | Filtered server-side; skipped silently |
| Gemini API failure | Document marked `error` with message; other docs continue |
| Gemini rate limit (429) | POC: document marked `error`. Production: job re-enqueued with exponential back-off via BullMQ; transparent to user until max retries exceeded |
| Gemini transient error (503/500) | Same as rate limit — re-enqueue with back-off |
| Gemini returns invalid JSON | Error logged; document marked `error` |
| Gemini PDF processing failure | Document marked `error`; pipeline continues for other docs |
| File system error on delete | Logged; store still cleaned up |
| Server restart | State rehydrated from `data/extraction-results.json` |
| SSE client disconnect | Client removed from list on next emit |

---

## 9. Scaling Considerations

### Current (POC)
- Single Next.js process
- In-memory state (lost on restart, rehydrated from JSON)
- Synchronous per-document processing within `Promise.allSettled`
- All SSE clients share one Node.js process

### 10x (hundreds of documents/day)

1. **Queue**: Replace `Promise.allSettled` with BullMQ + Redis. Upload API enqueues one job per document; workers process independently with bounded concurrency to the Gemini API. Rate-limit responses (429) and transient errors (503) trigger exponential back-off and automatic re-enqueue; documents that exhaust max retries go to a dead-letter queue and are marked `error`. This prevents a batch upload from exhausting the Gemini per-minute quota and silently dropping documents.
2. **Database**: Replace JSON file with PostgreSQL (Prisma). Enables concurrent writes, proper transactions, indexing for fast queries.
3. **Horizontal scaling**: Stateless Next.js API behind a load balancer. SSE clients need sticky sessions or a Redis pub/sub adapter so events reach all browser connections.
4. **PDF storage**: Move `data/uploads/` to S3/GCS. Workers download from object storage.

### 100x (thousands of documents/day, multi-tenant)

1. **Dedicated extraction service**: Containerized worker pool (Kubernetes) pulling from a distributed queue (SQS or Kafka). Scales independently of the API layer.
2. **Streaming extraction**: Gemini supports streaming responses. For large documents, stream field-by-field and emit SSE events as fields arrive rather than waiting for the full response.
3. **Vector store**: Add pgvector or Pinecone to enable semantic search across extracted text (e.g., "find all documents mentioning a lien on property X").
4. **Multi-tenancy**: Tenant-scoped data (loan file ID + org ID), row-level security in Postgres, separate S3 prefixes.
5. **Scanned PDFs**: Gemini handles scanned PDFs natively via its vision capability — no OCR fallback needed.
6. **Caching**: Cache Gemini responses (hash of document text → extraction) to avoid re-processing unchanged files.
7. **Monitoring**: OpenTelemetry traces through pipeline stages; Gemini token usage tracking per tenant; alerting on extraction error rates.

### Additional future directions (beyond throughput)

- **Authentication & RBAC**: JWT/session auth on all API routes; role-based access control (e.g., loan officer vs. underwriter vs. auditor views).
- **Test coverage**: See §11 for the full testing strategy — unit, integration, E2E, and regression layers.
- **Backend service separation**: Decouple the extraction pipeline from the Next.js server into a standalone worker service behind a job queue, so the frontend can be scaled and deployed independently.
- **Observability**: Structured logging with correlation IDs, OpenTelemetry distributed tracing end-to-end (browser → API → Gemini), and SLO-based alerting.

---

## 10. Testing Strategy

### POC validation (current)
Manual end-to-end testing: upload the 10 sample PDFs, verify extracted fields in the UI, confirm provenance drawers show the correct page and quote, trigger error paths (non-PDF upload, missing fields), and inspect validation findings for known data quirks (SSN mismatch, entity mismatch).

### Production test strategy

| Layer | Approach |
|-------|----------|
| Unit | Assembler merge logic (entity resolution, deduplication), validator checks (SSN consistency, income variance), schema parsing edge cases |
| Integration | Extraction pipeline with fixture PDFs and mocked Gemini responses (verify correct `DocumentExtraction` shape without hitting the API) |
| E2E | Playwright: upload → real-time progress → borrower detail → provenance drawer → delete → re-aggregation |
| Regression | Golden-file snapshots of extraction output for known documents — run on every PR to catch prompt regressions |
| Load | k6 or Artillery against the upload endpoint to verify queue back-pressure and error handling under concurrent uploads |

---

## 11. Security Considerations (production hardening)

- **PII at rest**: Encrypt `data/` directory (or DB column-level encryption for SSNs).
- **API authentication**: Add JWT/session auth before any API route.
- **File validation**: Validate PDF magic bytes server-side, not just file extension.
- **Rate limiting**: Limit uploads per IP/user to prevent abuse.
- **Gemini key**: Rotate regularly; use Workload Identity (GCP) in production instead of static key.
- **HTTPS**: All traffic in production over TLS.
