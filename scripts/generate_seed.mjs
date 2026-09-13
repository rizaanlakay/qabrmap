import fs from 'fs';

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

// Generate SQL
let sql = '';
if (persons.length > 0) {
  sql += 'INSERT INTO persons (id, first_name, surname, full_name, gender, birth_date, death_date) VALUES\n';
  sql += persons.map(p => `('${p.id}', '${p.first_name}', '${p.surname}', '${p.full_name}', '${p.gender}', '${p.birth_date}', '${p.death_date}')`).join(',\n');
  sql += '\nON CONFLICT (id) DO NOTHING;\n\n';
}

if (graves.length > 0) {
  sql += 'INSERT INTO graves (id, cemetery_id, section_id, person_id, grave_number, plot_number, row_number, latitude, longitude, position_accuracy_meters, position_confidence, status, primary_photo_url, photo_count, last_verified_at) VALUES\n';
  sql += graves.map(g => `('${g.id}', '${g.cemetery_id}', ${g.section_id ? `'${g.section_id}'` : 'NULL'}, ${g.person_id ? `'${g.person_id}'` : 'NULL'}, '${g.grave_number}', '${g.plot_number}', '${g.row_number}', ${g.latitude}, ${g.longitude}, ${g.position_accuracy_meters}, '${g.position_confidence}', '${g.status}', '${g.primary_photo_url}', ${g.photo_count}, '${g.last_verified_at}')`).join(',\n');
  sql += '\nON CONFLICT (id) DO NOTHING;\n';
}

fs.writeFileSync('scripts/seed_all_graves.sql', sql);
console.log(`Generated ${persons.length} persons and ${graves.length} graves.`);
