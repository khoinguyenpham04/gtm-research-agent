# GTM Research Agent MVP

## 1. Document purpose

This document defines the initial product architecture, PRD, and implementation requirements for the first MVP of an **Enterprise Go-To-Market Research** application built by evolving the current **Multi-Agent Artifact Chat** codebase.

The target experience is:

* user inputs a market, company, product, or industry topic
* user uploads supporting documents and reports
* the system runs an agentic research workflow using **AI search + RAG**
* the system performs **analysis + data correction/verification**
* the system produces a **professional report artifact** with evidence and citations

This MVP should feel like an **enterprise research workstation**, not a generic chatbot.

---

## 2. Product vision

Build a focused AI research product that can independently create a GTM research brief from:

* a user-provided topic
* uploaded internal or industry documents
* public web research

The product should combine:

* strong orchestration
* evidence-backed retrieval
* visible verification/correction
* polished report generation
* persistent runs and outputs

The app should demonstrate:

* multi-agent reasoning
* tool use
* document ingestion
* RAG
* AI search
* structured reporting
* solid product and engineering quality

---

## 3. Why this product fits the current codebase

The current app already has strong foundations:

* Next.js app shell
* split-pane artifact workspace
* provider abstraction for multiple models
* streamed UI primitives
* tool-based orchestration
* Tavily web search integration
* persistent Postgres storage via Drizzle
* artifact creation/update patterns

The current app is chat-first. This MVP should evolve it into a **research-first workstation**.

That means:

* keep the artifact system
* keep streaming patterns
* keep persistence primitives
* keep search tool integration patterns
* reduce dependence on generic open-ended chat as the main UX
* add explicit workflow state, runs, retrieval, and report generation

---

## 4. Problem statement

Today, the app is optimized for:

* chat
* ad hoc agent loops
* artifact drafting/revision

It is not yet optimized for:

* long-running research workflows
* uploaded document retrieval
* evidence-backed GTM analysis
* conflict detection and data correction
* structured reusable report generation
* dedicated run history and research state

The MVP must solve this by turning the product into a workflow-driven system where the user launches a research run and monitors the system as it completes a GTM analysis.

---

## 5. Product goals

### Primary goals

1. Allow a user to enter a topic and optional business objective.
2. Allow a user to upload supporting documents.
3. Run a multi-step workflow that combines web research and RAG.
4. Generate structured findings with evidence.
5. Perform verification and correction before final output.
6. Produce a polished GTM report in an artifact/report view.
7. Persist the run, sources, findings, and report.

### Secondary goals

1. Reuse as much of the current app as possible.
2. Keep hosting cheap/free-tier friendly.
3. Keep the architecture extensible toward LangGraph and hybrid RAG later.
4. Make the product look enterprise-ready in a demo.

### Non-goals for MVP

1. Full autonomous open-ended agent swarms.
2. Real-time collaborative multi-user workflows.
3. Heavy background infrastructure.
4. Full evaluation platform.
5. Advanced GraphRAG / hybrid RAG.
6. Complex permissions or billing.

---

## 6. Target users

### Primary user

A business or strategy user who wants a structured GTM research report.

### Secondary user

A solutions engineer / hiring manager evaluating the quality of the product, workflow design, and engineering execution.

### User characteristics

* needs actionable business research quickly
* values clean outputs over noisy agent chatter
* wants trust through citations and verification
* may provide internal documents to ground the analysis

---

## 7. Core user stories

### User story 1: Start a research run

As a user, I want to enter a topic and start a GTM research job so the system can independently analyze the market.

### User story 2: Ground research with my own files

As a user, I want to upload reports, notes, and industry data so the system can use them during analysis.

### User story 3: Watch progress

As a user, I want to see what the system is doing while it runs so I can trust the process.

### User story 4: Review evidence-backed findings

As a user, I want the findings to show sources and confidence so I can judge reliability.

### User story 5: Get a polished deliverable

As a user, I want the final result in a well-structured report format so it feels like a client-ready deliverable.

### User story 6: Revisit past work

As a user, I want saved runs and reports so I can come back to prior analyses.

---

## 8. MVP workflow

### End-to-end workflow

1. User opens the app.
2. User creates a new research run.
3. User enters:

   * topic
   * optional company/product name
   * optional goal
   * optional constraints or focus areas
4. User uploads zero or more supporting files.
5. System creates a research plan.
6. System runs parallel evidence gathering:

   * web search / external source discovery
   * uploaded-document retrieval
7. System extracts structured findings.
8. System runs a correction / verification pass.
9. System generates a final GTM report artifact.
10. User reviews report, sources, confidence, and corrections.
11. Run is saved and can be reopened later.

### Visible workflow stages in UI

* Drafting plan
* Searching the web
* Reading uploaded documents
* Synthesizing findings
* Verifying and correcting
* Writing final report
* Completed

This staged UI is important. It makes the workflow understandable and impressive without exposing messy internal agent traces.

---

## 9. UX principles

1. **Research-first, not chat-first**

   * the main experience should center on runs and reports
   * chat can exist as a supporting interaction, not the core surface

2. **Evidence over theatrics**

   * citations, sources, snippets, and confidence matter more than agent drama

3. **Progress must be visible**

   * users should always know what stage the system is in

4. **Artifact quality matters**

   * the final report should feel professional and structured

5. **Enterprise polish**

   * clean typography, sharp layout, strong hierarchy, minimal visual clutter

---

## 10. Proposed MVP surfaces

### A. Research Home / New Run

Purpose:

* start a new GTM research run

Required inputs:

* topic
* optional objective
* optional research focus
* file upload area
* start button

Optional template presets:

* Market Overview
* Competitor Analysis
* ICP and Positioning
* GTM Strategy Brief

### B. Run Dashboard

Purpose:

* monitor active work

Required modules:

* run status badge
* current stage indicator
* timeline of run events
* web sources panel
* uploaded docs panel
* findings panel
* correction/verification panel
* final report preview area

### C. Report View

Purpose:

* consume the final output

Required sections:

* executive summary
* market overview
* ideal customer profile
* competitors
* positioning and messaging
* pricing / monetization
* channels / GTM motion
* risks and unknowns
* recommendations
* evidence / citations

### D. Run History

Purpose:

* reopen previous work

Required info:

* topic
* created time
* status
* last updated time
* quick access to report

---

## 11. MVP feature set

### 11.1 Topic intake

The system must accept:

* freeform topic input
* optional goal or prompt
* optional focus tags or section preferences

Example topics:

* AI meeting assistants for SMB sales teams
* UK student budgeting app market
* GTM analysis for a proxy infrastructure startup

### 11.2 File ingestion

Supported file types for MVP:

* PDF
* TXT
* MD
* CSV converted to text rows or summaries

MVP behavior:

* upload files
* store file metadata
* extract text
* chunk content
* create embeddings
* persist chunks for retrieval

### 11.3 AI search

Use web search as part of the workflow, not as a manual tool the user has to micromanage.

MVP behavior:

* generate search queries from the topic and plan
* fetch relevant sources
* normalize source records
* extract concise findings and snippets
* persist sources and summaries

### 11.4 Retrieval / RAG

MVP behavior:

* retrieve top relevant chunks from uploaded documents
* attach retrieval results to relevant sub-questions
* store supporting snippets and metadata
* keep retrieval grounded and scoped

### 11.5 Synthesis

MVP behavior:

* combine web findings and document findings
* organize them into report sections
* preserve source attribution

### 11.6 Verification / correction

MVP behavior:

* identify duplicated claims
* flag unsupported claims
* detect contradictory claims where possible
* assign confidence level
* produce corrected and normalized findings

### 11.7 Report generation

MVP behavior:

* generate a clean report artifact
* render it in the right-hand workspace or report page
* support markdown-backed output first
* support later export flows

### 11.8 Persistence

Persist:

* runs
* events
* documents
* document chunks
* sources
* findings
* report sections
* final report

---

## 12. Functional requirements

### Research creation

* User can create a new run.
* System generates a unique run ID.
* Run starts in `queued` or `planning` state.

### Planning

* System must derive a plan from the user topic.
* Plan must contain report sections and research questions.
* Plan must be persisted.

### Search

* System must perform web search during the run.
* Search results must be stored as sources.
* Search activity must be visible in UI.

### Document ingestion

* User can upload files before or during run setup.
* Files must be stored and linked to the run.
* Extracted text must be chunked and persisted.

### Retrieval

* System must retrieve relevant chunks for sub-questions.
* Retrieved chunk metadata must be preserved.

### Findings

* Findings must be stored as structured records.
* Findings must reference evidence.

### Verification

* Findings must go through a verification stage before being treated as final.
* Each finding must have a confidence label.

### Reporting

* The final report must be generated section by section.
* The report must include a citations/evidence section.

### Run history

* Users must be able to reopen previous runs.
* Completed reports must remain accessible.

---

## 13. Non-functional requirements

### Performance

* Initial feedback to the user should appear quickly after starting a run.
* Long workflows should expose progress instead of blocking.
* Retrieval should be scoped to relevant top-k results only.

### Reliability

* Run state must be persisted between stages.
* Partial progress must survive page refresh.
* Failures should surface clearly in UI.

### Cost-awareness

* Architecture must be compatible with free or low-cost hosting.
* Avoid unnecessarily long single-request execution.
* Avoid heavyweight background infra for MVP.

### Security

* Validate uploads and input payloads.
* Sanitize file metadata and storage paths.
* Avoid exposing secret keys in client code.

### Maintainability

* Strong typing
* structured schemas
* clear boundaries between orchestration, retrieval, persistence, and UI

### Trust

* final outputs must be inspectable
* the product should show sources, evidence, and confidence

---

## 14. Product architecture: initial proposal

### Architectural direction

Evolve the existing app from:

* chat runtime + artifact tools + ad hoc agent loops

toward:

* run-based orchestration + retrieval layer + report generation pipeline

### Recommended architecture layers

#### 1. Presentation layer

Next.js pages and components for:

* new run
* run dashboard
* report view
* run history
* existing artifact/report surfaces

#### 2. Application orchestration layer

A dedicated research runtime that manages:

* plan creation
* search stage
* retrieval stage
* synthesis stage
* verification stage
* report generation stage

For MVP, this can begin as a deterministic staged workflow using current AI SDK/tool patterns.

Later, it can migrate to LangGraph with minimal conceptual change.

#### 3. Tool layer

Tools/services for:

* web search
* document extraction
* chunking
* embeddings
* retrieval
* findings persistence
* report writing

#### 4. Persistence layer

Postgres via Drizzle for:

* run metadata
* documents
* chunks
* sources
* findings
* report sections
* event logs

#### 5. Artifact/report layer

Use the existing artifact patterns where useful, but make the report a first-class artifact/output rather than a generic document.

---

## 15. Recommended migration strategy from the current app

### Reuse as-is

* provider layer
* model metadata/config selection
* Tavily integration patterns
* streaming UI patterns
* artifact rendering model
* Drizzle and Postgres setup
* auth model
* existing split-pane interaction ideas where useful

### Refactor or de-emphasize

* generic chat-first landing flow
* general-purpose ToolLoopAgent usage as the primary workflow engine
* user-driven orchestration toggles as the main product concept

### Add new modules

* research run service
* document ingestion pipeline
* retrieval service
* findings store
* report assembler
* run event timeline
* dedicated research pages

---

## 16. Proposed domain model

### Core entities

#### ResearchRun

Represents a full GTM research workflow.

Fields:

* id
* userId
* topic
* objective
* status
* planJson
* finalReportMarkdown
* finalReportJson
* createdAt
* updatedAt

#### RunEvent

Represents visible progress for a run.

Fields:

* id
* runId
* stage
* eventType
* message
* payloadJson
* createdAt

#### ResearchDocument

Represents an uploaded file.

Fields:

* id
* runId
* filename
* mimeType
* storagePath
* status
* metadataJson
* createdAt

#### DocumentChunk

Represents a chunked retrieval unit.

Fields:

* id
* documentId
* runId
* chunkIndex
* content
* embedding
* metadataJson
* createdAt

#### Source

Represents a web or uploaded source reference.

Fields:

* id
* runId
* sourceType
* title
* url
* snippet
* metadataJson
* createdAt

#### Finding

Represents a structured claim or insight.

Fields:

* id
* runId
* sectionKey
* agentName
* claim
* evidenceJson
* confidence
* status
* createdAt

#### ReportSection

Represents an assembled section of the final report.

Fields:

* id
* runId
* sectionKey
* title
* contentMarkdown
* citationsJson
* createdAt

---

## 17. Initial orchestration design for MVP

### Design principle

Start with a **deterministic staged workflow** that is easier to ship and debug.

The system does not need a fully dynamic long-running graph on day one.
It needs a clear, reliable workflow.

### Proposed stages

#### Stage 1: Create plan

Input:

* topic
* objective
* available uploaded docs

Output:

* research questions
* target report sections
* search queries

#### Stage 2: Web research

Input:

* search queries

Output:

* source records
* source summaries
* raw web findings

#### Stage 3: RAG retrieval

Input:

* research questions
* uploaded docs/chunks

Output:

* relevant chunk matches
* grounded document findings

#### Stage 4: Synthesis

Input:

* web findings
* document findings

Output:

* section-level draft findings

#### Stage 5: Verification/correction

Input:

* draft findings
* evidence

Output:

* corrected findings
* confidence
* conflicts/unknowns

#### Stage 6: Report generation

Input:

* verified findings

Output:

* final report sections
* final report artifact

#### Stage 7: Finalize

Output:

* completed run status
* saved report
* run history entry

---

## 18. Future orchestration direction

After MVP, evolve the staged runtime into a LangGraph-based orchestrator with sub-agents:

* orchestrator
* webResearchAgent
* ragResearchAgent
* verificationAgent
* reportAgent

MVP should be designed so this evolution is natural:

* clear stage boundaries
* typed state
* persisted run/event records
* modular service abstractions

---

## 19. UI requirements in detail

### New Run screen requirements

Must include:

* title and short product positioning
* topic input
* optional objective input
* optional focus/tag selector
* file upload dropzone
* run button
* example use cases or template cards

Success criteria:

* user understands instantly what the system does
* user can start a run in under one minute

### Run Dashboard requirements

Must include:

* topic header
* status badge
* progress stage UI
* event timeline
* sources list
* uploaded documents list
* findings list
* corrections/verification card
* final report preview

Success criteria:

* user can understand current system state at a glance
* user can inspect evidence while the system runs

### Report View requirements

Must include:

* clear sectioned report layout
* citations/evidence references
* confidence indicators
* risks/unknowns section
* recommendation section

Success criteria:

* report feels like a polished consulting/research deliverable

### Run History requirements

Must include:

* table or list of prior runs
* topic
* status
* timestamp
* open action

---

## 20. Data and retrieval requirements

### Chunking requirements

* chunk size should balance semantic completeness and retrieval quality
* preserve metadata such as source file, page, section, or row if available
* avoid overly large chunks

### Embedding requirements

* embeddings must be stored with chunks
* retrieval must support top-k search
* retrieval should be filterable by run and document

### Citation requirements

Every report section should be traceable back to:

* web source(s)
* uploaded file chunks
* or both

### Data correction requirements

The system must explicitly surface:

* uncertain claims
* contradictory evidence
* missing data
* unsupported assumptions

---

## 21. Technical requirements

### Frontend

* Next.js App Router
* TypeScript
* Tailwind / current component system
* reuse artifact and streaming UI patterns where sensible

### Backend

* current API route/service patterns may be extended
* strong schema validation
* modular services for search, ingestion, retrieval, synthesis, verification

### Database

* Drizzle migrations for new research tables
* preserve current chat/document tables
* add research-specific tables cleanly

### Search

* use current Tavily-backed web search as the first search backend
* encapsulate the search layer so it can be upgraded later

### RAG

For MVP, add:

* ingestion service
* chunk store
* embedding generation
* retrieval function

### Streaming/progress

* expose stage progress to the UI
* event timeline should update live or near-live
* runs must survive page refresh

---

## 22. Suggested file/module additions

This is conceptual and should be adapted to the actual repo structure.

### New app surfaces

* `app/research/page.tsx`
* `app/research/[id]/page.tsx`
* `app/research/history/page.tsx`

### New backend/runtime modules

* `lib/research/runtime.ts`
* `lib/research/planner.ts`
* `lib/research/search.ts`
* `lib/research/ingestion.ts`
* `lib/research/retrieval.ts`
* `lib/research/synthesis.ts`
* `lib/research/verification.ts`
* `lib/research/report.ts`
* `lib/research/schemas.ts`

### Database additions

* new schema tables in `lib/db/schema.ts`
* related query helpers in `lib/db/queries.ts` or research-specific query module

### UI components

* `components/research/new-run-form.tsx`
* `components/research/run-timeline.tsx`
* `components/research/source-list.tsx`
* `components/research/findings-panel.tsx`
* `components/research/report-viewer.tsx`
* `components/research/run-history.tsx`

---

## 23. MVP success criteria

The MVP is successful if a user can:

1. enter a GTM topic
2. upload supporting documents
3. launch a run
4. see progress stages
5. inspect discovered sources and grounded findings
6. receive a structured report
7. see corrections/confidence
8. reopen the run later

The MVP is especially successful if the experience clearly communicates:

* this is more than chat
* this is evidence-backed
* this is reusable and productized

---

## 24. Key product risks

### Risk 1: The experience still feels like a chatbot

Mitigation:

* make research runs the main object, not messages
* create dedicated research pages and report views

### Risk 2: Search and retrieval feel shallow

Mitigation:

* invest in better source normalization, chunking, and citation display

### Risk 3: Verification feels fake or invisible

Mitigation:

* explicitly show corrected findings, weak evidence, and confidence

### Risk 4: Long workflows are brittle

Mitigation:

* persist stage-by-stage state and event logs
* keep the workflow deterministic for MVP

### Risk 5: Overbuilding before the deadline

Mitigation:

* prioritize one clean vertical slice over agent complexity

---

## 25. Recommended MVP scope boundary

### Must-have

* new research run flow
* file uploads
* web search integration in workflow
* basic RAG over uploaded docs
* stage-based orchestration
* run event timeline
* final structured report
* persistence of runs and outputs

### Nice-to-have

* presets/templates
* report export
* compare multiple runs
* inline follow-up questions on a finished report

### Later

* LangGraph orchestrator with sub-agents
* hybrid RAG
* graph retrieval
* formal eval/bad-case tooling
* professional PDF export from templates

---

## 26. First implementation plan

### Phase 1: Research object model

* add research tables
* add run creation flow
* add run history and detail pages

### Phase 2: File ingestion and retrieval

* add upload flow
* extract/chunk/embed/store
* implement retrieval API

### Phase 3: Staged research runtime

* implement planning
* integrate Tavily search
* integrate retrieval
* persist findings and events

### Phase 4: Report experience

* create report viewer
* wire final report generation into artifact/report surface
* polish layout and status handling

### Phase 5: Hardening

* failures
* empty states
* better evidence rendering
* prompt tuning and verification quality

---

## 27. Final product positioning statement

**GTM Research Agent** is an enterprise-style AI research workstation that turns a topic plus supporting documents into an evidence-backed go-to-market report using AI search, retrieval, verification, and structured report generation.

It builds on the current Multi-Agent Artifact Chat foundation but shifts the core interaction from generic chat to run-based research and high-quality deliverables.

---

## 28. One-line summary for the team

Build a research-first AI workstation on top of the current app that can ingest files, search the web, verify findings, and generate polished GTM reports with evidence.
