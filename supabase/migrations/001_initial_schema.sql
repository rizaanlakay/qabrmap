-- ============================================================
-- QabrMap – Full Supabase Schema Migration
-- Run this in Supabase SQL Editor (Dashboard → SQL → New Query)
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA extensions;

-- ============================================================
-- 1. PROFILES (linked to Supabase Auth users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 2. CEMETERIES
-- ============================================================
CREATE TABLE IF NOT EXISTS cemeteries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  country TEXT NOT NULL DEFAULT 'South Africa',
  province TEXT NOT NULL DEFAULT 'Western Cape',
  city TEXT NOT NULL DEFAULT 'Cape Town',
  denomination TEXT DEFAULT 'Muslim',
  contact_phone TEXT,
  contact_email TEXT,
  origin_lat DOUBLE PRECISION NOT NULL,
  origin_lng DOUBLE PRECISION NOT NULL,
  origin_alt DOUBLE PRECISION,
  entrance_lat DOUBLE PRECISION,
  entrance_lng DOUBLE PRECISION,
  entrance_name TEXT,
  boundary JSONB,
  total_graves_estimate INT DEFAULT 0,
  mapped_graves_count INT DEFAULT 0,
  coverage_percentage NUMERIC(5,2) DEFAULT 0,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE cemeteries ENABLE ROW LEVEL SECURITY;

-- Cemeteries are publicly readable
CREATE POLICY "Cemeteries are publicly readable"
  ON cemeteries FOR SELECT USING (true);


-- ============================================================
-- 3. CEMETERY SECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS cemetery_sections (
  id TEXT PRIMARY KEY,
  cemetery_id TEXT NOT NULL REFERENCES cemeteries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  qibla_bearing_degrees NUMERIC(6,2),
  row_count INT DEFAULT 0,
  notes TEXT
);

ALTER TABLE cemetery_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sections are publicly readable"
  ON cemetery_sections FOR SELECT USING (true);


-- ============================================================
-- 4. PERSONS
-- ============================================================
CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  middle_names TEXT,
  surname TEXT NOT NULL,
  full_name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('male', 'female', 'unknown')),
  birth_date DATE,
  death_date DATE,
  burial_date DATE,
  age_years INT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Persons are publicly readable"
  ON persons FOR SELECT USING (true);


-- ============================================================
-- 5. GRAVES
-- ============================================================
CREATE TABLE IF NOT EXISTS graves (
  id TEXT PRIMARY KEY,
  cemetery_id TEXT NOT NULL REFERENCES cemeteries(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES cemetery_sections(id),
  person_id TEXT REFERENCES persons(id),
  grave_number TEXT NOT NULL,
  plot_number TEXT,
  row_number TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  estimated_altitude DOUBLE PRECISION,
  local_x DOUBLE PRECISION,
  local_y DOUBLE PRECISION,
  local_z DOUBLE PRECISION,
  position_accuracy_meters NUMERIC(6,2) DEFAULT 0,
  position_confidence TEXT CHECK (position_confidence IN ('HIGH', 'MEDIUM', 'LOW')) DEFAULT 'MEDIUM',
  orientation_degrees NUMERIC(6,2),
  status TEXT CHECK (status IN ('MAPPED', 'LOW_CONFIDENCE', 'UNMAPPED', 'VERIFIED', 'DISPUTED')) DEFAULT 'UNMAPPED',
  primary_photo_url TEXT,
  photo_count INT DEFAULT 0,
  last_verified_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE graves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Graves are publicly readable"
  ON graves FOR SELECT USING (true);

CREATE INDEX idx_graves_cemetery ON graves(cemetery_id);
CREATE INDEX idx_graves_person ON graves(person_id);
CREATE INDEX idx_graves_location ON graves(latitude, longitude);


-- ============================================================
-- 6. SAVED GRAVES (My Cemeteries — per-user)
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_graves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grave_id TEXT NOT NULL REFERENCES graves(id) ON DELETE CASCADE,
  category TEXT CHECK (category IN ('family', 'friend', 'coworker', 'mentor', 'other')) DEFAULT 'other',
  specific_relation TEXT,  -- e.g. 'Father', 'Grandmother', 'Close Friend'
  notes TEXT,
  saved_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, grave_id)
);

ALTER TABLE saved_graves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saved graves"
  ON saved_graves FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved graves"
  ON saved_graves FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own saved graves"
  ON saved_graves FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved graves"
  ON saved_graves FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_saved_graves_user ON saved_graves(user_id);


-- ============================================================
-- 7. SURVEY SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS survey_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  cemetery_id TEXT NOT NULL REFERENCES cemeteries(id),
  cemetery_name TEXT,
  section_code TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED')) DEFAULT 'ACTIVE',
  captured_count INT DEFAULT 0,
  processed_count INT DEFAULT 0,
  pending_count INT DEFAULT 0,
  review_count INT DEFAULT 0
);

ALTER TABLE survey_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own survey sessions"
  ON survey_sessions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own survey sessions"
  ON survey_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own survey sessions"
  ON survey_sessions FOR UPDATE USING (auth.uid() = user_id);


-- ============================================================
-- 8. PROVENANCE LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS provenance_logs (
  id TEXT PRIMARY KEY,
  grave_id TEXT NOT NULL REFERENCES graves(id) ON DELETE CASCADE,
  contributor TEXT,
  action TEXT,
  source TEXT CHECK (source IN ('MANUAL', 'AI_OCR_V1', 'FIELD_SURVEY', 'COMMUNITY_AUDIT')),
  confidence NUMERIC(4,3),
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE provenance_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Provenance logs are publicly readable"
  ON provenance_logs FOR SELECT USING (true);


-- ============================================================
-- 9. CORRECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  grave_id TEXT NOT NULL REFERENCES graves(id) ON DELETE CASCADE,
  reported_by UUID REFERENCES auth.users(id),
  issue_type TEXT NOT NULL,
  description TEXT,
  status TEXT CHECK (status IN ('PENDING', 'RESOLVED', 'REJECTED')) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own corrections"
  ON corrections FOR SELECT USING (auth.uid() = reported_by);

CREATE POLICY "Users can insert corrections"
  ON corrections FOR INSERT WITH CHECK (auth.uid() = reported_by);


-- ============================================================
-- 10. SEED DATA – Cemeteries
-- ============================================================
INSERT INTO cemeteries (id, name, slug, description, country, province, city, denomination, contact_phone, contact_email, origin_lat, origin_lng, origin_alt, entrance_lat, entrance_lng, entrance_name, boundary, total_graves_estimate, mapped_graves_count, coverage_percentage, thumbnail_url) VALUES
  ('cem_athlone', 'Athlone Muslim Cemetery', 'athlone-muslim-cemetery', 'Historical Muslim cemetery in Athlone / Rylands, Cape Town, established in the early 20th century.', 'South Africa', 'Western Cape', 'Cape Town', 'Muslim (Sunni)', '+27 21 697 1234', 'info@athlonecemetery.org.za', -33.96813, 18.52682, 24.0, -33.9670, 18.5265, 'Johnstone Road Gate', '{"type":"Polygon","coordinates":[[[18.5261299,-33.9669731],[18.5267897,-33.9670666],[18.52731,-33.9670132],[18.5281791,-33.9672312],[18.5282113,-33.967289],[18.5281362,-33.9675159],[18.5281737,-33.9675337],[18.5281415,-33.9678896],[18.5276548,-33.9692871],[18.5260166,-33.9688882],[18.5254325,-33.968746],[18.5261299,-33.9669731]]]}'::jsonb, 14300, 12450, 87.0, '/sample-gravestone.svg'),
  ('cem_mowbray', 'Mowbray Muslim Cemetery', 'mowbray-muslim-cemetery', 'Historic Cape Town Muslim cemetery on Browning Road, Observatory / Mowbray, serving the community since 1886.', 'South Africa', 'Western Cape', 'Cape Town', 'Muslim (Sunni)', '+27 21 685 4321', 'info@mowbraycemetery.org.za', -33.93908, 18.46112, 18.0, -33.9376, 18.4619, 'Browning Road Main Gate', '{"type":"Polygon","coordinates":[[[18.4587353,-33.9402044],[18.4618266,-33.9375332],[18.4634977,-33.9390082],[18.4634922,-33.9390557],[18.4630248,-33.9393512],[18.4620809,-33.9399777],[18.459181,-33.9406329],[18.4587353,-33.9402044]]]}'::jsonb, 11200, 9850, 88.0, '/sample-gravestone.svg'),
  ('cem_mountview', 'Mountview Cemetery', 'mountview-cemetery', 'Community Muslim cemetery situated in Mountview / Hanover Park.', 'South Africa', 'Western Cape', 'Cape Town', 'Muslim', NULL, NULL, -33.9818, 18.5304, NULL, -33.9811, 18.5303, 'Mohan Avenue Gate', '{"type":"Polygon","coordinates":[[[18.5303092,-33.9810821],[18.5298063,-33.9822397],[18.5306579,-33.9825177],[18.5307236,-33.9820896],[18.530682,-33.9820751],[18.5306284,-33.9820229],[18.5306217,-33.9819717],[18.5306753,-33.981667],[18.530796,-33.9816815],[18.5308403,-33.9816848],[18.530847,-33.98129],[18.5306954,-33.9812767],[18.5303092,-33.9810821]]]}'::jsonb, 9600, 4320, 45.0, '/sample-gravestone.svg'),
  ('cem_wynberg', 'Wynberg Muslim Cemetery', 'wynberg-muslim-cemetery', 'Historic Cape Malay burial ground located off Broad Road, Wynberg.', 'South Africa', 'Western Cape', 'Cape Town', 'Muslim', NULL, NULL, -34.00264, 18.46765, NULL, -34.0028, 18.4673, 'Brodie Road Gate', '{"type":"Polygon","coordinates":[[[18.4672311,-34.0028409],[18.4680775,-34.002872],[18.4680655,-34.0024185],[18.4677544,-34.0024623],[18.4676581,-34.0024117],[18.4672311,-34.0028409]]]}'::jsonb, 12380, 8912, 72.0, '/sample-gravestone.svg')
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 11. SEED DATA – Key Persons & Graves
-- ============================================================
INSERT INTO persons (id, first_name, middle_names, surname, full_name, gender, birth_date, death_date, age_years) VALUES
  ('person_8660', 'Abdul Wahab', '', 'Hassan Narker', 'Abdul Wahab Hassan Narker', 'male', '1947-01-28', '2016-09-23', 69),
  ('person_7695', 'Abdul Wahab', NULL, 'Narker', 'Abdul Wahab Narker', 'male', '1962-05-14', '2014-11-03', 52),
  ('person_1203', 'Abdul Wahab', NULL, 'Essop', 'Abdul Wahab Essop', 'male', '1938-03-21', '2009-08-19', 71),
  ('person_4481', 'Abdul Wahab', NULL, 'Khan', 'Abdul Wahab Khan', 'male', '1961-09-04', '2020-04-12', 58),
  ('person_mowbray_gm', 'Fatima', NULL, 'Hendricks', 'Fatima Hendricks', 'female', '1938-03-15', '2018-05-14', 80)
ON CONFLICT (id) DO NOTHING;

INSERT INTO graves (id, cemetery_id, section_id, person_id, grave_number, plot_number, row_number, latitude, longitude, estimated_altitude, local_x, local_y, position_accuracy_meters, position_confidence, orientation_degrees, status, primary_photo_url, photo_count, last_verified_at) VALUES
  ('grave_8660', 'cem_athlone', NULL, 'person_8660', '8660', 'B-8660', '14', -33.96810, 18.52680, 24.5, 0.0, 0.0, 2.8, 'HIGH', 28.5, 'MAPPED', '/sample-gravestone.svg', 3, '12 September 2026'),
  ('grave_7695', 'cem_athlone', NULL, 'person_7695', '7695', NULL, '12', -33.96805, 18.52675, NULL, NULL, NULL, 3.2, 'HIGH', NULL, 'MAPPED', '/sample-gravestone.svg', 2, '10 August 2026'),
  ('grave_1203', 'cem_wynberg', NULL, 'person_1203', '1203', NULL, '4', -34.00260, 18.46760, NULL, NULL, NULL, 4.1, 'MEDIUM', NULL, 'MAPPED', '/sample-gravestone.svg', 1, '15 June 2026'),
  ('grave_4481', 'cem_athlone', NULL, 'person_4481', '4481', NULL, '8', -33.96818, 18.52688, NULL, NULL, NULL, 3.0, 'HIGH', NULL, 'MAPPED', '/sample-gravestone.svg', 2, '02 September 2026'),
  ('grave_mowbray_grandmother', 'cem_mowbray', NULL, 'person_mowbray_gm', '1402', 'A-1402', '4', -33.93925, 18.46115, NULL, NULL, NULL, 2.1, 'HIGH', NULL, 'MAPPED', '/sample-gravestone.svg', 2, '08 September 2026')
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 12. SEED DATA – Provenance Logs for grave_8660
-- ============================================================
INSERT INTO provenance_logs (id, grave_id, contributor, action, source, confidence, details) VALUES
  ('prov_1', 'grave_8660', 'Surveyor #14 (R. Dollie)', 'Field Survey Photo & Telemetry Captured', 'FIELD_SURVEY', 0.98, 'GPS fix ±2.8m, Compass 62° NE, monocular depth 2.1m'),
  ('prov_2', 'grave_8660', 'QabrVision AI Engine v2.4', 'OCR & Structured Name Extraction', 'AI_OCR_V1', 0.97, 'Extracted Abdul Wahab Hassan Narker, B. 1947-01-28, D. 2016-09-23'),
  ('prov_3', 'grave_8660', 'Community Verifier (Imam A. Patel)', 'Verified & Approved Entry', 'COMMUNITY_AUDIT', 1.0, 'Cross-referenced against Athlone Burial Register Vol 14')
ON CONFLICT (id) DO NOTHING;
