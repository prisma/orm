import { describe, expect, it } from 'vitest';
import {
  findPrisma6OnlyTarget,
  findTargetByName,
  findTargetByProvider,
  targetPackageNamed,
} from '../../../src/commands/init/target-packages';

describe('the list of known target packages', () => {
  it.each([
    ['postgresql', 'postgres'],
    ['postgres', 'postgres'],
    ['mongodb', 'mongodb'],
    ['sqlite', undefined],
    ['PostgreSQL', undefined],
  ])('maps the datasource provider %s to %s', (provider, shortName) => {
    expect(findTargetByProvider(provider)?.shortName).toBe(shortName);
  });

  it.each([
    ['postgres', 'postgres'],
    ['PostgreSQL', 'postgres'],
    ['mongo', 'mongodb'],
    ['MongoDB', 'mongodb'],
    ['@prisma/orm-postgres', 'postgres'],
    ['@Prisma/orm-postgres', undefined],
    ['@internal/postgres', undefined],
    ['sqlite', undefined],
  ])('finds --target %s as %s', (value, shortName) => {
    expect(findTargetByName(value)?.shortName).toBe(shortName);
  });

  it.each([
    ['mongodb', 'mongodb'],
    ['postgresql', undefined],
    [undefined, undefined],
  ])('treats a schema with provider %s as a Prisma 6 schema of %s', (provider, shortName) => {
    expect(findPrisma6OnlyTarget(provider)?.shortName).toBe(shortName);
  });

  it('names every package by its published name', () => {
    expect(findTargetByName('postgres')?.packageName).toBe('@prisma/orm-postgres');
    expect(findTargetByName('mongodb')?.packageName).toBe('@prisma/orm-mongo');
  });

  it('takes a value in no entry as the name of a package with no drivers known before its install', () => {
    expect(targetPackageNamed('prisma-orm-somedb')).toEqual({
      packageName: 'prisma-orm-somedb',
      name: 'prisma-orm-somedb',
      peerPackages: [],
      listed: undefined,
    });
  });

  it('takes a listed value as its entry, with the drivers the entry names', () => {
    expect(targetPackageNamed('mongo')).toMatchObject({
      packageName: '@prisma/orm-mongo',
      name: 'mongodb',
      peerPackages: ['mongodb'],
      listed: { shortName: 'mongodb' },
    });
  });
});
