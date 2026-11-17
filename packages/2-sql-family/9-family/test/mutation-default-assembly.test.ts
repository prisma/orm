import type { ComponentDescriptor } from '@internal/framework-components/components';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';

function createDescriptor(
  id: string,
  options?: Partial<ComponentDescriptor<string>>,
): ComponentDescriptor<string> {
  return {
    kind: 'target',
    id,
    version: '0.0.1',
    ...options,
  } as ComponentDescriptor<string>;
}

describe('assembleAuthoringContributions', () => {
  it('collects authoring type helper contributions', () => {
    const first = createDescriptor('first', {
      authoring: {
        type: {
          enum: {
            kind: 'typeConstructor',
            args: [
              { kind: 'value', dataType: 'sql/text' },
              { kind: 'value', dataType: 'sql/int' },
            ],
            output: {
              codecId: 'app/test-type@1',
              typeParams: {
                values: { kind: 'arg', index: 1 },
              },
            },
          },
        },
      },
    });
    const second = createDescriptor('second', {
      authoring: {
        type: {
          pgvector: {
            Vector: {
              kind: 'typeConstructor',
              args: [{ kind: 'value', dataType: 'sql/int', name: 'length' }],
              output: {
                codecId: 'pg/vector@1',
                typeParams: {
                  length: { kind: 'arg', index: 0 },
                },
              },
            },
          },
        },
      },
    });

    const contributions = assembleAuthoringContributions([first, second]);

    expect(contributions.type).toMatchObject({
      enum: {
        kind: 'typeConstructor',
      },
      pgvector: {
        Vector: {
          kind: 'typeConstructor',
        },
      },
    });
  });

  it('throws for duplicate authoring helper names', () => {
    const first = createDescriptor('first', {
      authoring: {
        type: {
          enum: {
            kind: 'typeConstructor',
            args: [
              { kind: 'value', dataType: 'sql/text' },
              { kind: 'value', dataType: 'sql/int' },
            ],
            output: {
              codecId: 'app/test-type@1',
            },
          },
        },
      },
    });
    const second = createDescriptor('second', {
      authoring: {
        type: {
          enum: {
            kind: 'typeConstructor',
            args: [
              { kind: 'value', dataType: 'sql/text' },
              { kind: 'value', dataType: 'sql/int' },
            ],
            output: {
              codecId: 'conflict/enum@1',
            },
          },
        },
      },
    });

    expect(() => assembleAuthoringContributions([first, second])).toThrow(
      /Duplicate authoring type helper "enum"/,
    );
  });

  it('rejects dangerous authoring helper path segments', () => {
    const maliciousTypeNamespace = JSON.parse(`
      {
        "__proto__": {
          "polluted": {
            "kind": "typeConstructor",
            "output": {
              "codecId": "conflict/text@1"
            }
          }
        }
      }
    `);

    const descriptor = createDescriptor('malicious', {
      authoring: {
        type: maliciousTypeNamespace,
      },
    });

    try {
      expect(() => assembleAuthoringContributions([descriptor])).toThrow(
        /Invalid authoring type helper "__proto__"/,
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>)['polluted'];
    }
  });
});
