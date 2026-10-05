/**
 * A small RFC 4180 CSV parser: quoted fields, doubled quotes, delimiters and
 * newlines inside quotes, CRLF or LF, and a leading byte-order mark.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0]!.trim() === '')) rows.push(row);
    row = [];
  };

  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
    } else if (ch === delimiter) endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
  }
  if (field !== '' || row.length) endRow();
  return rows.map((r) => r.map((f) => f.trim()));
}

const CANDIDATES = [',', ';', '\t', '|'];

/** Picks the delimiter that gives the most consistent column count (≥ 2) across the first lines. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20_000);
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const rows = parseCsv(sample, d).slice(0, 20);
    if (rows.length === 0) continue;
    const counts = rows.map((r) => r.length);
    const mode = [...new Set(counts)].sort((a, b) => counts.filter((c) => c === b).length - counts.filter((c) => c === a).length)[0]!;
    if (mode < 2) continue;
    const score = counts.filter((c) => c === mode).length * 10 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}
