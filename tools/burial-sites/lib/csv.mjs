// Minimal RFC 4180 reader: quoted fields may hold commas, newlines and doubled quotes. Header row names the keys.
export function parseCsv(text) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    // A trailing newline leaves one empty field; that is not a row
    if (record.length === 1 && record[0] === '') {
      record = [];
      return;
    }
    records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') {
      pushField();
      pushRecord();
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || record.length > 0) {
    pushField();
    pushRecord();
  }
  const [header, ...rows] = records;
  if (!header) return [];
  return rows.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}
