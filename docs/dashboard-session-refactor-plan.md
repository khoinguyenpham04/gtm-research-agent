# Dashboard Session + Deep Research Refactor Plan

## Purpose

This document defines the phased frontend refactor plan for making `/dashboard` the primary enterprise workspace surface for:

- workspace-scoped chat over attached documents
- launching and monitoring deep research inline
- reviewing enterprise-safe orchestration progress, decisions, and artifacts
- preserving `/dashboard/deepresearch` as a fallback route during migration

The goal is to move from a split-surface product to a unified session-based workspace experience without attempting a risky one-shot rewrite.

## Locked Product Decisions

The following decisions are now considered settled for the MVP refactor:

1. A session can be hybrid.
   Chat and deep research can exist in the same session thread.

2. `/dashboard/deepresearch` stays during migration.
   It remains as a fallback and validation surface until the unified dashboard flow is stable.

3. MVP chat is workspace-document scoped only.
   No web search in normal chat mode. Deep research remains the path for broader synthesis and web-backed gap filling.

4. A session belongs to exactly one workspace.
   Sessions do not switch workspaces after creation.

5. The UI exposes enterprise-safe orchestration visibility.
   We show stages, decisions, clarifications, evidence, artifacts, and final outputs, but not raw private chain-of-thought.

## Current Product Shape

Today the product has three separate operating modes:

- `/dashboard` is a launcher and workspace snapshot
- `/dashboard/deepresearch` is the actual run console
- `/dashboard/rag-search` is a stateless corpus Q&A tool

The backend already supports much more than the home page exposes:

- workspace-scoped document selection
- deep research run creation and polling
- clarification interrupts and resume flow
- event timeline and activity stages
- pre-research plans
- evidence artifacts, section validation, and final reports

What is missing is a first-class session model that can unify:

- normal chat turns
- deep research runs
- session history per workspace
- inline rendering of research activity inside the main dashboard thread

## North Star Experience

`/dashboard` becomes the primary workspace cockpit.

### Core interaction model

Each workspace contains many sessions.

Each session contains:

- user prompts
- assistant chat responses grounded in workspace documents
- optional deep research runs launched from that same thread
- run-specific orchestration artifacts and final reports

### Target page structure

- Left rail: workspace session list and session creation
- Main canvas: active thread, reports, clarifications, and inline run updates
- Right rail: workspace context, selected documents, research plan, sources, evidence, and run metadata
- Bottom composer: one input with explicit mode controls
  - `Ask workspace`
  - `Deep research`

### User workflow

1. User opens a workspace in `/dashboard`
2. User creates or resumes a session
3. User writes a prompt
4. User chooses one of two modes:
   - `Ask workspace` for fast, document-grounded chat
   - `Deep research` for longer-running orchestration
5. The thread updates inline
6. If deep research is chosen, the same thread shows:
   - run start card
   - status and activity stages
   - clarifications if needed
   - plan and evidence artifacts
   - final report output

## Canonical Domain Model

This is the recommended product model for the refactor.

### Workspace

The durable context boundary for:

- attached documents
- data library organization
- session ownership
- deep research scope

### Session

The primary UX object.

Recommended fields:

- `id`
- `workspace_id`
- `title`
- `mode_hint` or last-used mode
- `created_at`
- `updated_at`
- `archived_at` nullable

Responsibilities:

- owns chat history
- groups related deep research runs
- becomes the URL-level object for the main dashboard experience

### Session Message

A durable message model for the main dashboard thread.

Recommended message types:

- `user`
- `assistant`
- `system`
- `run_started`
- `run_status`
- `clarification_request`
- `clarification_response`
- `report_ready`
- `artifact_summary`

Not every run event needs to become a durable message. The session thread should store curated checkpoints, while the detailed event log stays attached to the run itself.

### Deep Research Run

The existing long-running orchestration object.

Recommended change:

- add `session_id` to `deep_research_runs`

Responsibilities:

- asynchronous execution
- run events
- clarification state
- evidence and report artifacts

### Session Working Set

The selected documents used for a given turn or run.

For MVP:

- a session inherits its workspace
- each deep research launch can still choose a document subset
- normal chat can use either all workspace docs or a session-level selected subset

Recommendation:

- start with "all workspace docs by default"
- add explicit session-level working-set controls in Phase 2

## Experience Architecture

## A. Shared shell

Create a reusable dashboard shell for:

- workspace selection
- session list
- active thread
- side panels for workspace and artifacts

This should replace page-specific duplicated state loading where possible.

## B. Unified composer

Replace the current launcher-only mindset with a session composer that supports:

- freeform prompt input
- workspace document context visibility
- mode switching between `Ask workspace` and `Deep research`
- optional launch configuration for deep research

## C. Inline research rendering

Deep research should render as part of the active session rather than only in a separate route.

Recommended visual pattern:

- thread card for "Research started"
- expandable orchestration block for stages and latest progress
- attached cards for:
  - plan
  - clarifications
  - evidence summary
  - final report

## D. Enterprise-safe orchestration view

We do not expose raw chain-of-thought.

We do expose:

- current stage
- stage timeline
- research plan
- selected sources/documents
- clarification requests
- evidence status and section support
- final report and citations
- failure or retry state

## E. Transitional route strategy

During migration:

- `/dashboard` becomes the main integrated experience
- `/dashboard/deepresearch` remains available
- both surfaces should reuse the same core run-rendering components

After the integrated dashboard is stable, `/dashboard/deepresearch` can be reduced to:

- power-user fallback
- QA/debug route
- redirect target for legacy links

## Delivery Principles

1. Reuse the existing deep research UI primitives instead of rewriting them.
2. Introduce session persistence before building a polished session browser.
3. Preserve working software at every phase.
4. Avoid coupling the session rollout to a full visual redesign.
5. Keep the orchestration model auditable and explicit.

## Phased Plan

## Phase 0: Product Contract and Refactor Foundations

### Goal

Define the stable product model and extract reusable frontend primitives before changing the main flow.

### Scope

- finalize session vocabulary
- define main dashboard information architecture
- identify reusable components inside the current deep research console
- agree which run artifacts are shown in-thread vs side panel

### Deliverables

- this planning document
- proposed data model for sessions and session messages
- component decomposition map

### Recommended frontend extraction targets

- `ResearchRunSetupPanel`
- `ResearchRunActivityTimeline`
- `ResearchRunSummaryCard`
- `ResearchPlanPanel`
- `ResearchClarificationCard`
- `ResearchFinalReportPanel`
- `WorkspaceContextPicker`

### Exit criteria

- team agrees that session is the primary UX object
- team agrees that `/dashboard` is the long-term canonical surface
- current console UI has a clear extraction plan

## Phase 1: Inline Deep Research in `/dashboard`

### Goal

Allow users to launch and monitor deep research directly inside `/dashboard` without yet requiring a full persistent session system.

### Why this comes first

This solves the immediate UX problem using the backend and UI assets that already exist. It reduces product fragmentation quickly while keeping the data model change surface small.

### Scope

- reuse deep research rendering inside `/dashboard`
- keep the existing dashboard launcher, but attach an inline active-run surface under it
- allow user to stay on `/dashboard` for:
  - setup
  - run start
  - polling
  - clarification
  - retry
  - final report review
- keep `/dashboard/deepresearch` functional

### UX changes

- the home page becomes a live workspace console, not just a launcher
- latest run is replaced by an active inline run region
- suggested plays still seed the composer
- workspace snapshot remains, but becomes secondary to the live thread

### Technical approach

- extract shared run-display components from the current deep research console
- keep current run lifecycle APIs unchanged
- optionally allow `/dashboard` to accept `runId` or initial launch params in the URL
- create a dashboard-local active run state without introducing durable chat yet

### Out of scope

- persistent chat history
- session browser
- mixed chat and deep research in one saved thread

### Exit criteria

- a user can do an end-to-end deep research run entirely inside `/dashboard`
- clarification and retry work there
- `/dashboard/deepresearch` and `/dashboard` share the same run rendering primitives

## Phase 2: Introduce First-Class Sessions

### Goal

Make sessions the durable object that owns the main dashboard experience.

### Scope

- add `sessions` persistence
- add `session_messages` persistence
- add `session_id` to `deep_research_runs`
- add session list per workspace in the dashboard rail
- allow creating, renaming, selecting, and reopening sessions

### Recommended schema additions

- `sessions`
  - `id`
  - `workspace_id`
  - `title`
  - `created_at`
  - `updated_at`
  - `archived_at`

- `session_messages`
  - `id`
  - `session_id`
  - `role`
  - `message_type`
  - `content_markdown` or `content_json`
  - `metadata_json`
  - `created_at`

- modify `deep_research_runs`
  - `session_id uuid references sessions(id) on delete set null`

### Product behavior

- starting a dashboard interaction creates or resumes a session
- launching deep research from a session links the run to that session
- the session thread shows curated milestones, not every raw event

### Exit criteria

- session list is visible in `/dashboard`
- deep research launches from a session
- reopening a session restores its previous runs and chat context

## Phase 3: Add Workspace Chat to the Session Thread

### Goal

Support lightweight workspace-document chat in the same session where deep research also lives.

### Scope

- implement `Ask workspace` mode
- persist user and assistant turns in `session_messages`
- scope retrieval to the session workspace
- optionally show cited chunks or source cards inline
- allow users to escalate from chat to deep research from the same thread

### MVP chat behavior

- retrieval only from workspace documents
- no web search
- no autonomous multi-step orchestration
- assistant answers are concise and document-grounded

### Important UX rule

Normal chat and deep research should feel like two tools inside one session, not two separate applications forced into one screen.

### Exit criteria

- session thread can mix:
  - chat turns
  - deep research launches
  - deep research reports
- users can start with chat, then escalate to deep research without leaving the page

## Phase 4: Refine Session Working Sets and Side Panels

### Goal

Make the unified dashboard feel operationally strong for repeated enterprise use.

### Scope

- add session-level document working set controls
- improve right-rail panels for:
  - workspace context
  - selected docs
  - run plan
  - citations
  - evidence summary
- support reopening prior reports inside the active session
- improve mobile and narrower-screen layouts

### UX refinements

- sticky composer
- sticky run status header
- collapsible artifact panels
- clearer difference between live execution and saved outputs

### Exit criteria

- document scope is understandable at a glance
- users can audit what sources shaped the answer or report
- dashboard feels like one coherent enterprise workspace surface

## Phase 5: Enterprise Hardening and Cleanup

### Goal

Stabilize the integrated experience and reduce migration-era complexity.

### Scope

- reliability and reconnect behavior
- empty, loading, timeout, and retry states polish
- concurrency rules for multiple runs per workspace or per session
- permission and sharing model preparation
- analytics and operational instrumentation
- evaluate whether `/dashboard/deepresearch` becomes a simplified fallback or a redirect

### Testing priorities

- session creation and restoration
- run launch from session
- clarification and retry flows
- cross-route consistency between `/dashboard` and `/dashboard/deepresearch`
- workspace scoping and document selection correctness

### Exit criteria

- the integrated dashboard is the default user journey
- legacy route dependence is low
- the session model is stable enough for future enterprise features

## Recommended Implementation Order Inside Each Phase

For each phase, use this order:

1. Data contract
2. API shape
3. shared component extraction
4. route-level integration
5. UX polish
6. tests

This keeps state contracts stable before visual work expands.

## Component Strategy

Recommended component families:

- `dashboard/session-shell/*`
  - layout shell
  - session rail
  - thread canvas
  - right rail

- `dashboard/session-composer/*`
  - prompt composer
  - mode switch
  - working-set summary
  - launch controls

- `dashboard/research-run/*`
  - start card
  - status summary
  - activity timeline
  - clarification card
  - plan panel
  - sources panel
  - final report panel

- `dashboard/session-thread/*`
  - user message
  - assistant message
  - run milestone card
  - artifact summary card

## Backend/API Implications

### Existing APIs that can stay for early phases

- `POST /api/deep-research/runs`
- `GET /api/deep-research/runs/[id]`
- `POST /api/deep-research/runs/[id]/resume`
- `POST /api/deep-research/runs/[id]/retry`
- `GET /api/deep-research/runs/[id]/evidence`

### New APIs likely needed in Phase 2+

- `GET /api/workspaces/[id]/sessions`
- `POST /api/workspaces/[id]/sessions`
- `GET /api/sessions/[id]`
- `PATCH /api/sessions/[id]`
- `GET /api/sessions/[id]/messages`
- `POST /api/sessions/[id]/messages`

### Search API change recommendation

The current search route behaves like a global stateless tool. For session chat, introduce a workspace-aware or session-aware search path rather than overloading the current surface implicitly.

Recommendation:

- keep existing `/api/search` for temporary compatibility
- add a new session chat API when Phase 3 starts

## Enterprise-Safe Orchestration Rendering Rules

Always prefer operational transparency over model introspection.

Safe to show:

- queued, running, waiting, retrying, completed, failed
- plan summary
- evidence coverage summary
- clarifying questions
- selected documents and cited sources
- report sections and final outputs

Do not show:

- raw hidden reasoning
- prompt internals that reduce product safety
- noisy low-level logs that are not actionable to users

## Risks and Mitigations

## Risk 1: Session model becomes too abstract too early

Mitigation:

- Phase 1 should work without sessions
- use the existing run model first

## Risk 2: Dashboard becomes visually overloaded

Mitigation:

- treat the main thread as the primary narrative
- move secondary artifacts into the right rail or expandable cards

## Risk 3: Chat and deep research feel inconsistent

Mitigation:

- one composer
- one session object
- one thread
- two clearly labeled execution modes

## Risk 4: Duplicated state logic between routes

Mitigation:

- extract shared hooks and run panels before adding more route-level behavior

## Risk 5: Workspace scoping becomes ambiguous

Mitigation:

- a session is permanently bound to one workspace
- always show workspace and active document scope near the composer

## MVP Success Criteria

The refactor is succeeding if:

- users no longer need to leave `/dashboard` to run and monitor deep research
- the dashboard clearly communicates what belongs to the workspace, the session, and the run
- chat and deep research can coexist without confusion
- orchestration visibility feels enterprise-grade and trustworthy
- the system remains incrementally shippable after each phase

## Recommended Next Step

Start with Phase 1.

Specifically:

1. extract the deep research run display panels from the current dedicated console
2. embed them into `/dashboard`
3. make `/dashboard` capable of owning an active run lifecycle
4. keep the dedicated route alive for fallback and QA

That gives immediate product value while preserving optionality for the session model rollout that follows.
