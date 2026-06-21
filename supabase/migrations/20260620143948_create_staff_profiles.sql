-- Migration 2: Create staff_profiles table with RLS
-- Version: 20260620143948

CREATE TABLE public.staff_profiles (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        private.staff_role NOT NULL DEFAULT 'staff',
  is_active   boolean NOT NULL DEFAULT true,
  display_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_profiles_user_id_unique UNIQUE (user_id)
);

-- Indexes
CREATE INDEX idx_staff_profiles_user_id ON public.staff_profiles (user_id);
CREATE INDEX idx_staff_profiles_role ON public.staff_profiles (role);

-- Updated-at trigger
CREATE TRIGGER set_staff_profiles_updated_at
  BEFORE UPDATE ON public.staff_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Enable RLS
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

-- Policies (initial — these are replaced in migration 6)
CREATE POLICY "staff_read_own"
  ON public.staff_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "admin_read_all_staff"
  ON public.staff_profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.user_id = auth.uid()
        AND sp.is_active = true
        AND sp.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "owner_insert_staff"
  ON public.staff_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.user_id = auth.uid()
        AND sp.is_active = true
        AND sp.role = 'owner'
    )
  );

CREATE POLICY "owner_update_staff"
  ON public.staff_profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.user_id = auth.uid()
        AND sp.is_active = true
        AND sp.role = 'owner'
    )
  );

-- Grant table access
GRANT SELECT ON public.staff_profiles TO authenticated;
GRANT INSERT, UPDATE ON public.staff_profiles TO authenticated;
