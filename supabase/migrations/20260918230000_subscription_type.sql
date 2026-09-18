-- ============================================================
-- Migration: Add subscription_type to profiles
-- Supports: 'Free' (default) and 'Pro'
-- ============================================================

-- 1. Add subscription_type column with default and check constraint if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'subscription_type'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN subscription_type TEXT NOT NULL DEFAULT 'Free'
      CHECK (subscription_type IN ('Free', 'Pro'));
  END IF;
END $$;

-- 2. Backfill any existing profiles with NULL or empty subscription_type to 'Free'
UPDATE public.profiles
SET subscription_type = 'Free'
WHERE subscription_type IS NULL OR subscription_type NOT IN ('Free', 'Pro');

-- 3. Update the handle_new_user trigger function to populate subscription_type on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, subscription_type)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'subscription_type', 'Free')
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
    subscription_type = COALESCE(public.profiles.subscription_type, EXCLUDED.subscription_type, 'Free'),
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
