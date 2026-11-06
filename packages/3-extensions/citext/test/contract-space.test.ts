import { describe, expect, it } from 'vitest';
import installOps from '../migrations/20261029T1520_create_citext_extension/ops.json' with {
  type: 'json',
};
import searchPathMetadata from '../migrations/20261106T1036_find_citext_on_search_path/migration.json' with {
  type: 'json',
};
import searchPathOps from '../migrations/20261106T1036_find_citext_on_search_path/ops.json' with {
  type: 'json',
};
import searchPathInstallOps from '../migrations/20261106T1401_install_citext_on_search_path/ops.json' with {
  type: 'json',
};
import contractJson from '../src/contract.json' with { type: 'json' };
import citextControl from '../src/exports/control';

describe('the citext contract space', () => {
  it('declares the citext extension in the unbound namespace', () => {
    expect(contractJson.storage.namespaces.__unbound__.entries.extension).toEqual({
      citext: { kind: 'extension', name: 'citext' },
    });
  });

  it('reaches its head from the empty contract, directly or through its first head, with migrations that record no invariant', () => {
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
          to: searchPathMetadata.from,
          invariants: [],
        },
        {
          dirName: '20261106T1036_find_citext_on_search_path',
          from: searchPathMetadata.from,
          to: contractJson.storage.storageHash,
          invariants: [],
        },
        {
          dirName: '20261106T1401_install_citext_on_search_path',
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

  it('finds the extension it created in public through the search path, so moving to the head runs nothing', () => {
    expect(searchPathOps).toEqual([]);
  });

  it('creates the extension with no schema named when it builds a new database at the head', () => {
    expect(searchPathInstallOps.flatMap((op) => op.execute.map((step) => step.sql))).toEqual([
      'CREATE SCHEMA IF NOT EXISTS "public"',
      'CREATE EXTENSION IF NOT EXISTS "citext"',
    ]);
  });
});
