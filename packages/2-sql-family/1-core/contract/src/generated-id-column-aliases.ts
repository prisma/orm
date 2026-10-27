import type { AuthoringTypeAliasDescriptor } from '@internal/framework-components/authoring';

const CHAR_CODEC_ID = 'sql/char@1';

/** The column of each id format the client generates, named by a type alias that carries no generator, so a foreign key uses it as its key does. The SQL family contributes them in `sql`, and a target may also name them at the top level. ADR 310. */
export const generatedIdColumnAliases = {
  UuidString: {
    kind: 'typeAlias',
    documentation: 'Fixed-length text of 36 characters, the column a UUID is stored in as text.',
    output: { type: { codecId: CHAR_CODEC_ID, typeParams: { length: 36 } } },
  },
  Ulid: {
    kind: 'typeAlias',
    documentation: 'Fixed-length text of 26 characters, the column a ULID is stored in.',
    output: { type: { codecId: CHAR_CODEC_ID, typeParams: { length: 26 } } },
  },
  Nanoid: {
    kind: 'typeAlias',
    documentation:
      'Fixed-length text of 21 characters, the column a nanoid of the default size is stored in.',
    output: { type: { codecId: CHAR_CODEC_ID, typeParams: { length: 21 } } },
  },
  Cuid2: {
    kind: 'typeAlias',
    documentation: 'Fixed-length text of 24 characters, the column a CUID2 is stored in.',
    output: { type: { codecId: CHAR_CODEC_ID, typeParams: { length: 24 } } },
  },
  Ksuid: {
    kind: 'typeAlias',
    documentation: 'Fixed-length text of 27 characters, the column a KSUID is stored in.',
    output: { type: { codecId: CHAR_CODEC_ID, typeParams: { length: 27 } } },
  },
} as const satisfies Record<string, AuthoringTypeAliasDescriptor>;

export type GeneratedIdColumnAlias = keyof typeof generatedIdColumnAliases;

/** Where a stack names a generated id column alias, in the order a rewrite prefers: a target's own top-level name, then the family's `sql.` name. */
export const GENERATED_ID_COLUMN_ALIAS_NAMESPACES = [[], ['sql']] as const;
