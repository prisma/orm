import type { ContractSourceFormat } from '@internal/config/config-types';
import { describe, expect, it } from 'vitest';
import contribution from '../../src/exports/init';

const MODES: readonly ContractSourceFormat[] = ['psl', 'typescript'];

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? '',
  );
}

describe('the SQLite init contribution', () => {
  it('names the package, its config module and no drivers to install', () => {
    expect(contribution).toMatchObject({
      label: 'SQLite',
      configModule: '@internal/sqlite/config',
      peerPackages: [],
      authoringModes: ['psl', 'typescript'],
    });
  });

  it('states no server requirement and has no probe, since the database is a file', () => {
    expect(contribution.serverRequirement).toBeUndefined();
    expect(contribution.probe).toBeUndefined();
    expect(contribution.prisma7QuickReference).toBeUndefined();
  });

  it.each(MODES)('imports only from the package in the %s starter contract', (mode) => {
    const specifiers = moduleSpecifiers(contribution.starterContract(mode));
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^@internal\/sqlite\//);
    }
    expect(contribution.starterContract(mode)).toContain('User');
  });

  it('opens the database file DATABASE_URL names, as the config does', () => {
    const db = contribution.databaseFile();

    expect(db).toContain("import 'dotenv/config';");
    expect(db).toContain("from '@internal/sqlite/runtime'");
    expect(db).toContain("from '@internal/sqlite/static'");
    expect(db).toContain("path: process.env['DATABASE_URL']!");
  });

  it('sets DATABASE_URL to the path of a database file', () => {
    expect(contribution.envExample()).toContain('DATABASE_URL="./dev.db"');
    expect(contribution.envExample()).not.toContain('://');
  });

  it.each(MODES)('fills every placeholder of the %s quick reference', (mode) => {
    const text = contribution.quickReference({
      mode,
      schemaPath: 'src/prisma/contract.prisma',
      cliCommand: 'pnpm prisma',
      requirements: '',
    });

    expect(text).not.toMatch(/\{\{\w+\}\}/);
    expect(text).toContain('This project is set up for SQLite.');
    expect(text).toContain('DATABASE_URL="./dev.db"');
    expect(text).toContain("import { db } from './src/prisma/db';");
    expect(text).toContain('db.orm.User');
    expect(text).toContain(contribution.contractSample(mode));
  });
  it.each([
    ['psl', 'number'],
    ['typescript', 'string'],
  ] as const)(
    'names the id type the %s starter contract gives in the quick reference',
    (mode, idType) => {
      const text = contribution.quickReference({
        mode,
        schemaPath: 'src/prisma/contract.prisma',
        cliCommand: 'pnpm prisma',
        requirements: '',
      });

      expect(text).toContain(`// { id: ${idType}; email: string;`);
    },
  );
});
