import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');

function patternsOf(audience: string, id: string): readonly RegExp[] {
  const guide = readFileSync(
    join(
      repoRoot,
      'upgrade-instructions/pending/remove-field-presets',
      audience,
      'instructions.md',
    ),
    'utf-8',
  );
  const block = guide.split(/\n {2}- id: /).find((entry) => entry.startsWith(`${id}\n`)) ?? '';
  return [...block.matchAll(/^ {8}- '(.*)'$/gm)].map(
    ([, pattern]) => new RegExp((pattern ?? '').replaceAll("''", "'")),
  );
}

const example = (path: string) => readFileSync(join(repoRoot, 'examples', path), 'utf-8');
const postgresContract = (body: string) =>
  `${example('bundle-size/src/postgres/contract.ts')}\n${body}\n`;
const mongoContract = (body: string) =>
  `${example('bundle-size/src/mongo/contract.ts')}\n${body}\n`;

describe.each([
  ['app', 'ts-field-presets-removed'],
  ['extension', 'field-presets-in-extension-code'],
])('the %s guide detection %s', (audience, id) => {
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
])('the %s guide detection %s on field.generated', (audience, id) => {
  const matches = (content: string) =>
    patternsOf(audience, id).some((pattern) => pattern.test(content));

  it('matches field.generated, and not the same call on a property named field', () => {
    expect([
      matches(postgresContract('const id = field.generated(spec);')),
      matches(postgresContract('const id = this.field.generated(spec);')),
    ]).toEqual([true, false]);
  });
});
