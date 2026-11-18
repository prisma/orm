import { describe, expect, it } from 'vitest';
import {
  findPrisma6OnlyTarget,
  findTargetByName,
  findTargetByProvider,
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
});
