import { describe, expect, it } from 'vitest';
import {
  GENERATED_ID_COLUMN_ALIAS_NAMESPACES,
  generatedIdColumnAliases,
} from '../src/generated-id-column-aliases';

function charAlias(length: number, documentation: string) {
  return {
    kind: 'typeAlias',
    documentation,
    output: { type: { codecId: 'sql/char@1', typeParams: { length } } },
  };
}

describe('the type aliases for the column of a generated id', () => {
  it('name one fixed-length character column per id format, with no generator', () => {
    expect(generatedIdColumnAliases).toEqual({
      UuidString: charAlias(
        36,
        'Fixed-length text of 36 characters, the column a UUID is stored in as text.',
      ),
      Ulid: charAlias(26, 'Fixed-length text of 26 characters, the column a ULID is stored in.'),
      Nanoid: charAlias(
        21,
        'Fixed-length text of 21 characters, the column a nanoid of the default size is stored in.',
      ),
      Cuid2: charAlias(24, 'Fixed-length text of 24 characters, the column a CUID2 is stored in.'),
      Ksuid: charAlias(27, 'Fixed-length text of 27 characters, the column a KSUID is stored in.'),
    });
  });

  it('are looked up as a top-level name first, then in sql', () => {
    expect(GENERATED_ID_COLUMN_ALIAS_NAMESPACES).toEqual([[], ['sql']]);
  });
});
