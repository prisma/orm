import { readFileSync } from 'node:fs';
import { computeMigrationHash, verifyMigrationHash } from '@internal/migration-tools/hash';
import { readMigrationPackage } from '@internal/migration-tools/io';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { readSqliteOperations } from '../../src/core/migrations/read-operations';

const migrationsDir = join(import.meta.dirname, 'fixtures/earlier-shapes');
const packageDir = join(migrationsDir, 'app/20261127T0000_earlier_shapes');
const storedOps: unknown = JSON.parse(readFileSync(join(packageDir, 'ops.json'), 'utf8'));
const storedHash = 'd9b82751aaffe7f1eadb73507b97e66a076bf355b4b9e2cd6b2c2fe6486648a3';

describe('a saved migration whose ops.json holds operation shapes earlier releases wrote', () => {
  it('verifies against the migrationHash of the file as stored', async () => {
    const pkg = await readMigrationPackage(packageDir, { migrationsDir });
    expect({ ops: pkg.ops, verification: verifyMigrationHash(pkg) }).toEqual({
      ops: storedOps,
      verification: { ok: true, storedHash, computedHash: storedHash },
    });
  });

  it('is read as the current shapes, which would hash differently', async () => {
    const pkg = await readMigrationPackage(packageDir, { migrationsDir });
    const read = readSqliteOperations(pkg.ops);
    expect({
      details: read.map((operation) => operation.target.details),
      removalMark: read[1]?.precheck[0]?.meta?.['rowsHoldingValue'],
      opsAfterReading: pkg.ops,
      hashOfReadShapes: computeMigrationHash(pkg.metadata, read) === storedHash,
    }).toEqual({
      details: [
        { objectType: 'table', name: 'User' },
        { objectType: 'column', name: 'state', table: 'task' },
      ],
      removalMark: {
        enumValue: { enum: 'Status', member: 'ARCHIVED' },
        value: 'archived',
        table: 'task',
        column: 'state',
        storedValue: 'archived',
      },
      opsAfterReading: storedOps,
      hashOfReadShapes: false,
    });
  });
});
