import { Cemetery, Grave, GravePhoto, Person, GraveRelationship } from '@/types';

export function mapDbCemetery(row: any): Cemetery {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    country: row.country || 'South Africa',
    province: row.province || 'Western Cape',
    city: row.city || 'Cape Town',
    denomination: row.denomination || 'Muslim',
    contactPhone: row.contact_phone || undefined,
    contactEmail: row.contact_email || undefined,
    originLat: Number(row.origin_lat),
    originLng: Number(row.origin_lng),
    originAlt: row.origin_alt ? Number(row.origin_alt) : undefined,
    entranceLat: row.entrance_lat != null ? Number(row.entrance_lat) : undefined,
    entranceLng: row.entrance_lng != null ? Number(row.entrance_lng) : undefined,
    entranceName: row.entrance_name || undefined,
    boundary: row.boundary || undefined,
    totalGravesEstimate: row.total_graves_estimate || 0,
    mappedGravesCount: row.mapped_graves_count || 0,
    coveragePercentage: Number(row.coverage_percentage || 0),
    thumbnailUrl: row.thumbnail_url || '/sample-gravestone.svg',
  };
}

export function mapDbPerson(row: any): Person {
  return {
    id: row.id,
    firstName: row.first_name,
    middleNames: row.middle_names || '',
    surname: row.surname,
    fullName: row.full_name,
    nickname: row.nickname || undefined,
    gender: row.gender || 'unknown',
    birthDate: row.birth_date || undefined,
    deathDate: row.death_date || undefined,
    burialDate: row.burial_date || undefined,
    ageYears: row.age_years || undefined,
    notes: row.notes || undefined,
  };
}

export function mapDbGrave(row: any): Grave {
  const person = row.person ? mapDbPerson(row.person) : undefined;
  return {
    id: row.id,
    cemeteryId: row.cemetery_id,
    sectionId: row.section_id || undefined,
    personId: row.person_id || undefined,
    person,
    graveNumber: row.grave_number,
    plotNumber: row.plot_number || undefined,
    rowNumber: row.row_number || undefined,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    estimatedAltitude: row.estimated_altitude ? Number(row.estimated_altitude) : undefined,
    localX: row.local_x !== null ? Number(row.local_x) : undefined,
    localY: row.local_y !== null ? Number(row.local_y) : undefined,
    localZ: row.local_z !== null ? Number(row.local_z) : undefined,
    positionAccuracyMeters: Number(row.position_accuracy_meters || 0),
    positionConfidence: row.position_confidence || 'MEDIUM',
    orientationDegrees: row.orientation_degrees ? Number(row.orientation_degrees) : undefined,
    status: row.status || 'UNMAPPED',
    primaryPhotoUrl: row.primary_photo_url || '/sample-gravestone.svg',
    photoCount: row.photo_count || 0,
    gravePhotoUrl: row.grave_photo_url || undefined,
    observationCount: row.observation_count || 0,
    lastVerifiedAt: row.last_verified_at || undefined,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

export function graveToDb(grave: Grave) {
  return {
    id: grave.id,
    cemetery_id: grave.cemeteryId,
    section_id: grave.sectionId || null,
    person_id: grave.personId || (grave.person?.id ?? null),
    grave_number: grave.graveNumber,
    plot_number: grave.plotNumber || null,
    row_number: grave.rowNumber || null,
    latitude: grave.latitude,
    longitude: grave.longitude,
    estimated_altitude: grave.estimatedAltitude || null,
    local_x: grave.localX ?? null,
    local_y: grave.localY ?? null,
    local_z: grave.localZ ?? null,
    position_accuracy_meters: grave.positionAccuracyMeters,
    position_confidence: grave.positionConfidence,
    orientation_degrees: grave.orientationDegrees || null,
    status: grave.status,
    primary_photo_url: grave.primaryPhotoUrl || '/sample-gravestone.svg',
    photo_count: grave.photoCount || 0,
    last_verified_at: grave.lastVerifiedAt || null,
    updated_at: new Date().toISOString(),
  };
}

export function personToDb(person: Person) {
  return {
    id: person.id,
    first_name: person.firstName,
    middle_names: person.middleNames || null,
    surname: person.surname,
    full_name: person.fullName,
    nickname: person.nickname || null,
    gender: person.gender || 'unknown',
    birth_date: person.birthDate || null,
    death_date: person.deathDate || null,
    burial_date: person.burialDate || null,
    age_years: person.ageYears || null,
    notes: person.notes || null,
  };
}

export function mapDbGravePhoto(row: any): GravePhoto {
  return {
    id: row.id,
    graveId: row.grave_id,
    url: row.public_url,
    storagePath: row.storage_path || undefined,
    uploadedBy: row.uploaded_by || undefined,
    isPrimary: Boolean(row.is_primary),
    kind: row.kind === 'grave' ? 'grave' : 'stone',
    capturedAt: row.captured_at || undefined,
    createdAt: row.created_at,
  };
}
