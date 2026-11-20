import type { ContractSourceFormat } from '@internal/config/config-types';
import { describe, expect, it } from 'vitest';
import contribution from '../../src/exports/init';

const MODES: readonly ContractSourceFormat[] = ['psl', 'typescript'];

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? '',
  );
}

describe('the MySQL init contribution', () => {
  it('names the package, its config module and no drivers to install', () => {
    expect(contribution).toMatchObject({
      label: 'MySQL',
      configModule: '@internal/mysql/config',
      peerPackages: [],
      authoringModes: ['psl', 'typescript'],
    });
  });

  it('states no server requirement and has no probe, which the package has no facts in code for', () => {
    expect(contribution.serverRequirement).toBeUndefined();
    expect(contribution.probe).toBeUndefined();
    expect(contribution.prisma7QuickReference).toBeUndefined();
  });

  it.each(MODES)('imports only from the package in the %s starter contract', (mode) => {
    const specifiers = moduleSpecifiers(contribution.starterContract(mode));
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^@internal\/mysql\//);
    }
    expect(contribution.starterContract(mode)).toContain('User');
  });

  it('connects to the URL DATABASE_URL holds, as the config does', () => {
    const db = contribution.databaseFile();

    expect(db).toContain("import 'dotenv/config';");
    expect(db).toContain("from '@internal/mysql/runtime'");
    expect(db).toContain("from '@internal/mysql/static'");
    expect(db).toContain("url: process.env['DATABASE_URL']!");
  });

  it('sets DATABASE_URL to a mysql:// URL', () => {
    expect(contribution.envExample()).toContain(
      'DATABASE_URL="mysql://user:password@localhost:3306/mydb"',
    );
  });

  it.each(MODES)('fills every placeholder of the %s quick reference', (mode) => {
    const text = contribution.quickReference({
      mode,
      schemaPath: 'src/prisma/contract.prisma',
      cliCommand: 'pnpm prisma',
      requirements: '',
    });

    expect(text).not.toMatch(/\{\{\w+\}\}/);
    expect(text).toContain('This project is set up for MySQL.');
    expect(text).toContain('DATABASE_URL="mysql://user:password@localhost:3306/mydb"');
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
