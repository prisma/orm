import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md',
} as const;

function patternsOf(audience: keyof typeof GUIDE_PATHS, id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

/** The published packages an application imports from, kept out of literal import text so the import-root lint reads this file as test data. */
const postgresBuilder = ['@prisma', 'orm-postgres/contract-builder'].join('/');
const mongoBuilder = ['@prisma', 'orm-mongo/contract-builder'].join('/');
const postgresContract = (body: string) =>
  `import { defineContract } from '${postgresBuilder}';\n${body}\n`;
const mongoContract = (body: string) =>
  `import { defineContract } from '${mongoBuilder}';\n${body}\n`;

describe.each([
  ['app', 'ts-field-presets-removed'],
  ['extension', 'field-presets-in-extension-code'],
] as const)('the %s guide detection %s', (audience, id) => {
  const matches = (content: string) =>
    patternsOf(audience, id).some((pattern) => pattern.test(content));

  it('matches an id or temporal preset, and not a property chain that ends in field', () => {
    expect([
      matches(postgresContract('const id = field.id.uuidv4String();')),
      matches(postgresContract('const at = field.temporal.createdAt();')),
      matches(postgresContract('const label = info.field.id.toString();')),
      matches(postgresContract('const at = form.field.temporal.value;')),
    ]).toEqual([true, true, false, false]);
  });

  it('matches a scalar preset, and not the same call on a property named field', () => {
    expect([
      matches(postgresContract('const title = field.text();')),
      matches(postgresContract('const title = form.field.text();')),
    ]).toEqual([true, false]);
  });
});

describe('the app guide detection ts-field-presets-removed on field.json', () => {
  const matches = (content: string) =>
    patternsOf('app', 'ts-field-presets-removed').some((pattern) => pattern.test(content));

  it('matches a Postgres contract, even when a comment names mongo', () => {
    expect([
      matches(postgresContract('const data = field.json();')),
      matches(postgresContract('// moved from mongo\nconst data = field.json();')),
    ]).toEqual([true, true]);
  });

  it('does not match a MongoDB contract, whether it imports the builder directly or through a local module', () => {
    expect([
      matches(mongoContract('const data = field.json();')),
      matches("import { field } from './builders';\nconst data = field.json();\n"),
    ]).toEqual([false, false]);
  });
});

describe.each([
  ['app', 'ts-field-generated-removed'],
  ['extension', 'field-presets-in-extension-code'],
] as const)('the %s guide detection %s on field.generated', (audience, id) => {
  const matches = (content: string) =>
    patternsOf(audience, id).some((pattern) => pattern.test(content));

  it('matches field.generated, and not the same call on a property named field', () => {
    expect([
      matches(postgresContract('const id = field.generated(spec);')),
      matches(postgresContract('const id = this.field.generated(spec);')),
    ]).toEqual([true, false]);
  });
});
