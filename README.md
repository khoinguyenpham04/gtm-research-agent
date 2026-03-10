# GTM Research Agent

Research-first AI workstation built with Next.js, Supabase, OpenAI, Tavily, and LangGraph.

The app started as a simple document RAG prototype. The current MVP adds a persistent research-run workflow that can:

- ingest files into Supabase storage + pgvector-backed retrieval
- launch structured GTM research runs
- search the web with intent-based queries
- score and gate sources before synthesis
- verify claims before final output
- generate a report with evidence and a competitor matrix

## Current MVP

The product currently supports two connected workflows.

### 1. Document workflow

Users can upload `PDF`, `DOCX`, and `TXT` files on `/documents`.

Current behavior:

- original files are stored in the Supabase `documents` storage bucket
- extracted text is chunked and embedded with `text-embedding-3-small`
- chunks are stored in the `documents` table with metadata
- the legacy `/search` page can run vector search over uploaded chunks via `match_documents(...)`

### 2. Research workflow

Users can create a research run on `/research` with:

- a topic
- an optional objective
- optional linked uploaded documents

Each run is persisted in Supabase and executed stage-by-stage through LangGraph.

Current run stages:

1. `plan`
2. `web_search`
3. `mock_document_retrieval`
4. `draft_report`
5. `verification`
6. `finalize`

Current research behavior:

- generates six intent-based search queries:
  - market size
  - adoption
  - competitor features
  - pricing
  - buyer pain
  - GTM channels
- searches the web through Tavily
- scores sources by category, recency, and quality
- gates low-quality sources before synthesis
- drafts findings and report sections
- verifies claims with evidence rules
- outputs a GTM brief with:
  - executive summary
  - key takeaways
  - structured GTM sections
  - competitor matrix
  - citations

## What Is Implemented

### Backend

- Next.js App Router API routes
- Supabase persistence for:
  - research runs
  - linked documents
  - research events
  - sources
  - findings
  - report sections
- LangGraph workflow orchestration
- OpenAI structured generation for planning, drafting, and verification
- Tavily-backed web search adapter
- source scoring and source gating
- claim verification rules

### Frontend

- `/research` new-run screen
- `/research/[id]` run dashboard
- stage progress UI
- event timeline
- evidence list with source quality metadata
- findings list with verification status and gaps
- final markdown report view
- `/documents` upload and management UI
- `/search` legacy RAG search UI

## MVP Boundaries

This is the current MVP, not the final product.

Implemented:

- persistent research runs
- visible stage progress
- web research with source scoring and verification
- document ingestion
- competitor matrix in final report

Not implemented yet:

- real run-scoped document retrieval inside research runs
- background workers or queued execution
- streaming event transport
- inline report editing
- claim-level contradiction resolution across many sources
- robust competitor/pricing extraction from primary vendor pages

Important current limitation:

- the research workflow still uses `mock_document_retrieval`, so uploaded documents can be linked to a run but are not yet retrieved into synthesis through vector search.

## Workflow Review

### Document ingestion workflow

1. User uploads a file.
2. The file is stored in Supabase Storage.
3. Text is extracted from the file.
4. Text is chunked.
5. Embeddings are created with OpenAI.
6. Chunks and metadata are written to the `documents` table.

### Research run workflow

1. User creates a run.
2. A `research_runs` row is created.
3. LangGraph executes the run.
4. The planner generates report sections and intent-specific search queries.
5. Tavily retrieves web results.
6. Sources are scored and gated.
7. A draft report is generated from gated evidence.
8. A verification pass re-scores claims and enforces evidence rules.
9. Final sections and markdown are saved.
10. The user can reopen the run and inspect evidence, findings, and the final report.

### Verification rules in the current MVP

A claim should not remain `verified` unless it has either:

- one strong official/research source, or
- two independent medium-quality sources

Otherwise the system downgrades the claim to `needs-review` and records gaps.

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Supabase
- Postgres + pgvector
- OpenAI
- Tavily
- LangGraph
- AI SDK
- Tailwind CSS

## Project Structure

Key areas:

- [`src/app/research`](/Users/khoinguyen_pham/GitHub/gtm-research-agent/src/app/research)
- [`src/app/api/research`](/Users/khoinguyen_pham/GitHub/gtm-research-agent/src/app/api/research)
- [`src/app/api/upload/route.ts`](/Users/khoinguyen_pham/GitHub/gtm-research-agent/src/app/api/upload/route.ts)
- [`src/app/api/search/route.ts`](/Users/khoinguyen_pham/GitHub/gtm-research-agent/src/app/api/search/route.ts)
- [`src/lib/research`](/Users/khoinguyen_pham/GitHub/gtm-research-agent/src/lib/research)
- [`supabase/migrations`](/Users/khoinguyen_pham/GitHub/gtm-research-agent/supabase/migrations)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create local env

```bash
cp .env.example .env.local
```

Set these values in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
OPENAI_API_KEY=your-openai-api-key
TAVILY_API_KEY=your-tavily-api-key
```

### 3. Create the Supabase storage bucket

Create a bucket named `documents`.

Recommended settings for the current app:

- bucket name: `documents`
- public bucket: `on`

### 4. Create the legacy document-search schema

The upload and legacy `/search` flow still depend on a `documents` table and a `match_documents(...)` function.

Run this SQL in Supabase:

```sql
create extension if not exists vector;

create table if not exists public.documents (
  id bigserial primary key,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536) not null
);

create index if not exists documents_embedding_idx
  on public.documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create or replace function public.match_documents(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql
as $$
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
```

### 5. Run the research migrations

Apply the migrations in [`supabase/migrations`](/Users/khoinguyen_pham/GitHub/gtm-research-agent/supabase/migrations):

- `20260310180000_research_vertical_slice.sql`
- `20260310193000_research_verification.sql`

You can do this with the Supabase SQL editor or via the Supabase CLI.

### 6. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Running The App

Suggested order:

1. Upload one or more files on `/documents`
2. Open `/research`
3. Start a run with a topic and objective
4. Watch the stage timeline on `/research/[id]`
5. Review sources, findings, and final report
6. Use `/search` if you want to test the legacy document-only RAG flow

## Environment Variables

Defined in [.env.example](/Users/khoinguyen_pham/GitHub/gtm-research-agent/.env.example):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `TAVILY_API_KEY`

## API Surface

### Research APIs

- `POST /api/research/runs`
- `GET /api/research/runs`
- `GET /api/research/runs/:id`
- `GET /api/research/runs/:id/events`
- `POST /api/research/runs/:id/execute`

### Legacy document APIs

- `POST /api/upload`
- `GET /api/documents`
- `DELETE /api/documents?id=...`
- `POST /api/search`

## Known Issues And Limitations

- Research execution is synchronous request execution, not background job processing.
- The UI uses polling, not SSE or websocket streaming.
- Web evidence quality is improving but still uneven for competitor and pricing research.
- Some official sources can be topically adjacent rather than truly market-specific.
- Real vector retrieval from linked documents inside research runs is the next major step.

## Recommended Next Steps

The most valuable next product steps are:

1. Replace `mock_document_retrieval` with real run-scoped vector retrieval.
2. Add intent-specific retrieval strategies for market, competitor, and pricing evidence.
3. Improve structured competitor and pricing extraction from primary vendor sources.
4. Add retry controls and richer event streaming for long-running runs.

## Verification

Useful local checks:

```bash
npx tsc --noEmit
npx eslint src/lib/research src/app/research/'[id]'/page.tsx
```
