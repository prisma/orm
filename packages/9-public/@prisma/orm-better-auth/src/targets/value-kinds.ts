import { type ValueKind, valueKinds } from '../target-support';

/** The codecs every SQL target adapts from the SQL family. */
export const sqlFamilyCodecKinds = {
  string: ['sql/text@1', 'sql/varchar@1', 'sql/char@1'],
  number: ['sql/int@1', 'sql/float@1'],
  other: ['sql/raw@1'],
} as const satisfies Partial<Record<ValueKind, readonly string[]>>;

type CodecKindTable = Partial<Record<ValueKind, readonly string[]>>;

/** A support's `valueKind`, from tables of codec ids by value kind. */
export function valueKindOf(
  ...tables: readonly CodecKindTable[]
): (codecId: string) => ValueKind | undefined {
  const kinds = new Map<string, ValueKind>();
  for (const table of tables) {
    for (const kind of valueKinds) {
      for (const codecId of table[kind] ?? []) kinds.set(codecId, kind);
    }
  }
  return (codecId) => kinds.get(codecId);
}
