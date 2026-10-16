import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';

export const sqlFamilyAuthoringTypes = {
  Raw: {
    kind: 'typeConstructor',
    documentation:
      'A column of a type no other column type covers, written exactly as the database catalog prints it, such as Raw("tsvector"). Its values are typed unknown, and its default is a sql expression.',
    args: [{ kind: 'string', name: 'sql' }],
    output: {
      codecId: 'sql/raw@1',
      typeParams: { sql: { kind: 'arg', index: 0 } },
    },
  },
  sql: {
    String: {
      kind: 'typeConstructor',
      documentation: 'Variable-length text with a required maximum character length.',
      args: [{ kind: 'number', name: 'length', integer: true }],
      output: {
        codecId: 'sql/varchar@1',
        typeParams: {
          length: { kind: 'arg', index: 0 },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;
