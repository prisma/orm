type DataField = string | number | boolean | null | undefined;

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
};

function fieldText(field: DataField): string {
  if (field === null || field === undefined) {
    return '';
  }
  return String(field).replace(/[\\\t\n\r]/g, (character) => ESCAPES[character] ?? character);
}

/**
 * One data line: the fields tab-separated, an absent field left empty so a
 * script reads the columns by position. A backslash, tab, newline or carriage
 * return inside a field is escaped as `\\`, `\t`, `\n` or `\r`.
 */
export function dataLine(fields: readonly DataField[]): string {
  return fields.map(fieldText).join('\t');
}

/** `key<TAB>value` lines for a single record; a field whose value is absent is left out. */
export function fieldLines(rows: readonly (readonly [string, DataField])[]): readonly string[] {
  return rows
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => dataLine([key, value]));
}

/** One data line per value, each escaped as a single-field line. */
export function valueLines(values: readonly DataField[]): readonly string[] {
  return values.map((value) => dataLine([value]));
}
