import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { PostgresExtension, type PostgresSchema } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { defineContract, extension, field, model } from '../../src/exports/contract-builder';

const User = model('User', { fields: { id: field.column({ codecId: 'pg/int4@1' }).id() } });

function extensionsIn(contract: { storage: { namespaces: Record<string, unknown> } }, id: string) {
  return (contract.storage.namespaces[id] as PostgresSchema | undefined)?.extension;
}

describe('extension() in the Postgres contract builder', () => {
  it('files an extension under the default namespace', () => {
    const contract = defineContract({ models: { User }, entities: [extension('pg_trgm')] });
    expect(extensionsIn(contract, 'public')).toEqual({
      pg_trgm: new PostgresExtension({ name: 'pg_trgm' }),
    });
  });

  it('files an extension under the namespace it names', () => {
    const contract = defineContract({
      namespaces: ['extensions'],
      models: { User },
      entities: [extension('postgis', { namespace: 'extensions' })],
    });
    expect(extensionsIn(contract, 'extensions')).toEqual({
      postgis: new PostgresExtension({ name: 'postgis' }),
    });
    expect(extensionsIn(contract, 'public')).toEqual({});
  });

  it('builds the same contract JSON a PSL extension block does', () => {
    const contract = defineContract({ models: { User }, entities: [extension('pg_trgm')] });
    const json = JSON.parse(
      JSON.stringify(new PostgresContractSerializer().serializeContract(contract)),
    );
    expect(json.storage.namespaces.public.entries.extension).toEqual({
      pg_trgm: { kind: 'extension', name: 'pg_trgm' },
    });
  });

  it('refuses one extension declared in two namespaces', () => {
    expect(() =>
      defineContract({
        namespaces: ['extensions'],
        models: { User },
        entities: [extension('postgis'), extension('postgis', { namespace: 'extensions' })],
      }),
    ).toThrow(
      'defineContract: extension "postgis" is declared in namespaces "extensions" and "public"; declare it in one namespace only.',
    );
  });

  it('refuses one extension declared twice in one namespace', () => {
    expect(() =>
      defineContract({ models: { User }, entities: [extension('vector'), extension('vector')] }),
    ).toThrow('defineContract: extension "vector" is declared more than once.');
  });

  it('refuses an empty name', () => {
    expect(() => extension(' ')).toThrow('extension(" "): name must be a non-empty string.');
  });
});
