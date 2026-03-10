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
│  │  OpenRouter → Gemini   │   │  extraction  │   │             │    │
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

### Stage 2: Extract (OpenRouter → Gemini — single pass; text extraction via Poppler)
- Read PDF file from `data/uploads/`.
- Extract text via `node-poppler` (`pdfToText()`). For scanned PDFs (extracted text < 50 chars), fall back to raw base64 `data:application/pdf;base64,{…}` as an image part.
- Send extracted text (or base64 fallback) alongside the extraction prompt to Gemini via OpenRouter.
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
- **API provider upgrade**: Migrate from OpenRouter to [Vertex AI](https://cloud.google.com/vertex-ai) with [Provisioned Throughput](https://cloud.google.com/vertex-ai/generative-ai/docs/provisioned-throughput) — dedicated model capacity, availability SLA, restores Gemini's native PDF input (`inlineData`) removing the Poppler workaround, and eliminates the OpenRouter dependency.

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

---

## 12. Technology Alternatives & Tradeoffs

Each technology choice below was deliberate. This section documents 1–2 alternatives per concern, along with the key advantages and tradeoffs.

---

### 12.1 LLM — Gemini 3 Flash (preview)

| | Gemini 3 Flash | Claude Sonnet 4.6 | GPT-4o |
|---|---|---|---|
| PDF input | Native base64 `inlineData` | Vision-based (image/PDF) | Vision-based (image/PDF) |
| Structured output | `responseSchema` (guaranteed) | Tool use / JSON mode | `response_format: json_schema` |
| Extraction quality | #1 ExtractBench | Strong on reasoning-heavy extraction | Strong general extraction |
| Cost (per 1M tokens) | ~$0.10 in / $0.40 out | ~$3 in / $15 out | ~$2.50 in / $10 out |
| Tradeoffs | Preview model; routed via OpenRouter for reliability (AI Studio 503s on shared infra) | Higher cost but more reliable API | Mature ecosystem, higher cost |

**Verdict**: Gemini Flash is the right call for this use case — best extraction benchmark score at lowest cost. Claude or GPT-4o would be better if reliability > cost, or as a fallback model when Gemini 503s.

---

### 12.2 Job Queue & Retries — BullMQ + Redis (planned)

| | BullMQ + Redis | Google Cloud Tasks | Inngest |
|---|---|---|---|
| Hosting | Self-managed Redis | Fully managed (GCP) | Fully managed (SaaS) |
| Setup complexity | Medium | Low (serverless) | Very low (SDK + dashboard) |
| Retry/backoff | Built-in exponential backoff | Built-in, configurable | Built-in, visual debugging |
| Dead-letter queue | Yes | Yes | Yes (with replay) |
| Concurrency control | Fine-grained (per-queue limits) | Target-level rate limiting | Step-level concurrency |
| Observability | Bull Board UI, or custom | GCP Console | Built-in dashboard |
| Vendor lock-in | None (open-source) | GCP only | Inngest (can self-host) |
| Cost | Redis hosting ($5–50/mo) | Pay-per-task (~$0.40/M) | Free tier, then $50+/mo |

**Verdict**: BullMQ + Redis is the strongest general choice — battle-tested, no vendor lock-in, fine-grained control. **Google Cloud Tasks** is best if already on GCP (zero ops burden). **Inngest** is compelling for developer experience and built-in observability if the team is small.

---

### 12.3 Database — PostgreSQL via Prisma (planned)

| | PostgreSQL + Prisma | PostgreSQL + Drizzle | Supabase (hosted Postgres) |
|---|---|---|---|
| Type safety | Generated client, good | SQL-like, excellent TS inference | Generated types + client libs |
| Performance | Prisma adds overhead (Rust query engine) | Thin SQL wrapper, near-raw perf | Standard Postgres perf |
| Migrations | Prisma Migrate (declarative) | Drizzle Kit (SQL-based) | Built-in migration tooling |
| Learning curve | High (Prisma-specific query API) | Low (close to SQL) | Low (Postgres + dashboard) |
| Extras | N/A | N/A | Auth, Realtime, Storage, Edge Functions |
| Vendor lock-in | None | None | Moderate (can export Postgres, but lose extras) |

**Verdict**: Prisma is a safe default with the largest ecosystem. **Drizzle** is better for teams that prefer SQL-close queries and want less abstraction overhead. **Supabase** is compelling because it bundles auth + realtime + storage — which are all listed as separate future needs in §9.

---

### 12.4 PDF Storage — S3/GCS (planned)

| | AWS S3 / GCS | Cloudflare R2 | Supabase Storage |
|---|---|---|---|
| S3 compatibility | Native / GCS interop | Full S3 API compatible | S3-compatible API |
| Egress costs | $0.09/GB (S3), $0.12/GB (GCS) | $0 egress | $0.09/GB |
| Storage cost | ~$0.023/GB (S3 Standard) | ~$0.015/GB | ~$0.021/GB |
| CDN integration | CloudFront / Cloud CDN | Built-in (Cloudflare network) | Cloudflare-backed CDN |
| Access control | IAM policies, presigned URLs | Presigned URLs, Workers | Row-level security policies |

**Verdict**: S3/GCS are the defaults for good reason — mature, reliable, massive ecosystem. **Cloudflare R2** is the best alternative if egress costs matter (workers downloading PDFs for extraction would generate significant egress). If using Supabase for DB, **Supabase Storage** keeps everything in one platform.

---

### 12.5 Container Orchestration — Kubernetes (planned at 100x)

| | Kubernetes | Google Cloud Run | AWS ECS Fargate |
|---|---|---|---|
| Ops complexity | High (cluster mgmt, networking, RBAC) | Very low (deploy container, done) | Low (task definitions, no cluster mgmt) |
| Auto-scaling | HPA/VPA (configurable) | Automatic (0 to N, per-request) | Auto-scaling on task count |
| Scale to zero | Not natively | Yes (pay nothing at idle) | No (min 1 task) |
| Cost model | Fixed nodes + overhead | Per-request (CPU-seconds) | Per-vCPU-second |
| Best for | Large team, complex networking, multi-service | Event-driven workloads, small teams | Steady workloads, AWS ecosystem |

**Verdict**: Kubernetes is overkill until you need multi-service orchestration, custom networking, or GPU scheduling. **Cloud Run** is the pragmatic choice for extraction workers — deploy a container, let Google handle scaling, pay only when processing. Switch to K8s when the system outgrows managed services.

---

### 12.6 Distributed Queue — SQS or Kafka (planned at 100x)

| | AWS SQS | Apache Kafka | Google Cloud Pub/Sub |
|---|---|---|---|
| Model | Queue (consumers delete messages) | Log (consumers read offsets) | Topic/subscription (push or pull) |
| Ordering | FIFO available | Per-partition ordering | Ordering keys |
| Replay | No (message deleted after processing) | Yes (configurable retention) | Yes (seek to timestamp) |
| Throughput | ~3,000 msg/s per queue (FIFO) | Millions msg/s | Millions msg/s |
| Ops complexity | Zero (fully managed) | High (Zookeeper, brokers, partitions) | Zero (fully managed) |
| Best for | Simple task queues, decoupling | Event streaming, audit logs, replay | GCP-native, simple pub/sub |

**Verdict**: For document extraction jobs, **SQS** is the simplest and most cost-effective — it's a task queue, not a streaming platform. **Kafka** is only justified if you need event replay, audit trails, or multiple consumers processing the same events (e.g., extraction + analytics + compliance). **Cloud Pub/Sub** is the natural choice if on GCP (where Gemini lives).

---

### 12.7 Vector Store — pgvector or Pinecone (planned at 100x)

| | pgvector (Postgres extension) | Pinecone | Qdrant |
|---|---|---|---|
| Hosting | Same Postgres instance | Fully managed SaaS | Self-hosted or cloud |
| Ops overhead | Zero (just an extension) | Zero | Low–Medium |
| Performance at scale | Good to ~10M vectors | Excellent (purpose-built) | Excellent (Rust, HNSW) |
| Cost | Free (part of Postgres) | $70/mo+ (Starter) | Free (self-hosted) or cloud plans |
| Filtering | Full SQL alongside vector search | Metadata filtering | Rich filtering API |
| Best for | <10M vectors, simple setup | Large-scale production, managed | Performance-sensitive, open-source |

**Verdict**: **pgvector** is the pragmatic starting point — no new infrastructure, and for a mortgage system the vector count will be modest (thousands, not millions). Move to **Pinecone** or **Qdrant** only if vector search becomes a core feature requiring sub-10ms latency at scale.

---

### 12.8 Real-time Updates — SSE (current)

| | SSE | WebSockets (Socket.io) | Polling (React Query / SWR) |
|---|---|---|---|
| Direction | Server → Client only | Bidirectional | Client → Server (periodic) |
| Reconnection | Built-in (automatic) | Manual (Socket.io handles it) | Built-in (refetch interval) |
| Scaling | Sticky sessions or Redis adapter | Sticky sessions or Redis adapter | Stateless (easiest to scale) |
| Browser support | Universal (modern) | Universal | Universal |
| Latency | Real-time push | Real-time push | Polling interval (1–5s typical) |
| Complexity | Low | Medium | Very low |

**Verdict**: SSE is the right choice — the data flow is one-directional. **WebSockets** would only be needed if the UI sends real-time commands back (e.g., live cancel extraction). **Polling with React Query** is the simplest alternative and worth considering for production because it scales trivially (no persistent connections) and React Query handles caching/deduplication.

---

### 12.9 Observability — OpenTelemetry (planned)

| | OpenTelemetry + Grafana Stack | Datadog | Sentry + lightweight logging |
|---|---|---|---|
| Cost | Free (self-hosted) or Grafana Cloud free tier | $15–23/host/mo + per-GB ingestion | Free tier, $26/mo+ |
| Traces | Yes (Tempo / Jaeger) | Yes (APM) | Yes (performance monitoring) |
| Metrics | Yes (Prometheus) | Yes (custom metrics) | Limited |
| Logs | Yes (Loki) | Yes (Log Management) | No (need separate) |
| Setup effort | Medium–High (multiple components) | Low (agent install) | Very low (SDK install) |
| Vendor lock-in | None (open standards) | Moderate | Low |
| Best for | Cost-conscious, full control | Enterprise, low-ops teams | Startups, error tracking focus |

**Verdict**: **OpenTelemetry** as the instrumentation standard is correct regardless of backend. For the backend, **Datadog** is the fastest path to full observability if budget allows. **Grafana Cloud** free tier (50GB logs, 50GB traces) is generous enough for early production and keeps you on open standards.

---

### 12.10 Authentication — JWT/session auth (planned)

| | NextAuth.js (Auth.js) | Clerk | Supabase Auth |
|---|---|---|---|
| Next.js integration | Built for it (middleware, API routes) | Built for it (components + middleware) | Good (JS client + middleware) |
| OAuth providers | 50+ providers, credentials, magic link | Google, GitHub, email, phone, SAML, SSO | 30+ OAuth, email, phone, SAML |
| Self-hosted | Yes (open-source) | No (SaaS only) | Yes (self-host Supabase) |
| User management UI | DIY | Yes (dashboard + prebuilt components) | Yes (dashboard) |
| Multi-tenancy / RBAC | DIY | Built-in organizations + roles | Row-level security (Postgres) |
| Cost | Free | Free to 10K MAU, then $25/mo+ | Free to 50K MAU |

**Verdict**: **NextAuth.js** is the default for Next.js apps — open-source, flexible, no vendor lock-in. **Clerk** is better if you want pre-built UI components and organization/role management without building it yourself (important for the multi-tenant mortgage use case). **Supabase Auth** is best if already using Supabase for DB/storage.

---

### 12.11 Load Testing — k6 or Artillery (planned)

| | Grafana k6 | Locust | Artillery |
|---|---|---|---|
| Language | JavaScript/TypeScript | Python | YAML + JS |
| Developer experience | Write tests in JS, great CLI | Python classes, web UI for distributed | Config-driven, low-code |
| Distributed testing | k6 Cloud or k6-operator (K8s) | Built-in (master/worker) | Artillery Cloud |
| CI integration | Excellent (exit codes, thresholds) | Good | Good |
| Best for | JS/TS teams, CI pipelines | Python teams, interactive exploration | Quick scenarios, YAML-first teams |

**Verdict**: **k6** is the strongest choice for a TypeScript/Next.js project — tests are written in JavaScript, thresholds are built-in for CI gates, and it's now part of the Grafana ecosystem. **Locust** is the best alternative if the team prefers Python or needs the interactive web UI for exploratory load testing.

---

### 12.12 API Provider — OpenRouter (current)

| | OpenRouter | Google AI Studio (direct) | Vertex AI |
|---|---|---|---|
| Reliability | High — dedicated gateway, multiple provider routes | Low — shared infra; 503s during peak traffic despite not exhausting rate limits | High — dedicated capacity, Provisioned Throughput SLAs |
| PDF input quality | Depends on underlying model routing; `inlineData` not faithfully forwarded | Native base64 `inlineData`, Gemini parses PDF layout directly | Same as AI Studio (same underlying model) |
| Rate limits | Per-model credits, clear dashboard | Free: 15 RPM; Tier 1: ~1,000 RPM — but 503s occur well below the stated ceiling | Provisioned Throughput units (dedicated, no contention) |
| Cost | Slight markup over direct API prices | Cheapest (or free on free tier) | More expensive; Provisioned Throughput adds fixed cost |
| Setup complexity | Low (OpenAI-compatible API, one API key) | Low (Google API key, `@google/generative-ai` SDK) | Medium (GCP project, service account, Workload Identity) |
| Vendor lock-in | Moderate (OpenRouter-specific routing/keys) | None (Google-native) | None (Google-native) |

**Verdict**: OpenRouter was chosen because Google AI Studio's shared infrastructure — including the paid Tier 1 tier — returns `503 Service Unavailable` errors during traffic spikes, even when the caller is nowhere near their stated rate limit. This made the demo unreliable: batch-uploading 10 PDFs would routinely fail 3–5 documents with 503s unrelated to quota. OpenRouter routes through dedicated provider capacity and behaves reliably under the same load.

**PDF parsing tradeoff**: OpenRouter's PDF handling is buggy and unreliable — it does not faithfully forward Gemini's native `inlineData` PDF parts, which are the mechanism Gemini uses to read PDF layout, tables, and scanned pages directly. To work around this, the system uses `node-poppler` to extract text from PDFs before calling the model, bypassing OpenRouter's PDF handling entirely. For scanned PDFs (where extracted text is < 50 characters), the raw PDF bytes are sent as a base64 `data:application/pdf;base64,{…}` image part as a fallback. See `lib/ai/extract.ts` for the implementation.
