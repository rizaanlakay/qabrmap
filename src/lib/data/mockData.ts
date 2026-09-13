// Realistic Seed & Mock Data for QabrMap
// Faithfully matches Athlone, Mountview, and Wynberg cemeteries and Abdul Wahab Hassan Narker

import { Cemetery, Grave, SurveySession } from '@/types';

export const MOCK_CEMETERIES: Cemetery[] = [
  {
    id: 'cem_athlone',
    name: 'Athlone Muslim Cemetery',
    slug: 'athlone-muslim-cemetery',
    description: 'Historical Muslim cemetery in Athlone / Rylands, Cape Town, established in the early 20th century.',
    country: 'South Africa',
    province: 'Western Cape',
    city: 'Cape Town',
    denomination: 'Muslim (Sunni)',
    contactPhone: '+27 21 697 1234',
    contactEmail: 'info@athlonecemetery.org.za',
    originLat: -33.96813,
    originLng: 18.52682,
    originAlt: 24.0,
    entranceLat: -33.9670,
    entranceLng: 18.5265,
    entranceName: 'Johnstone Road Gate',
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [18.5261299, -33.9669731],
          [18.5267897, -33.9670666],
          [18.52731, -33.9670132],
          [18.5281791, -33.9672312],
          [18.5282113, -33.967289],
          [18.5281362, -33.9675159],
          [18.5281737, -33.9675337],
          [18.5281415, -33.9678896],
          [18.5276548, -33.9692871],
          [18.5260166, -33.9688882],
          [18.5254325, -33.968746],
          [18.5261299, -33.9669731],
        ],
      ],
    },
    totalGravesEstimate: 14300,
    mappedGravesCount: 12450,
    coveragePercentage: 87.0,
    distanceKm: 2.4,
    thumbnailUrl: '/sample-gravestone.svg',
  },
  {
    id: 'cem_mowbray',
    name: 'Mowbray Muslim Cemetery',
    slug: 'mowbray-muslim-cemetery',
    description: 'Historic Cape Town Muslim cemetery on Browning Road, Observatory / Mowbray, serving the community since 1886.',
    country: 'South Africa',
    province: 'Western Cape',
    city: 'Cape Town',
    denomination: 'Muslim (Sunni)',
    contactPhone: '+27 21 685 4321',
    contactEmail: 'info@mowbraycemetery.org.za',
    originLat: -33.93908,
    originLng: 18.46112,
    originAlt: 18.0,
    entranceLat: -33.9376,
    entranceLng: 18.4619,
    entranceName: 'Browning Road Main Gate',
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [18.4587353, -33.9402044],
          [18.4618266, -33.9375332],
          [18.4634977, -33.9390082],
          [18.4634922, -33.9390557],
          [18.4630248, -33.9393512],
          [18.4620809, -33.9399777],
          [18.459181, -33.9406329],
          [18.4587353, -33.9402044],
        ],
      ],
    },
    totalGravesEstimate: 11200,
    mappedGravesCount: 9850,
    coveragePercentage: 88.0,
    distanceKm: 3.8,
    thumbnailUrl: '/sample-gravestone.svg',
  },
  {
    id: 'cem_mountview',
    name: 'Mountview Cemetery',
    slug: 'mountview-cemetery',
    description: 'Community Muslim cemetery situated in Mountview / Hanover Park.',
    country: 'South Africa',
    province: 'Western Cape',
    city: 'Cape Town',
    denomination: 'Muslim',
    originLat: -33.9818,
    originLng: 18.5304,
    entranceLat: -33.9811,
    entranceLng: 18.5303,
    entranceName: 'Mohan Avenue Gate',
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [18.5303092, -33.9810821],
          [18.5298063, -33.9822397],
          [18.5306579, -33.9825177],
          [18.5307236, -33.9820896],
          [18.530682, -33.9820751],
          [18.5306284, -33.9820229],
          [18.5306217, -33.9819717],
          [18.5306753, -33.981667],
          [18.530796, -33.9816815],
          [18.5308403, -33.9816848],
          [18.530847, -33.98129],
          [18.5306954, -33.9812767],
          [18.5303092, -33.9810821],
        ],
      ],
    },
    totalGravesEstimate: 9600,
    mappedGravesCount: 4320,
    coveragePercentage: 45.0,
    distanceKm: 5.1,
    thumbnailUrl: '/sample-gravestone.svg',
  },
  {
    id: 'cem_wynberg',
    name: 'Wynberg Muslim Cemetery',
    slug: 'wynberg-muslim-cemetery',
    description: 'Historic Cape Malay burial ground located off Brodie Road, Wynberg.',
    country: 'South Africa',
    province: 'Western Cape',
    city: 'Cape Town',
    denomination: 'Muslim',
    originLat: -34.00264,
    originLng: 18.46765,
    entranceLat: -34.0028,
    entranceLng: 18.4673,
    entranceName: 'Brodie Road Gate',
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [18.4672311, -34.0028409],
          [18.4680775, -34.002872],
          [18.4680655, -34.0024185],
          [18.4677544, -34.0024623],
          [18.4676581, -34.0024117],
          [18.4672311, -34.0028409],
        ],
      ],
    },
    totalGravesEstimate: 12380,
    mappedGravesCount: 8912,
    coveragePercentage: 72.0,
    distanceKm: 7.3,
    thumbnailUrl: '/sample-gravestone.svg',
  },
];

// Generate realistic grave rows for Athlone Cemetery
function generateAthloneGraves(): Grave[] {
  const graves: Grave[] = [
    {
      id: 'grave_8660',
      cemeteryId: 'cem_athlone',
      cemeteryName: 'Athlone Muslim Cemetery',
      sectionId: 'sec_b',
      sectionName: 'Section B',
      personId: 'person_8660',
      person: {
        id: 'person_8660',
        firstName: 'Abdul Wahab',
        middleNames: '',
        surname: 'Hassan Narker',
        fullName: 'Abdul Wahab Hassan Narker',
        gender: 'male',
        birthDate: '1947-01-28',
        deathDate: '2016-09-23',
        ageYears: 69,
      },
      graveNumber: '8660',
      rowNumber: '14',
      plotNumber: 'B-8660',
      latitude: -33.96810,
      longitude: 18.52680,
      estimatedAltitude: 24.5,
      localX: 0.0,
      localY: 0.0,
      positionAccuracyMeters: 2.8,
      positionConfidence: 'HIGH',
      orientationDegrees: 28.5,
      status: 'MAPPED',
      primaryPhotoUrl: '/sample-gravestone.svg',
      photoCount: 3,
      lastVerifiedAt: '12 September 2026',
      createdAt: '2024-04-10T10:00:00Z',
      updatedAt: '2026-09-12T14:31:00Z',
    },
    {
      id: 'grave_7695',
      cemeteryId: 'cem_athlone',
      cemeteryName: 'Athlone Muslim Cemetery',
      sectionId: 'sec_b',
      sectionName: 'Section B',
      personId: 'person_7695',
      person: {
        id: 'person_7695',
        firstName: 'Abdul Wahab',
        surname: 'Narker',
        fullName: 'Abdul Wahab Narker',
        gender: 'male',
        birthDate: '1962-05-14',
        deathDate: '2014-11-03',
        ageYears: 52,
      },
      graveNumber: '7695',
      rowNumber: '12',
      latitude: -33.96748,
      longitude: 18.50323,
      positionAccuracyMeters: 3.2,
      positionConfidence: 'HIGH',
      status: 'MAPPED',
      primaryPhotoUrl: '/sample-gravestone.svg',
      photoCount: 2,
      lastVerifiedAt: '10 August 2026',
      createdAt: '2024-02-15T09:00:00Z',
      updatedAt: '2026-08-10T11:00:00Z',
    },
    {
      id: 'grave_1203',
      cemeteryId: 'cem_wynberg',
      cemeteryName: 'Wynberg Muslim Cemetery',
      sectionId: 'sec_a',
      sectionName: 'Section A',
      personId: 'person_1203',
      person: {
        id: 'person_1203',
        firstName: 'Abdul Wahab',
        surname: 'Essop',
        fullName: 'Abdul Wahab Essop',
        gender: 'male',
        birthDate: '1938-03-21',
        deathDate: '2009-08-19',
        ageYears: 71,
      },
      graveNumber: '1203',
      rowNumber: '4',
      latitude: -34.00845,
      longitude: 18.47108,
      positionAccuracyMeters: 4.1,
      positionConfidence: 'MEDIUM',
      status: 'MAPPED',
      primaryPhotoUrl: '/sample-gravestone.svg',
      photoCount: 1,
      lastVerifiedAt: '15 June 2026',
      createdAt: '2023-11-20T12:00:00Z',
      updatedAt: '2026-06-15T15:00:00Z',
    },
    {
      id: 'grave_4481',
      cemeteryId: 'cem_athlone',
      cemeteryName: 'Athlone Muslim Cemetery',
      sectionId: 'sec_c',
      sectionName: 'Section C',
      personId: 'person_4481',
      person: {
        id: 'person_4481',
        firstName: 'Abdul Wahab',
        surname: 'Khan',
        fullName: 'Abdul Wahab Khan',
        gender: 'male',
        birthDate: '1961-09-04',
        deathDate: '2020-04-12',
        ageYears: 58,
      },
      graveNumber: '4481',
      rowNumber: '8',
      latitude: -33.96759,
      longitude: 18.50335,
      positionAccuracyMeters: 3.0,
      positionConfidence: 'HIGH',
      status: 'MAPPED',
      primaryPhotoUrl: '/sample-gravestone.svg',
      photoCount: 2,
      lastVerifiedAt: '02 September 2026',
      createdAt: '2024-01-18T08:30:00Z',
      updatedAt: '2026-09-02T13:45:00Z',
    },
    {
      id: 'grave_mowbray_grandmother',
      cemeteryId: 'cem_mowbray',
      cemeteryName: 'Mowbray Muslim Cemetery',
      sectionId: 'sec_mowbray_a',
      sectionName: 'Section A',
      personId: 'person_mowbray_gm',
      person: {
        id: 'person_mowbray_gm',
        firstName: 'Fatima',
        surname: 'Hendricks',
        fullName: 'Fatima Hendricks',
        gender: 'female',
        birthDate: '1938-03-15',
        deathDate: '2018-05-14',
        ageYears: 80,
      },
      graveNumber: '1402',
      rowNumber: '4',
      plotNumber: 'A-1402',
      latitude: -33.93925,
      longitude: 18.46115,
      positionAccuracyMeters: 2.1,
      positionConfidence: 'HIGH',
      status: 'MAPPED',
      primaryPhotoUrl: '/sample-gravestone.svg',
      photoCount: 2,
      lastVerifiedAt: '08 September 2026',
      createdAt: '2024-02-10T09:00:00Z',
      updatedAt: '2026-09-08T12:00:00Z',
    },
  ];

  // Generate a realistic grid of surrounding graves in Section B around Grave 8660
  // Center is Athlone Muslim Cemetery -33.96813, 18.52682
  const baseLat = -33.96813;
  const baseLng = 18.52682;
  const sampleNames = [
    { f: 'Farouk', s: 'Adams', b: '1950', d: '2018' },
    { f: 'Zainab', s: 'Hendricks', b: '1942', d: '2015' },
    { f: 'Mogamat', s: 'Dollie', b: '1935', d: '2008' },
    { f: 'Fatima', s: 'Parker', b: '1960', d: '2021' },
    { f: 'Ebrahim', s: 'Davids', b: '1948', d: '2019' },
    { f: 'Amina', s: 'Samsodien', b: '1955', d: '2017' },
    { f: 'Rashied', s: 'Jacobs', b: '1970', d: '2022' },
    { f: 'Mariam', s: 'Petersen', b: '1939', d: '2012' },
    { f: 'Yusuf', s: 'Ismail', b: '1952', d: '2020' },
    { f: 'Khadija', s: 'Moerat', b: '1945', d: '2016' },
  ];

  let numCounter = 8640;
  for (let row = -4; row <= 4; row++) {
    for (let col = -5; col <= 5; col++) {
      if (row === 0 && col === 0) continue; // Grave 8660 already added

      numCounter++;
      // Graves are spaced ~1.5m apart along row, rows spaced ~2.5m apart, tilted ~28.5 degrees
      const dNorth = row * 0.000022;
      const dEast = col * 0.000016;
      const lat = baseLat + dNorth;
      const lng = baseLng + dEast;

      const isUnmapped = Math.random() < 0.15;
      const isLowConfidence = !isUnmapped && Math.random() < 0.2;
      const nameObj = sampleNames[numCounter % sampleNames.length];

      graves.push({
        id: `grave_${numCounter}`,
        cemeteryId: 'cem_athlone',
        cemeteryName: 'Athlone Muslim Cemetery',
        sectionId: 'sec_b',
        sectionName: 'Section B',
        graveNumber: `${numCounter}`,
        rowNumber: `${14 + row}`,
        plotNumber: `B-${numCounter}`,
        latitude: lat,
        longitude: lng,
        positionAccuracyMeters: isLowConfidence ? 6.8 : 2.4,
        positionConfidence: isLowConfidence ? 'LOW' : 'HIGH',
        status: isUnmapped ? 'UNMAPPED' : isLowConfidence ? 'LOW_CONFIDENCE' : 'MAPPED',
        primaryPhotoUrl: '/sample-gravestone.svg',
        photoCount: isUnmapped ? 0 : 1,
        person: isUnmapped
          ? undefined
          : {
              id: `person_${numCounter}`,
              firstName: nameObj.f,
              surname: nameObj.s,
              fullName: `${nameObj.f} ${nameObj.s}`,
              birthDate: `${nameObj.b}-06-15`,
              deathDate: `${nameObj.d}-11-20`,
            },
        lastVerifiedAt: '01 September 2026',
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      });
    }
  }

  // Generate realistic grave rows strictly inside Mowbray Muslim Cemetery boundary
  const mowbrayLat = -33.93930;
  const mowbrayLng = 18.46130;
  const mowbrayNames = [
    { f: 'Ismail', s: 'Hendricks', b: '1934', d: '2010' },
    { f: 'Amina', s: 'Gamieldien', b: '1940', d: '2015' },
    { f: 'Cassiem', s: 'Dollie', b: '1928', d: '1998' },
    { f: 'Zuleiga', s: 'Abrahams', b: '1945', d: '2018' },
    { f: 'Mogamat', s: 'Samsodien', b: '1952', d: '2022' },
    { f: 'Rashieda', s: 'Parker', b: '1938', d: '2005' },
  ];

  let mowbrayNum = 5200;
  for (let r = -3; r <= 3; r++) {
    for (let c = -4; c <= 4; c++) {
      mowbrayNum++;
      const lat = mowbrayLat + r * 0.00016;
      const lng = mowbrayLng + c * 0.00020;
      const isUnmapped = Math.random() < 0.12;
      const isLowConfidence = !isUnmapped && Math.random() < 0.15;
      const nameObj = mowbrayNames[mowbrayNum % mowbrayNames.length];

      graves.push({
        id: `grave_mowbray_${mowbrayNum}`,
        cemeteryId: 'cem_mowbray',
        cemeteryName: 'Mowbray Muslim Cemetery',
        sectionId: 'sec_mowbray_a',
        sectionName: 'Section A',
        graveNumber: `${mowbrayNum}`,
        rowNumber: `${8 + r}`,
        plotNumber: `A-${mowbrayNum}`,
        latitude: lat,
        longitude: lng,
        positionAccuracyMeters: isLowConfidence ? 5.8 : 2.2,
        positionConfidence: isLowConfidence ? 'LOW' : 'HIGH',
        status: isUnmapped ? 'UNMAPPED' : isLowConfidence ? 'LOW_CONFIDENCE' : 'MAPPED',
        primaryPhotoUrl: '/sample-gravestone.svg',
        photoCount: isUnmapped ? 0 : 2,
        person: isUnmapped
          ? undefined
          : {
              id: `person_mowbray_${mowbrayNum}`,
              firstName: nameObj.f,
              surname: nameObj.s,
              fullName: `${nameObj.f} ${nameObj.s}`,
              birthDate: `${nameObj.b}-04-12`,
              deathDate: `${nameObj.d}-08-25`,
            },
        lastVerifiedAt: '05 September 2026',
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2026-09-05T00:00:00Z',
      });
    }
  }

  return graves;
}

export const MOCK_GRAVES: Grave[] = generateAthloneGraves();

export const MOCK_ACTIVE_SURVEY_SESSION: SurveySession = {
  id: 'survey_athlone_b',
  cemeteryId: 'cem_athlone',
  cemeteryName: 'Athlone Muslim Cemetery',
  sectionCode: 'Section B',
  startedAt: '14:23',
  status: 'ACTIVE',
  capturedCount: 12,
  processedCount: 10,
  pendingCount: 2,
  reviewCount: 0,
};
