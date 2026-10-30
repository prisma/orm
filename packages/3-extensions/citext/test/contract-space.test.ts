import { describe, expect, it } from 'vitest';
import installOps from '../migrations/20261029T1520_create_citext_extension/ops.json' with {
  type: 'json',
};
import contractJson from '../src/contract.json' with { type: 'json' };
import citextControl from '../src/exports/control';

describe('the citext contract space', () => {
  it('declares the citext extension in public', () => {
    expect(contractJson.storage.namespaces.public.entries.extension).toEqual({
      citext: { kind: 'extension', name: 'citext' },
    });
  });

  it('reaches its head from the empty contract with one migration that records no invariant', () => {
    const space = citextControl.contractSpace;
    expect({
      id: citextControl.id,
      head: space?.headRef,
      migrations: space?.migrations.map((migration) => ({
        dirName: migration.dirName,
        from: migration.metadata.from,
        to: migration.metadata.to,
        invariants: migration.metadata.providedInvariants,
      })),
    }).toEqual({
      id: 'citext',
      head: { hash: contractJson.storage.storageHash, invariants: [] },
      migrations: [
        {
          dirName: '20261029T1520_create_citext_extension',
          from: null,
          to: contractJson.storage.storageHash,
          invariants: [],
        },
      ],
    });
  });

  it('creates the extension in public', () => {
    expect(installOps.flatMap((op) => op.execute.map((step) => step.sql))).toEqual([
      'CREATE SCHEMA IF NOT EXISTS "public"',
      'CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA "public"',
    ]);
  });
});
