import type { Contract, ContractModelBase, ContractRelation } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

function installNamespacedTableDeletionRace(ir: Contract, tableName: string): void {
  const originalStorage = ir.storage as {
    namespaces: Record<string, { entries: Record<string, Record<string, unknown>> }>;
  };
  let tableDeleted = false;
  const proxiedStorage = new Proxy(originalStorage, {
    get(target, prop, receiver) {
      if (prop === 'namespaces') {
        return new Proxy(target.namespaces, {
          get(nsTarget, nsKey) {
            if (nsKey !== UNBOUND_NAMESPACE_ID) {
              return Reflect.get(nsTarget, nsKey, nsTarget);
            }
            const inner = Reflect.get(nsTarget, nsKey) as {
              entries: Record<string, Record<string, unknown>>;
            };
            return new Proxy(inner, {
              get(innerTarget, innerProp) {
                if (innerProp !== 'entries') {
                  return Reflect.get(innerTarget, innerProp, innerTarget);
                }
                return new Proxy(innerTarget.entries, {
                  get(entriesTarget, entriesProp) {
                    if (entriesProp !== 'table') {
                      return Reflect.get(entriesTarget, entriesProp, entriesTarget);
                    }
                    return new Proxy(entriesTarget['table'] ?? {}, {
                      get(tableTarget, tableProp) {
                        if (tableProp === tableName && tableDeleted) {
                          return undefined;
                        }
                        return Reflect.get(tableTarget, tableProp, tableTarget);
                      },
                      has(tableTarget, tableProp) {
                        return Reflect.has(tableTarget, tableProp);
                      },
                      ownKeys(tableTarget) {
                        return Reflect.ownKeys(tableTarget);
                      },
                    });
                  },
                });
              },
            });
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  delete originalStorage.namespaces[UNBOUND_NAMESPACE_ID]!.entries['table']![tableName];
  tableDeleted = true;
  (ir as { storage: unknown }).storage = proxiedStorage;
}

describe('sql-target-family-hook', () => {
  it('validates SQL structure', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });

  it('throws error for invalid structure', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: { namespaceId: '__unbound__', table: 'nonexistent', fields: {} },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow();
  });

  it('validates structure with model field missing column property', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: {
              id: {},
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing column property');
  });

  it('validates structure with missing targetFamily', () => {
    const ir = {
      ...createContract({}),
      targetFamily: undefined as unknown as string,
    } as Contract;

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('Expected targetFamily "sql"');
  });

  it('validates structure with missing storage', () => {
    const ir = createContract({
      storage: undefined as unknown as Record<string, unknown>,
    }) as Contract;

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('SQL contract must have storage.namespaces');
  });

  it('validates structure with missing storage.tables', () => {
    const ir = createContract({
      storage: {},
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('SQL contract must have storage.namespaces');
  });

  it('validates structure with model missing storage.table', () => {
    const ir = createContract({
      models: {
        User: { fields: {}, relations: {} } as ContractModelBase,
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing storage.table');
  });

  it('validates structure with model referencing non-existent table', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: { namespaceId: '__unbound__', table: 'nonexistent', fields: {} },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure with model table without primary key', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: { email: { column: 'email' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });

  it('validates structure with model field referencing non-existent column', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: { id: { column: 'nonexistent' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('references non-existent column');
  });

  it('validates structure with missing model storage.fields', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: { namespaceId: '__unbound__', table: 'user' },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing storage.fields');
  });

  it('validates structure with primaryKey referencing non-existent column', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['nonexistent'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('primaryKey references non-existent column');
  });

  it('validates structure with unique constraint referencing non-existent column', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['nonexistent'] }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('unique constraint references non-existent column');
  });

  it('validates structure with index referencing non-existent column', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ name: 'user_nonexistent_idx', columns: ['nonexistent'], unique: false }],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('index references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent column', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              userId: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['nonexistent'],
                },

                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey referencing non-existent table', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              userId: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['userId'],
                },

                target: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'nonexistent',
                  columns: ['id'],
                },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('foreignKey references non-existent table');
  });

  it('validates structure with foreignKey referencing non-existent referenced column', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              userId: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['userId'],
                },

                target: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'user',
                  columns: ['nonexistent'],
                },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('foreignKey references non-existent column');
  });

  it('validates structure with foreignKey column count mismatch', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              userId: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['userId'],
                },

                target: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'user',
                  columns: ['id', 'id'],
                },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('column count');
  });

  it('validates structure with model missing relations', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          relations: undefined as unknown as Record<string, ContractRelation>,
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "relations"');
  });

  it('validates structure with model relations not an object', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          relations: 'invalid' as unknown as Record<string, ContractRelation>,
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "relations"');
  });

  it('validates structure with uniques not an array', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: 'invalid' as unknown,
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "uniques"');
  });

  it('validates structure with indexes not an array', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: 'invalid' as unknown,
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "indexes"');
  });

  it('validates structure with foreignKeys not an array', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: 'invalid' as unknown,
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('is missing required field "foreignKeys"');
  });

  it('validates structure with table missing from storage.tables after check', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    installNamespacedTableDeletionRace(ir, 'user');

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure with referenced table missing from storage.tables after check', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              userId: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['userId'],
                },

                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    installNamespacedTableDeletionRace(ir, 'user');

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('references non-existent table');
  });

  it('validates structure without models', () => {
    const ir = createContract({
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });

  it('validates structure with table without primary key when no models', () => {
    const ir = createContract({
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });

  it('accepts extension-owned index config payloads without core-specific validation', () => {
    const ir = createContract({
      storage: {
        tables: {
          items: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              description: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                columns: ['description'],
                type: 'bm25',
                options: {
                  keyField: 'id',
                  fields: [{ column: 'description', tokenizer: 'simple' }],
                },
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });

  it('still validates index column references independent of extension options', () => {
    const ir = createContract({
      storage: {
        tables: {
          items: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              description: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                columns: ['nonexistent'],
                type: 'bm25',
                options: {
                  keyField: 'id',
                  fields: [{ expression: "description || ' ' || category", tokenizer: 'simple' }],
                },
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).toThrow('index references non-existent column');
  });

  it('validates structure with complex valid contract', () => {
    const ir = createContract({
      models: {
        User: {
          fields: {},
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: {
              id: { column: 'id' },
              email: { column: 'email' },
            },
          },
          relations: {},
        },
        Post: {
          fields: {},
          storage: {
            namespaceId: '__unbound__',
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
              title: { column: 'title' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'] }],
            indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false }],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              userId: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              title: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ name: 'post_userId_idx', columns: ['userId'], unique: false }],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['userId'],
                },

                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    expect(() => {
      sqlEmission.validateStructure(ir);
    }).not.toThrow();
  });
});
