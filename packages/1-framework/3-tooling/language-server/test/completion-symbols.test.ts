import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { classifyPslCompletionContext } from '../src/completion-context';
import { localFieldNames, referencedFieldNames } from '../src/completion-symbols';

function fields(
  sourceWithCursor: string,
  scalarTypes: readonly string[] = ['String', 'Int'],
  typeConstructors?: AuthoringTypeNamespace,
) {
  const offset = sourceWithCursor.indexOf('|');
  const { document, sourceFile } = parse(sourceWithCursor.replace('|', ''));
  const { table } = buildSymbolTable({ document, sourceFile, pslBlockDescriptors: {} });
  const context = classifyPslCompletionContext({
    document,
    sourceFile,
    position: sourceFile.positionAt(offset),
  });
  if (context.kind !== 'fieldAttributeValue' && context.kind !== 'modelAttributeValue') {
    throw new Error(`Unexpected context: ${context.kind}`);
  }
  return {
    local: localFieldNames(context, table, scalarTypes, typeConstructors),
    referenced: referencedFieldNames(context, table, scalarTypes, typeConstructors),
  };
}

const declarations = `types {
  Identifier = String
  UnknownAlias = Missing
  Constructed = custom.Value()
}
type Address { street String }
model Other { id Int }`;
const mixedFields = `id Int
  optional String?
  many String[]
  refined Identifier
  relation Other
  relations Other[]
  composite Address
  composites Address[]
  unknown Missing
  unknownAlias UnknownAlias
  constructed Constructed
  qualified missing.String
  external foreign:String
  malformed too.many.String`;
const scalarFields = ['id', 'optional', 'many', 'refined'];

describe('scalar field reference candidates', () => {
  it('includes registered inline and aliased scalar constructors in local and referenced fields', () => {
    const typeConstructors: AuthoringTypeNamespace = {
      sql: {
        String: { kind: 'typeConstructor', output: { codecId: 'text', nativeType: 'varchar' } },
      },
      pg: {
        enum: {
          kind: 'typeConstructor',
          output: { codecId: 'enum' },
          entityRefArg: { index: 0, entityKind: 'native_enum' },
        },
      },
    };
    const source = `types {
  Name = sql.String(100)
  Status = pg.enum(StatusValues)
  Unknown = missing.Value()
}
model Owner {
  name Name
  status Status
  inline sql.String(100)
  inlineEnum pg.enum(StatusValues)
  optional sql.String(100)?
  list sql.String(100)[]
  unknown Unknown
  unknownInline missing.Value()
  notAConstructor sql()
  notACall sql.String
  external foreign:sql.String(100)
  self Owner @probe(fields: [|])
}`;
    const expected = ['name', 'status', 'inline', 'inlineEnum', 'optional', 'list'];
    expect(fields(source, [], typeConstructors)).toEqual({ local: expected, referenced: expected });
    expect(fields(source, [])).toEqual({ local: [], referenced: [] });
  });

  it('filters local fields in field attribute arguments', () => {
    expect(
      fields(`${declarations}\nmodel Owner { ${mixedFields}\n target Other @probe(fields: [|]) }`),
    ).toEqual({
      local: scalarFields,
      referenced: ['id'],
    });
  });

  it('filters local fields in model attribute arguments', () => {
    expect(
      fields(`${declarations}\nmodel Owner { ${mixedFields}\n @@probe(fields: [|]) }`),
    ).toEqual({
      local: scalarFields,
      referenced: [],
    });
  });

  it('filters fields on the referenced model', () => {
    expect(
      fields(
        `${declarations}\nmodel Target { ${mixedFields} }\nmodel Owner { target Target @probe(references: [|]) }`,
      ),
    ).toEqual({
      local: [],
      referenced: scalarFields,
    });
  });

  it('uses configured scalars rather than a fixed builtin list', () => {
    expect(
      fields('model Owner { id Custom\n name String\n @@probe(fields: [|]) }', ['Custom']),
    ).toEqual({
      local: ['id'],
      referenced: [],
    });
  });

  it('respects namespace model and composite names shadowing scalar names and aliases', () => {
    expect(
      fields(`types { Identifier = String }
namespace scoped {
  model String { id Int }
  type Identifier { id Int }
  model Owner {
    id Int
    relation String
    composite Identifier
    @@probe(fields: [|])
  }
}`),
    ).toEqual({ local: ['id'], referenced: [] });
  });

  it('classifies referenced fields in the target namespace, not the owner namespace', () => {
    expect(
      fields(`namespace owner {
  model Owner { target remote.Target @probe(references: [|]) }
}
namespace remote {
  type String { value Int }
  model Target { id Int\n composite String\n relation Target }
}`),
    ).toEqual({ local: [], referenced: ['id'] });
  });

  it('excludes top-level model and composite names even when configured as scalars', () => {
    expect(
      fields(
        'model String { id Int }\ntype Custom { value Int }\nmodel Owner { id Int\n relation String\n composite Custom\n @@probe(fields: [|]) }',
        ['Int', 'String', 'Custom'],
      ),
    ).toEqual({ local: ['id'], referenced: [] });
  });
});
