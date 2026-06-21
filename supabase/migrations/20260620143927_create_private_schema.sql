-- Migration 1: Create private schema, staff_role enum, and helper functions
-- Version: 20260620143927

CREATE SCHEMA IF NOT EXISTS private;

-- Staff role enum
CREATE TYPE private.staff_role AS ENUM ('staff', 'admin', 'owner');

-- Role weight for hierarchy comparison
CREATE OR REPLACE FUNCTION private.role_weight(r private.staff_role)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE r
    WHEN 'owner' THEN 30
    WHEN 'admin' THEN 20
    WHEN 'staff' THEN 10
    ELSE 0
  END;
$$;

-- Check if actual role meets minimum required role
CREATE OR REPLACE FUNCTION private.meets_minimum_role(
  actual private.staff_role,
  minimum private.staff_role
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT private.role_weight(actual) >= private.role_weight(minimum);
$$;

-- Updated-at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
