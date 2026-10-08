import type { ControlStack } from '@internal/framework-components/control';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import type { MigrationMetadata } from '../src/metadata';
import { buildMigrationArtifacts, Migration } from '../src/migration-base';

describe('Migration', () => {
  describe('operations + describe() contract', () => {
    it('subclasses expose operations via the getter and describe() metadata', async () => {
      class TestMigration extends Migration<{
        id: string;
        label: string;
        operationClass: 'additive';
      }> {
        readonly targetId = 'test';
        override get operations() {
          return [
            { id: 'op1', label: 'Op 1', operationClass: 'additive' as const },
            { id: 'op2', label: 'Op 2', operationClass: 'additive' as const },
          ];
        }
        override describe() {
          return { from: 'abc', to: 'def' };
        }
      }

      const m = new TestMigration();
      expect(m.operations).toEqual([
        { id: 'op1', label: 'Op 1', operationClass: 'additive' },
        { id: 'op2', label: 'Op 2', operationClass: 'additive' },
      ]);
      expect(m.describe()).toEqual({ from: 'abc', to: 'def' });
    });

    it('derives origin/destination from describe()', async () => {
      class TestMigration extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: 'hashFrom', to: 'hashTo' };
        }
      }

      const m = new TestMigration();
      expect(m.origin).toEqual({ storageHash: 'hashFrom' });
      expect(m.destination).toEqual({ storageHash: 'hashTo' });
    });

    it('returns a null origin when from is null (baseline plan)', async () => {
      class InitialMigration extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: null, to: 'to' };
        }
      }

      expect(new InitialMigration().origin).toBeNull();
    });

    it('wraps from as a storage-hash origin when describe() returns a string', async () => {
      class NonBaselineMigration extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: 'abc', to: 'def' };
        }
      }

      expect(new NonBaselineMigration().origin).toEqual({ storageHash: 'abc' });
    });
  });

  describe('derived describe() from contract JSON', () => {
    const endJson = { storage: { storageHash: 'endhash' } };
    const startJson = { storage: { storageHash: 'starthash' } };

    it('derives to from endContractJson.storage.storageHash and from:null when no start', async () => {
      class M extends Migration {
        readonly targetId = 'test';
        override readonly endContractJson = endJson;
        override get operations() {
          return [];
        }
      }
      const m = new M();
      expect(m.describe()).toEqual({ from: null, to: 'endhash' });
      expect(m.origin).toBeNull();
      expect(m.destination).toEqual({ storageHash: 'endhash' });
    });

    it('derives from from startContractJson.storage.storageHash when present', async () => {
      class M extends Migration {
        readonly targetId = 'test';
        override readonly startContractJson = startJson;
        override readonly endContractJson = endJson;
        override get operations() {
          return [];
        }
      }
      const m = new M();
      expect(m.describe()).toEqual({ from: 'starthash', to: 'endhash' });
      expect(m.origin).toEqual({ storageHash: 'starthash' });
    });

    it('throws MIGRATION.DESCRIBE_INVALID when neither endContractJson nor a describe() override is present', async () => {
      class M extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
      }
      let thrown: unknown;
      try {
        new M().describe();
      } catch (error) {
        thrown = error;
      }
      expect(isStructuredError(thrown)).toBe(true);
      expect(thrown).toMatchObject({ code: 'MIGRATION.DESCRIBE_INVALID' });
      expect((thrown as Error).message).toMatch(/endContractJson or override describe\(\)/);
    });

    it('a describe() override still wins over the derived default', async () => {
      class M extends Migration {
        readonly targetId = 'test';
        override readonly endContractJson = endJson;
        override get operations() {
          return [];
        }
        override describe() {
          return { from: null, to: 'overridden' };
        }
      }
      expect(new M().describe()).toEqual({ from: null, to: 'overridden' });
    });
  });

  describe('constructor accepts and stores a ControlStack', () => {
    /**
     * The constructor injection contract is that a subclass (e.g.
     * `PostgresMigration`) can read `this.stack` to materialize whatever it
     * needs (typically a control adapter). The base class itself stores the
     * argument verbatim; this test exercises that storage directly via a
     * subclass that exposes the protected field, independent of any concrete
     * target's stack-consumption logic.
     */
    it('stores the injected stack on the protected `stack` field', async () => {
      const stub = { sentinel: true } as unknown as ControlStack<'sql', 'test'>;

      class StackProbe extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: 'a', to: 'b' };
        }
        public readStack(): unknown {
          return this.stack;
        }
      }

      expect(new StackProbe(stub).readStack()).toBe(stub);
    });

    it('leaves `stack` undefined when constructed without an argument', async () => {
      class StackProbe extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: 'a', to: 'b' };
        }
        public readStack(): unknown {
          return this.stack;
        }
      }

      expect(new StackProbe().readStack()).toBeUndefined();
    });
  });
});

/**
 * Direct unit tests for `buildMigrationArtifacts` — the pure
 * `Migration` → in-memory artifact conversion. File I/O (reading
 * existing `migration.json`, writing the rendered artifacts to disk,
 * dry-run stdout output) lives in `@internal/cli` and is exercised
 * there.
 */
describe('buildMigrationArtifacts', () => {
  function makeMigration(
    operations: unknown,
    meta: {
      readonly from: string | null;
      readonly to: string;
    } = {
      from: 'abc',
      to: 'def',
    },
  ): Migration {
    class M extends Migration {
      readonly targetId = 'test';
      override get operations() {
        return operations as never;
      }
      override describe() {
        return meta;
      }
    }
    return new M();
  }

  it('produces ops.json + migration.json strings with synthesized metadata fields', async () => {
    const { opsJson, metadata, metadataJson } = await buildMigrationArtifacts(
      makeMigration([{ id: 'op1', label: 'Test op', operationClass: 'additive' }]),
      null,
    );

    expect(JSON.parse(opsJson)).toEqual([
      { id: 'op1', label: 'Test op', operationClass: 'additive' },
    ]);

    expect(metadata.from).toBe('abc');
    expect(metadata.to).toBe('def');
    expect(metadata.migrationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(JSON.parse(metadataJson)).toEqual(metadata);
  });

  it('begins each read of the operations before building, so each build reads them from the start', async () => {
    const events: string[] = [];
    class M extends Migration {
      readonly targetId = 'test';
      override get operations() {
        events.push('read operations');
        return [{ id: 'op1', label: 'Test op', operationClass: 'additive' }] as never;
      }
      override describe() {
        return { from: 'abc', to: 'def' };
      }
      protected override beginOperationsRead(): void {
        events.push('begin');
      }
    }
    const migration = new M();

    await buildMigrationArtifacts(migration, null);
    await buildMigrationArtifacts(migration, null);

    expect(events).toEqual(['begin', 'read operations', 'begin', 'read operations']);
  });

  it('preserves createdAt from existing metadata', async () => {
    const existingMetadata: Partial<MigrationMetadata> = {
      from: 'from',
      to: 'to',
      createdAt: '2026-01-15T10:00:00.000Z',
    };

    const { metadata } = await buildMigrationArtifacts(
      makeMigration([{ id: 'op1', label: 'Edited op', operationClass: 'additive' }], {
        from: 'from',
        to: 'to',
      }),
      existingMetadata,
    );

    expect(metadata.createdAt).toBe(existingMetadata.createdAt);
    expect(metadata.migrationHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws MIGRATION.PLAN_NOT_ARRAY when operations is not an array', async () => {
    const thrown = await buildMigrationArtifacts(makeMigration('not an array'), null).then(
      () => {
        throw new Error('expected buildMigrationArtifacts to reject');
      },
      (error: unknown) => error,
    );
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: 'MIGRATION.PLAN_NOT_ARRAY',
      message: 'operations must be an array',
    });
  });

  it('throws MIGRATION.DESCRIBE_INVALID when describe() returns invalid metadata', async () => {
    class M extends Migration {
      readonly targetId = 'test';
      override get operations(): readonly [] {
        return [];
      }
      override describe() {
        return { from: 42, to: 'def' } as unknown as ReturnType<Migration['describe']>;
      }
    }
    const thrown = await buildMigrationArtifacts(new M(), null).then(
      () => {
        throw new Error('expected buildMigrationArtifacts to reject');
      },
      (error: unknown) => error,
    );
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ code: 'MIGRATION.DESCRIBE_INVALID' });
    expect((thrown as Error).message).toMatch(/describe\(\) returned invalid metadata/);
  });

  it('throws MIGRATION.INVALID_OPERATION_ENTRY when an entry is missing id', async () => {
    const ops = [{ label: 'No id', operationClass: 'additive' }];
    await expect(buildMigrationArtifacts(makeMigration(ops), null)).rejects.toThrowError(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_OPERATION_ENTRY',
        meta: expect.objectContaining({ index: 0 }),
      }) as unknown as Error,
    );
  });

  it('throws MIGRATION.INVALID_OPERATION_ENTRY when an entry is missing label', async () => {
    const ops = [{ id: 'op1', operationClass: 'additive' }];
    await expect(buildMigrationArtifacts(makeMigration(ops), null)).rejects.toThrowError(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_OPERATION_ENTRY',
        meta: expect.objectContaining({ index: 0 }),
      }) as unknown as Error,
    );
  });

  it('throws MIGRATION.INVALID_OPERATION_ENTRY when an entry is missing operationClass', async () => {
    const ops = [{ id: 'op1', label: 'No class' }];
    await expect(buildMigrationArtifacts(makeMigration(ops), null)).rejects.toThrowError(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_OPERATION_ENTRY',
        meta: expect.objectContaining({ index: 0 }),
      }) as unknown as Error,
    );
  });

  it('throws MIGRATION.INVALID_OPERATION_ENTRY when operationClass is outside the allowed union', async () => {
    const ops = [{ id: 'op1', label: 'Bad class', operationClass: 'unknown' }];
    await expect(buildMigrationArtifacts(makeMigration(ops), null)).rejects.toThrowError(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_OPERATION_ENTRY',
        meta: expect.objectContaining({ index: 0 }),
      }) as unknown as Error,
    );
  });

  it('reports the offending entry index when later entries in the array are malformed', async () => {
    const ops = [
      { id: 'op1', label: 'Good', operationClass: 'additive' },
      { id: 'op2', label: 'Good', operationClass: 'widening' },
      { id: 'op3', label: 'Bad', operationClass: 'totally-wrong' },
    ];
    await expect(buildMigrationArtifacts(makeMigration(ops), null)).rejects.toThrowError(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_OPERATION_ENTRY',
        meta: expect.objectContaining({ index: 2 }),
      }) as unknown as Error,
    );
  });

  it('throws a clear error when describe() returns invalid metadata', async () => {
    await expect(
      buildMigrationArtifacts(
        makeMigration([{ id: 'op1', label: 'Op 1', operationClass: 'additive' }], {
          bad: true,
        } as never),
        null,
      ),
    ).rejects.toThrow(/describe\(\).*invalid/);
  });

  // The on-disk loader (`MigrationMetadataSchema` in `io.ts`) rejects
  // `from: ''` so the `describe()` validator must reject the same value.
  // Otherwise an authored migration could self-emit a package whose own
  // loader would refuse to read it back.
  it("rejects describe() returning from: '' (empty-string sentinel is not allowed)", async () => {
    await expect(
      buildMigrationArtifacts(
        makeMigration([{ id: 'op1', label: 'Op 1', operationClass: 'additive' }], {
          from: '',
          to: 'abc',
        }),
        null,
      ),
    ).rejects.toThrow(/describe\(\).*invalid/);
  });

  it('derives providedInvariants from data ops with invariantId (sorted, deduped)', async () => {
    const ops = [
      { id: 'add', label: 'Add', operationClass: 'additive' },
      {
        id: 'data.zebra',
        label: 'Data: zebra',
        operationClass: 'data',
        name: 'zebra',
        invariantId: 'zebra-invariant',
        source: 'migration.ts',
        check: null,
        run: null,
      },
      {
        id: 'data.apple',
        label: 'Data: apple',
        operationClass: 'data',
        name: 'apple',
        invariantId: 'apple-invariant',
        source: 'migration.ts',
        check: null,
        run: null,
      },
    ];

    const { metadata } = await buildMigrationArtifacts(makeMigration(ops), null);
    expect(metadata.providedInvariants).toEqual(['apple-invariant', 'zebra-invariant']);
  });

  it('produces empty providedInvariants when no data ops declare invariantId', async () => {
    const ops = [
      { id: 'add', label: 'Add', operationClass: 'additive' },
      {
        id: 'data.untracked',
        label: 'Data: untracked',
        operationClass: 'data',
        name: 'untracked',
        source: 'migration.ts',
        check: null,
        run: null,
      },
    ];
    const { metadata } = await buildMigrationArtifacts(makeMigration(ops), null);
    expect(metadata.providedInvariants).toEqual([]);
  });

  it('rejects a malformed invariantId at emit time', async () => {
    const ops = [
      {
        id: 'data.bad',
        label: 'Data: bad',
        operationClass: 'data',
        name: 'bad',
        invariantId: 'has a space',
        source: 'migration.ts',
        check: null,
        run: null,
      },
    ];
    await expect(buildMigrationArtifacts(makeMigration(ops), null)).rejects.toThrowError(
      expect.objectContaining({ code: 'MIGRATION.INVALID_INVARIANT_ID' }) as unknown as Error,
    );
  });

  it('rejects duplicate invariantId across data ops at emit time', async () => {
    const ops = [
      {
        id: 'data.first',
        label: 'Data: first',
        operationClass: 'data',
        name: 'first',
        invariantId: 'shared',
        source: 'migration.ts',
        check: null,
        run: null,
      },
      {
        id: 'data.second',
        label: 'Data: second',
        operationClass: 'data',
        name: 'second',
        invariantId: 'shared',
        source: 'migration.ts',
        check: null,
        run: null,
      },
    ];
    await expect(buildMigrationArtifacts(makeMigration(ops), null)).rejects.toThrowError(
      expect.objectContaining({
        code: 'MIGRATION.DUPLICATE_INVARIANT_IN_EDGE',
      }) as unknown as Error,
    );
  });
});
