import { createClient } from '@supabase/supabase-js';

const url = 'https://mtrfkytpzvdeieicuuia.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10cmZreXRwenZkZWllaWN1dWlhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTI0NzQ3MCwiZXhwIjoyMTA0ODIzNDcwfQ.KkPmmbX0cmcJSynZKiy9-_lt5W850VuDiWN0ORnLp9o';
const supabase = createClient(url, serviceKey);

// Generate Athlone graves logic directly
const baseLat = -33.967521;
const baseLng = 18.503277;
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

const persons = [];
const graves = [];

let numCounter = 8640;
for (let row = -4; row <= 4; row++) {
  for (let col = -5; col <= 5; col++) {
    if (row === 0 && col === 0) continue;
    numCounter++;
    const dNorth = row * 0.000022;
    const dEast = col * 0.000016;
    const lat = baseLat + dNorth;
    const lng = baseLng + dEast;

    const isUnmapped = (numCounter % 7) === 0;
    const isLowConfidence = !isUnmapped && (numCounter % 5) === 0;
    const nameObj = sampleNames[numCounter % sampleNames.length];

    if (!isUnmapped) {
      persons.push({
        id: `person_${numCounter}`,
        first_name: nameObj.f,
        surname: nameObj.s,
        full_name: `${nameObj.f} ${nameObj.s}`,
        gender: 'unknown',
        birth_date: `${nameObj.b}-06-15`,
        death_date: `${nameObj.d}-11-20`,
      });
    }

    graves.push({
      id: `grave_${numCounter}`,
      cemetery_id: 'cem_athlone',
      section_id: null,
      person_id: isUnmapped ? null : `person_${numCounter}`,
      grave_number: `${numCounter}`,
      plot_number: `B-${numCounter}`,
      row_number: `${14 + row}`,
      latitude: lat,
      longitude: lng,
      position_accuracy_meters: isLowConfidence ? 6.8 : 2.4,
      position_confidence: isLowConfidence ? 'LOW' : 'HIGH',
      status: isUnmapped ? 'UNMAPPED' : isLowConfidence ? 'LOW_CONFIDENCE' : 'MAPPED',
      primary_photo_url: '/sample-gravestone.svg',
      photo_count: isUnmapped ? 0 : 1,
      last_verified_at: '01 September 2026',
    });
  }
}

// Mowbray
const mowbrayLat = -33.9485;
const mowbrayLng = 18.4820;
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
    const lat = mowbrayLat + r * 0.000022;
    const lng = mowbrayLng + c * 0.000016;
    const isUnmapped = (mowbrayNum % 8) === 0;
    const isLowConfidence = !isUnmapped && (mowbrayNum % 6) === 0;
    const nameObj = mowbrayNames[mowbrayNum % mowbrayNames.length];

    if (!isUnmapped) {
      persons.push({
        id: `person_mowbray_${mowbrayNum}`,
        first_name: nameObj.f,
        surname: nameObj.s,
        full_name: `${nameObj.f} ${nameObj.s}`,
        gender: 'unknown',
        birth_date: `${nameObj.b}-04-12`,
        death_date: `${nameObj.d}-08-25`,
      });
    }

    graves.push({
      id: `grave_mowbray_${mowbrayNum}`,
      cemetery_id: 'cem_mowbray',
      section_id: null,
      person_id: isUnmapped ? null : `person_mowbray_${mowbrayNum}`,
      grave_number: `${mowbrayNum}`,
      plot_number: `A-${mowbrayNum}`,
      row_number: `${8 + r}`,
      latitude: lat,
      longitude: lng,
      position_accuracy_meters: isLowConfidence ? 5.8 : 2.2,
      position_confidence: isLowConfidence ? 'LOW' : 'HIGH',
      status: isUnmapped ? 'UNMAPPED' : isLowConfidence ? 'LOW_CONFIDENCE' : 'MAPPED',
      primary_photo_url: '/sample-gravestone.svg',
      photo_count: isUnmapped ? 0 : 2,
      last_verified_at: '05 September 2026',
    });
  }
}

async function seed() {
  console.log(`Upserting ${persons.length} persons...`);
  // Batch in 50s
  for (let i = 0; i < persons.length; i += 50) {
    const chunk = persons.slice(i, i + 50);
    const { error } = await supabase.from('persons').upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
    if (error) console.error('Error inserting persons chunk:', error);
  }

  console.log(`Upserting ${graves.length} graves...`);
  for (let i = 0; i < graves.length; i += 50) {
    const chunk = graves.slice(i, i + 50);
    const { error } = await supabase.from('graves').upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
    if (error) console.error('Error inserting graves chunk:', error);
  }

  const { count: finalGraveCount } = await supabase.from('graves').select('*', { count: 'exact', head: true });
  const { count: finalPersonCount } = await supabase.from('persons').select('*', { count: 'exact', head: true });
  console.log(`Finished! Total graves in Supabase: ${finalGraveCount}, Total persons: ${finalPersonCount}`);
}

seed();
