-- Create cassian_project_activity: log time spent on a project for a past
-- (or any) time range. Distinct from cassian_tasks_daily_logs, which is
-- shaped around scheduling/completing a specific task. An activity row may
-- later be promoted to a task daily log; for now they live independently.

CREATE TABLE IF NOT EXISTS public.cassian_project_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.cassian_projects(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cassian_project_activity_time_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_cassian_project_activity_user_id
  ON public.cassian_project_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_cassian_project_activity_project_id
  ON public.cassian_project_activity(project_id);
CREATE INDEX IF NOT EXISTS idx_cassian_project_activity_user_start
  ON public.cassian_project_activity(user_id, start_time);

ALTER TABLE public.cassian_project_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cassian_project_activity_all_own"
  ON public.cassian_project_activity;
CREATE POLICY "cassian_project_activity_all_own"
  ON public.cassian_project_activity
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER set_cassian_project_activity_updated_at
  BEFORE UPDATE ON public.cassian_project_activity
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
