-- =====================================================================
-- QabrMap - Production PostGIS Database Schema
-- Spatial mapping, multi-observation provenance & reconciliation for Muslim Cemeteries
-- =====================================================================

-- Enable PostGIS spatial extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
DO $$ BEGIN
    CREATE TYPE confidence_level AS ENUM ('HIGH', 'MEDIUM', 'LOW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE grave_status AS ENUM ('MAPPED', 'LOW_CONFIDENCE', 'UNMAPPED', 'VERIFIED', 'DISPUTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE stone_condition AS ENUM ('EXCELLENT', 'GOOD', 'WEATHERED', 'DAMAGED', 'UNREADABLE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE correction_type AS ENUM (
        'WRONG_PERSON', 'WRONG_GRAVE', 'WRONG_GPS', 'UNREADABLE_STONE',
        'DUPLICATE_GRAVE', 'INCORRECT_DATE', 'INCORRECT_NAME', 'RELOCATED', 'DAMAGED', 'OTHER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('PUBLIC', 'CONTRIBUTOR', 'VERIFIED_CONTRIBUTOR', 'CEMETERY_ADMIN', 'SYSTEM_ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'CONTRIBUTOR',
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Cemeteries Table
CREATE TABLE IF NOT EXISTS cemeteries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    country VARCHAR(100) NOT NULL DEFAULT 'South Africa',
    province VARCHAR(100) NOT NULL DEFAULT 'Western Cape',
    city VARCHAR(100) NOT NULL DEFAULT 'Cape Town',
    denomination VARCHAR(100) DEFAULT 'Muslim',
    contact_phone VARCHAR(50),
    contact_email VARCHAR(100),
    
    -- Geodetic Origin for Local Cartesian Coordinate System
    origin_latitude DOUBLE PRECISION NOT NULL,
    origin_longitude DOUBLE PRECISION NOT NULL,
    origin_altitude DOUBLE PRECISION DEFAULT 0.0,
    
    -- PostGIS Polygon boundary (SRID 4326 - WGS84)
    boundary GEOMETRY(Polygon, 4326),
    
    -- Coverage & Survey Statistics
    total_graves_estimate INTEGER DEFAULT 0,
    mapped_graves_count INTEGER DEFAULT 0,
    coverage_percentage NUMERIC(5,2) DEFAULT 0.00,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Cemetery Sections
CREATE TABLE IF NOT EXISTS cemetery_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cemetery_id UUID NOT NULL REFERENCES cemeteries(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20),
    boundary GEOMETRY(Polygon, 4326),
    qibla_bearing_degrees NUMERIC(5,2) DEFAULT 28.5, -- Cape Town Qibla ~28.5° NNE
    row_count INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. People (Deceased records)
CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(150) NOT NULL,
    middle_names VARCHAR(150),
    surname VARCHAR(150) NOT NULL,
    full_name VARCHAR(300) NOT NULL,
    gender VARCHAR(20),
    birth_date DATE,
    death_date DATE,
    burial_date DATE,
    age_years INTEGER,
    family_relationship TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Graves Table (Primary spatial entity)
CREATE TABLE IF NOT EXISTS graves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cemetery_id UUID NOT NULL REFERENCES cemeteries(id) ON DELETE RESTRICT,
    section_id UUID REFERENCES cemetery_sections(id) ON DELETE SET NULL,
    person_id UUID REFERENCES people(id) ON DELETE SET NULL,
    
    grave_number VARCHAR(50) NOT NULL,
    plot_number VARCHAR(50),
    row_number VARCHAR(50),
    
    -- Spatial Location
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    estimated_altitude DOUBLE PRECISION DEFAULT 0.0,
    
    -- Local Cartesian Coordinates relative to cemetery origin
    local_x DOUBLE PRECISION,
    local_y DOUBLE PRECISION,
    local_z DOUBLE PRECISION,
    
    -- Accuracy & Reliability
    position_accuracy_meters NUMERIC(6,2) NOT NULL DEFAULT 5.0,
    position_confidence confidence_level NOT NULL DEFAULT 'MEDIUM',
    orientation_degrees NUMERIC(5,2),
    status grave_status NOT NULL DEFAULT 'MAPPED',
    
    -- PostGIS Point (SRID 4326)
    geometry GEOMETRY(Point, 4326),
    
    primary_photo_url TEXT,
    observation_count INTEGER DEFAULT 1,
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_cemetery_grave_number UNIQUE (cemetery_id, grave_number)
);

-- 6. Gravestones
CREATE TABLE IF NOT EXISTS gravestones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grave_id UUID NOT NULL REFERENCES graves(id) ON DELETE CASCADE,
    material VARCHAR(100) DEFAULT 'Marble',
    condition stone_condition DEFAULT 'GOOD',
    width_cm NUMERIC(6,2) DEFAULT 40.0,
    height_cm NUMERIC(6,2) DEFAULT 75.0,
    thickness_cm NUMERIC(6,2) DEFAULT 10.0,
    detected_bounding_box JSONB, -- [x, y, width, height]
    raw_ocr_text TEXT,
    inscription_language VARCHAR(50) DEFAULT 'English',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Photos
CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    storage_path TEXT NOT NULL,
    public_url TEXT NOT NULL,
    thumbnail_url TEXT,
    original_filename VARCHAR(255),
    file_size_bytes BIGINT,
    mime_type VARCHAR(100) DEFAULT 'image/jpeg',
    width INTEGER,
    height INTEGER,
    exif_data JSONB,
    embedding VECTOR(128), -- Image similarity embedding vector
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Survey Sessions
CREATE TABLE IF NOT EXISTS survey_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cemetery_id UUID NOT NULL REFERENCES cemeteries(id),
    section_id UUID REFERENCES cemetery_sections(id),
    user_id UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'ACTIVE',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    captured_count INTEGER DEFAULT 0,
    processed_count INTEGER DEFAULT 0,
    pending_count INTEGER DEFAULT 0,
    review_count INTEGER DEFAULT 0
);

-- 9. Grave Observations (Individual photograph telemetry & estimates)
CREATE TABLE IF NOT EXISTS grave_observations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grave_id UUID NOT NULL REFERENCES graves(id) ON DELETE CASCADE,
    photo_id UUID REFERENCES photos(id) ON DELETE SET NULL,
    survey_session_id UUID REFERENCES survey_sessions(id) ON DELETE SET NULL,
    contributor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Raw Sensor Telemetry at Capture
    capture_latitude DOUBLE PRECISION NOT NULL,
    capture_longitude DOUBLE PRECISION NOT NULL,
    capture_altitude DOUBLE PRECISION,
    gps_accuracy DOUBLE PRECISION NOT NULL,
    heading_degrees DOUBLE PRECISION NOT NULL,
    heading_accuracy DOUBLE PRECISION,
    pitch DOUBLE PRECISION,
    roll DOUBLE PRECISION,
    
    -- Geometric Camera Projection
    camera_fov_estimate DOUBLE PRECISION DEFAULT 60.0,
    distance_to_grave_estimate DOUBLE PRECISION,
    relative_x DOUBLE PRECISION,
    relative_y DOUBLE PRECISION,
    relative_z DOUBLE PRECISION,
    
    -- Projected Coordinates for this observation
    estimated_grave_latitude DOUBLE PRECISION NOT NULL,
    estimated_grave_longitude DOUBLE PRECISION NOT NULL,
    position_error_estimate DOUBLE PRECISION,
    confidence confidence_level DEFAULT 'MEDIUM',
    raw_sensor_data JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Verification Events (Provenance)
CREATE TABLE IF NOT EXISTS verification_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grave_id UUID NOT NULL REFERENCES graves(id) ON DELETE CASCADE,
    verified_by_user_id UUID REFERENCES users(id),
    verification_type VARCHAR(50) NOT NULL, -- 'AI_EXTRACTED', 'FIELD_VERIFIED', 'COMMUNITY_CONFIRMED'
    confidence_score NUMERIC(4,3),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Data Corrections & Dispute Trail
CREATE TABLE IF NOT EXISTS corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grave_id UUID NOT NULL REFERENCES graves(id) ON DELETE CASCADE,
    reported_by_user_id UUID REFERENCES users(id),
    issue_type correction_type NOT NULL,
    description TEXT NOT NULL,
    suggested_changes JSONB,
    status VARCHAR(50) DEFAULT 'PENDING',
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Spatial Indexes (GiST)
CREATE INDEX IF NOT EXISTS idx_graves_geometry ON graves USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_cemeteries_boundary ON cemeteries USING GIST (boundary);
CREATE INDEX IF NOT EXISTS idx_cemetery_sections_boundary ON cemetery_sections USING GIST (boundary);

-- B-Tree & Full-Text Search Indexes
CREATE INDEX IF NOT EXISTS idx_graves_cemetery ON graves(cemetery_id);
CREATE INDEX IF NOT EXISTS idx_graves_person ON graves(person_id);
CREATE INDEX IF NOT EXISTS idx_graves_number ON graves(grave_number);
CREATE INDEX IF NOT EXISTS idx_people_full_name ON people(full_name);
CREATE INDEX IF NOT EXISTS idx_people_surname ON people(surname);
CREATE INDEX IF NOT EXISTS idx_people_dates ON people(birth_date, death_date);
CREATE INDEX IF NOT EXISTS idx_observations_grave ON grave_observations(grave_id);

-- Auto-populate PostGIS geometry from Lat/Lng trigger
CREATE OR REPLACE FUNCTION update_grave_geometry()
RETURNS TRIGGER AS $$
BEGIN
    NEW.geometry = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_grave_geom
BEFORE INSERT OR UPDATE OF latitude, longitude ON graves
FOR EACH ROW EXECUTE FUNCTION update_grave_geometry();
