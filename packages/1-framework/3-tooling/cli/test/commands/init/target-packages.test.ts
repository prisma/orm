import { describe, expect, it } from 'vitest';
import {
  findPrisma6OnlyTarget,
  findTargetByName,
  findTargetByProvider,
  firstInstallDrivers,
  listedTargetPackage,
  reportedTargetName,
  unlistedTargetPackage,
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

  it('reports an unlisted package by its name, with no drivers known before its install', () => {
    const target = unlistedTargetPackage('prisma-orm-somedb');

    expect(target).toEqual({ packageName: 'prisma-orm-somedb', listed: undefined });
    expect(reportedTargetName(target)).toBe('prisma-orm-somedb');
    expect(firstInstallDrivers(target)).toEqual([]);
  });

  it('reports a listed package by its short name, with the drivers its entry names', () => {
    const entry = findTargetByName('mongo');
    if (entry === undefined) throw new Error('mongo is not in the list');
    const target = listedTargetPackage(entry);

    expect(target).toEqual({ packageName: '@prisma/orm-mongo', listed: entry });
    expect(reportedTargetName(target)).toBe('mongodb');
    expect(firstInstallDrivers(target)).toEqual(['mongodb']);
  });
});
