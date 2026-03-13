# Clarion

Clarion is an enterprise go-to-market research application for document-grounded analysis.

It lets a user define a research topic, upload industry material, scope a workspace, and launch an agentic research run that plans the investigation, gathers evidence, validates claims, and produces an executive-ready report.

## What This MVP Covers

- Data intake: upload or import PDF, DOCX, TXT, and Markdown files into a shared library
- Workspace scoping: group source material by project, market, or initiative
- Workspace Q&A: query uploaded knowledge and completed reports for fast retrieval
- Deep research: run a multi-step research workflow that clarifies scope, plans work, searches documents first, uses web search for gap-filling, and writes a final report
- Evidence handling: keep run artifacts, activity logs, and structured evidence tied to the final output
- Report reuse: persist generated reports back into the workspace knowledge base

## Demo Flow

1. Create a workspace for a market, product, or launch initiative.
2. Upload internal reports or import external source files into the data library.
3. Attach the relevant material to the workspace.
4. Ask a quick workspace question or launch a deep research run.
5. Review the run timeline, evidence, and final report.
6. Reuse the generated report as part of the workspace knowledge base.

## Product Surfaces

- `/`: landing page
- `/dashboard`: workspace-aware launch surface for new research sessions
- `/dashboard/data-library`: document ingestion, organization, and report retention
- `/dashboard/rag-search`: direct retrieval over the uploaded corpus
- `/dashboard/recent`: saved deep-research runs
- `/dashboard/chat/sessions/[sessionId]`: session thread with reports, events, and resume/retry flows

## Architecture

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui
- Orchestration: LangGraph supervisor/researcher workflow
- Models: OpenAI for embeddings and report generation
- External research: Tavily for web validation and evidence gap-filling
- Storage: Supabase Storage for files and Supabase Postgres for documents, workspaces, sessions, runs, and evidence artifacts

## Research Workflow

The deep research graph is designed for evidence-backed GTM analysis rather than generic chat:

1. Clarify the request when scope is ambiguous.
2. Convert the prompt into a research brief.
3. Build a lightweight pre-research plan.
4. Create an adaptive report plan.
5. Delegate focused sub-research tasks through supervisor and researcher nodes.
6. Search selected workspace documents before using the open web.
7. Extract structured evidence and resolve conflicts.
8. Generate a final markdown report with explicit support and gaps.

## Local Setup

1. Install dependencies.

```bash
npm install
```

2. Create `.env.local` and configure the required keys.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
OPENAI_API_KEY=
TAVILY_API_KEY=
```

Notes:

- `SUPABASE_DB_URL` or `DATABASE_URL` is required for the deep-research database and checkpointer.
- `SUPABASE_SERVICE_ROLE_KEY` is recommended for storage writes and deletes.
- `TAVILY_API_KEY` enables web gap-filling and validation.

3. Start the app.

```bash
npm run dev
```

## Scripts

```bash
npm run dev
npm run lint
npm run test
npm run build
```

## Repository Map

- `src/app`: pages, layouts, and API routes
- `src/app/dashboard`: primary product consoles
- `src/lib/document-ingestion.ts`: parsing, chunking, embeddings, and persistence
- `src/lib/workspaces.ts`: workspace, folder, and document attachment logic
- `src/lib/deep-research`: graph orchestration, prompts, runtime config, persistence, and tool wiring
- `supabase/migrations`: database migrations
- `open_deep_research-main`: vendored reference material, not part of the production runtime

## Current Positioning

This repository is not a general chatbot. It is a research workflow application with a clear hierarchy:

- documents are the source of truth
- workspaces define the evidence boundary
- workspace chat handles fast retrieval
- deep research handles structured synthesis

That separation is the core product decision in this MVP.
