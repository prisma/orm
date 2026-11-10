export function canonicalize(obj: unknown): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(',')}]`;
  const record = obj as Record<string, unknown>;
  const sorted = Object.keys(record).sort();
  const entries = sorted.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`);
  return `{${entries.join(',')}}`;
}
