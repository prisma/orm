/** An enum and model name for a codec id, such as `PgTimestamptzTemporal1` for `pg/timestamptz-temporal@1`. */
export function enumNameOf(codecId: string): string {
  return codecId
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/** The table or collection that stores an enum's model, which SQLite would hide if its name began with `sqlite`. */
export function tableNameOf(enumName: string): string {
  return `enum_${enumName.toLowerCase()}`;
}
