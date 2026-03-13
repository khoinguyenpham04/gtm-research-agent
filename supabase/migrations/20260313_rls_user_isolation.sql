-- Add ownership column to workspaces
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS clerk_user_id text NOT NULL DEFAULT 'system';

-- Enable RLS on user-data tables
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deep_research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_folders ENABLE ROW LEVEL SECURITY;

-- workspaces: direct ownership check
-- Note: supabaseAdmin (service role) bypasses RLS by design — background agents are unaffected
CREATE POLICY "Users manage own workspaces" ON public.workspaces
  FOR ALL USING (clerk_user_id = (auth.jwt()->>'sub'));

-- sessions: owned through workspace
CREATE POLICY "Users manage own sessions" ON public.sessions
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE clerk_user_id = (auth.jwt()->>'sub')
    )
  );

-- session_messages: owned through session → workspace
CREATE POLICY "Users manage own session messages" ON public.session_messages
  FOR ALL USING (
    session_id IN (
      SELECT s.id FROM public.sessions s
      JOIN public.workspaces w ON s.workspace_id = w.id
      WHERE w.clerk_user_id = (auth.jwt()->>'sub')
    )
  );

-- deep_research_runs: owned through workspace
CREATE POLICY "Users manage own deep research runs" ON public.deep_research_runs
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE clerk_user_id = (auth.jwt()->>'sub')
    )
  );

-- workspace_documents
CREATE POLICY "Users manage own workspace documents" ON public.workspace_documents
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE clerk_user_id = (auth.jwt()->>'sub')
    )
  );

-- workspace_folders
CREATE POLICY "Users manage own workspace folders" ON public.workspace_folders
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE clerk_user_id = (auth.jwt()->>'sub')
    )
  );
