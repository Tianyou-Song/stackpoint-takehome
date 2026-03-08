# System Design: Loan Document Extraction System

## 1. Overview

A web-based pipeline that ingests unstructured mortgage loan PDFs, extracts structured data (borrower PII, income records, account details, loan terms) using an LLM, validates consistency across documents, and presents results through a real-time dashboard with source provenance.

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
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐   ┌─────────────┐   │
│  │  Parse   │──▶│ Extract  │──▶│  Upsert      │──▶│  Mark done  │   │
│  │ pdfjs    │   │  Gemini  │   │  extraction  │   │             │   │
│  └──────────┘   └──────────┘   └──────────────┘   └─────────────┘   │
│       │               │                                    │        │
│  SSE emit        SSE emit                            SSE emit       │
│  (parsing)       (extracting)                        (completed)    │
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
│    raw-text/{docId}.txt                                             │
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

### Stage 2: Parse (pdfjs-dist)
- Load PDF buffer into pdfjs-dist (Node.js, no worker).
- Extract text content page by page using `getTextContent()`.
- Concatenate page text with `[Page N]` markers.
- Save full text to `data/raw-text/{docId}.txt`.
- Emit SSE `document:parsed`.

### Stage 3: Extract (Gemini API — single pass)
- Send full document text + universal JSON schema as `responseSchema`.
- Gemini returns structured JSON with all findable fields.
- Schema covers: borrower PII, co-borrower PII, income records (array), bank accounts (array), loan terms, document type.
- Each field in the `fields` array includes `pageNumber` and `exactQuote` for provenance.
- Parse JSON response, build `DocumentExtraction` object.
- Upsert extraction to in-memory store.
- Emit SSE `document:extracted`.

### Stage 4: Aggregate (after batch completes)
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

### Stage 5: Delete & Re-aggregate
- Remove files from `data/uploads/` and `data/raw-text/`.
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
| GET | /api/documents/[id] | Document detail + extraction + raw text |
| DELETE | /api/documents/[id] | Delete document, trigger re-aggregation |
| GET | /api/loan | Loan overview |
| GET | /api/borrowers | All borrowers |
| GET | /api/borrowers/[id] | Borrower + income records + accounts |
| GET | /api/validation | All validation findings |

---

## 7. Real-time Updates (SSE)

The server maintains a list of connected SSE clients in memory. Each pipeline stage emits a typed event:

```
document:pending → document:parsing → document:parsed
  → document:extracting → document:extracted → document:completed
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
| Gemini returns invalid JSON | Error logged; document marked `error` |
| PDF parsing failure | Document marked `error`; pipeline continues for other docs |
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

1. **Queue**: Replace `Promise.allSettled` with BullMQ + Redis. Upload API enqueues jobs; workers process independently. Enables retries, dead-letter queues, and back-pressure.
2. **Database**: Replace JSON file with PostgreSQL (Prisma). Enables concurrent writes, proper transactions, indexing for fast queries.
3. **Horizontal scaling**: Stateless Next.js API behind a load balancer. SSE clients need sticky sessions or a Redis pub/sub adapter so events reach all browser connections.
4. **PDF storage**: Move `data/uploads/` to S3/GCS. Workers download from object storage.

### 100x (thousands of documents/day, multi-tenant)

1. **Dedicated extraction service**: Containerized worker pool (Kubernetes) pulling from a distributed queue (SQS or Kafka). Scales independently of the API layer.
2. **Streaming extraction**: Gemini supports streaming responses. For large documents, stream field-by-field and emit SSE events as fields arrive rather than waiting for the full response.
3. **Vector store**: Add pgvector or Pinecone to enable semantic search across extracted text (e.g., "find all documents mentioning a lien on property X").
4. **Multi-tenancy**: Tenant-scoped data (loan file ID + org ID), row-level security in Postgres, separate S3 prefixes.
5. **OCR fallback**: For scanned PDFs where pdfjs-dist returns empty text, route through Tesseract or Google Document AI.
6. **Caching**: Cache Gemini responses (hash of document text → extraction) to avoid re-processing unchanged files.
7. **Monitoring**: OpenTelemetry traces through pipeline stages; Gemini token usage tracking per tenant; alerting on extraction error rates.

---

## 10. Security Considerations (production hardening)

- **PII at rest**: Encrypt `data/` directory (or DB column-level encryption for SSNs).
- **API authentication**: Add JWT/session auth before any API route.
- **File validation**: Validate PDF magic bytes server-side, not just file extension.
- **Rate limiting**: Limit uploads per IP/user to prevent abuse.
- **Gemini key**: Rotate regularly; use Workload Identity (GCP) in production instead of static key.
- **HTTPS**: All traffic in production over TLS.
