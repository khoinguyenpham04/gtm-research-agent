# GTM Research Agent

GTM Research Agent is a Next.js 16 application for document-grounded go-to-market research. It combines three capabilities in one product:

- A shared document library for uploads and URL ingestion
- A lightweight RAG search surface for quick corpus Q&A
- A workspace-scoped deep research workflow that produces evidence-backed reports

The app is built around the idea that uploaded documents are the primary source of truth. Deep research runs use selected workspace documents first, then fall back to web search only to validate or fill evidence gaps.

## What The Application Does

### 1. Data library

The data library is the ingestion and organization layer.

- Upload PDF, DOCX, or TXT files
- Ingest documents from URLs
- Store original files in Supabase Storage
- Extract text, split into chunks, generate embeddings, and persist chunk records
- Attach documents to workspaces and place them into folders

### 2. RAG search

The RAG search view is the fast path.

- Runs semantic retrieval over the uploaded corpus
- Uses OpenAI embeddings plus a Supabase RPC for vector matching
- Generates a concise answer from the retrieved chunks
- Returns the chunks used as supporting sources

### 3. Deep research

The deep research flow is the main differentiator.

- Creates an asynchronous research run for a topic and optional objective
- Can pause for user clarification before the run continues
- Builds a research brief, a pre-research plan, and an adaptive report plan
- Delegates focused sub-research tasks through a supervisor and researcher graph
- Prioritizes selected uploaded documents before using Tavily for external validation
- Extracts and validates evidence rows before final report generation
- Produces a final markdown report plus structured run artifacts and event logs

## High-Level Architecture

### Frontend

- Next.js App Router
- Dashboard surfaces for data library, RAG search, and deep research
- React client consoles for uploading, organizing, querying, and monitoring runs

### Backend

- Route handlers under `src/app/api`
- Server-side document ingestion and workspace management
- LangGraph-based deep research orchestration
- Background run processing triggered from API creation, resume, and retry endpoints

### Storage and state

- Supabase Storage for original uploaded files
- Supabase/Postgres for chunk records, workspace metadata, run records, and evidence artifacts
- LangGraph Postgres checkpointer for resumable deep research execution

## Deep Research Pipeline

The core deep research graph in `src/lib/deep-research/graph.ts` follows this sequence:

1. Clarify the request if the prompt is ambiguous
2. Convert the conversation into a research brief
3. Create a pre-research plan with core questions and evidence categories
4. Build an adaptive report plan based on the brief
5. Run a supervisor graph that delegates focused research tasks
6. Let researcher nodes use selected-document search first, then web tools if needed
7. Compress sub-research findings into reusable notes
8. Score section support and extract a structured evidence ledger
9. Resolve evidence conflicts and validate what is allowed in the final report
10. Package evidence by report section and generate the final markdown report

This design keeps the final report tied to explicit evidence rather than raw model synthesis.

## Main Product Surfaces

- `/dashboard/data-library`: upload files, ingest URLs, manage workspaces and folders, preview documents
- `/dashboard/rag-search`: ask direct questions against the corpus
- `/dashboard`: create and monitor deep research runs
- `/documents`: redirects to the data library
- `/`: redirects to `/dashboard/rag-search`

## API Surface

### Documents and search

- `POST /api/upload`
- `GET /api/documents`
- `POST /api/search`

### Workspaces

- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/[id]`
- `POST /api/workspaces/[id]/documents`
- `POST /api/workspaces/[id]/folders`
- `POST /api/workspaces/[id]/ingest`
- `PATCH /api/workspaces/[id]/documents/[documentId]`
- `DELETE /api/workspaces/[id]/documents/[documentId]`

### Deep research

- `GET /api/deep-research/runs`
- `POST /api/deep-research/runs`
- `GET /api/deep-research/runs/[id]`
- `POST /api/deep-research/runs/[id]/resume`
- `POST /api/deep-research/runs/[id]/retry`
- `GET /api/deep-research/runs/[id]/evidence`

## Data Model Summary

The application creates and uses these main persistence layers:

- `documents`: chunk-level text and embeddings for retrieval
- `workspaces`, `workspace_folders`, `workspace_documents`: organization and document attachment
- `document_sources`: source provenance for uploaded or ingested files
- `deep_research_runs`: run lifecycle and final report storage
- `deep_research_run_events`: execution log for progress and debugging
- `deep_research_run_evidence_*`: extracted evidence, conflict resolution, and section linkage artifacts

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- LangChain and LangGraph
- OpenAI APIs for embeddings and report generation
- Tavily for external research gap-filling
- Supabase Storage and Postgres
- Tailwind CSS and shadcn/ui components

## Local Setup

1. Copy the environment template.

```bash
cp .env.example .env.local
```

2. Set the required variables in `.env.local`.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
OPENAI_API_KEY=
TAVILY_API_KEY=
```

Notes:

- `SUPABASE_DB_URL` or `DATABASE_URL` is required for deep research tables and the LangGraph Postgres checkpointer
- `SUPABASE_SERVICE_ROLE_KEY` is needed for storage writes and deletes unless bucket policies already permit them
- `TAVILY_API_KEY` is optional only if you are willing to run deep research without web gap-filling

3. Install dependencies and start the app.

```bash
npm install
npm run dev
```

4. Run the targeted test suite when working on deep research logic.

```bash
npm test
```

## Repository Structure

- `src/app`: App Router pages, layouts, and API routes
- `src/app/dashboard`: the three main product consoles
- `src/lib/document-ingestion.ts`: file parsing, chunking, embedding, and storage
- `src/lib/documents.ts`: corpus listing and chunk retrieval helpers
- `src/lib/workspaces.ts`: workspace, folder, and attachment logic
- `src/lib/deep-research`: graph orchestration, prompts, runtime config, persistence, and tool wiring
- `supabase/migrations`: SQL migrations for the deep research MVP and workspace data library
- `open_deep_research-main`: vendored reference code from the upstream Python project, not part of the Next.js runtime

## Current Shape Of The Product

At a high level, this is not a generic chat app. It is a research workflow application with a clear hierarchy:

- Documents are the base layer
- Workspaces scope and organize the evidence set
- RAG search is the fast retrieval layer
- Deep research is the slower, structured synthesis layer

That separation is the main architectural choice in the codebase, and most of the application logic exists to preserve it.
