import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';

export const sqlFamilyAuthoringTypes = {
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
