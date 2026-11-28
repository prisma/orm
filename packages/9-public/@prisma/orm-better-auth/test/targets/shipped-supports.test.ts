import { postgresCodecDescriptorRegistry } from '@prisma/orm-postgres/target/codecs';
import postgresPack from '@prisma/orm-postgres/target/pack';
import { sqliteCodecDescriptorRegistry } from '@prisma/orm-sqlite/target/codecs';
import sqlitePack from '@prisma/orm-sqlite/target/pack';
import { describe, expect, it } from 'vitest';
import { postgresSupport } from '../../src/targets/postgres';
import { shippedTargetSupports } from '../../src/targets/shipped';
import { sqliteSupport } from '../../src/targets/sqlite';

const shipped = [
  {
    support: postgresSupport,
    pack: postgresPack,
    codecIds: [...postgresCodecDescriptorRegistry.values()].map(({ codecId }) => codecId),
  },
  {
    support: sqliteSupport,
    pack: sqlitePack,
    codecIds: [...sqliteCodecDescriptorRegistry.values()].map(({ codecId }) => codecId),
  },
];

it('ships one support for each of these targets', () => {
  expect(shippedTargetSupports.map(({ target }) => target)).toEqual(
    shipped.map(({ pack }) => pack.targetId),
  );
});

describe.each(shipped)('the $pack.targetId support', ({ support, pack, codecIds }) => {
  it('is for the target its target package describes', () => {
    expect(support.target).toBe(pack.targetId);
  });

  it('states a value kind for every codec the target package publishes', () => {
    expect(codecIds.length).toBeGreaterThan(10);
    expect(codecIds.filter((codecId) => support.valueKind(codecId) === undefined)).toEqual([]);
  });

  it("has the default namespace of the target's descriptor", () => {
    expect(support.defaultNamespace).toBe(pack.defaultNamespaceId);
  });
});
