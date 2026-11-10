import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
} as const;

function patternsOf(audience: keyof typeof GUIDE_PATHS, id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

const example = (path: string) => readFileSync(join(repoRoot, 'examples', path), 'utf-8');

/** The file as a release before checks carried what they expect wrote it. */
function writtenBefore(content: string): string {
  return content
    .replace(/,\s*"expectation": \{\s*"expects": "\w+",\s*"object": "(?:[^"\\]|\\.)*"\s*\}/g, '')
    .replace(/,\s*"object": "(?:[^"\\]|\\.)*"/g, '');
}

const sqlOps = example(
  'prisma-8-demo/migrations/app/20260810T1108_add_post_engagement_counters/ops.json',
);
const mongoOps = example('mongo-demo/migrations/app/20260409T1030_migration/ops.json');
const dataOnlyOps = example(
  'retail-store/migrations/app/20260513T0508_backfill_product_status/ops.json',
);
const rawSqlMigration = example('prisma-8-demo/migrations/app/20260422T0720_initial/migration.ts');

describe.each(['app', 'extension'] as const)('the %s check-expectation detection', (audience) => {
  const matches = (id: string, content: string) =>
    patternsOf(audience, id).some((pattern) => pattern.test(content));

  it('matches an ops.json written before, with a check that gains an expectation', () => {
    expect([
      matches('check-expectation', writtenBefore(sqlOps)),
      matches('check-expectation', writtenBefore(mongoOps)),
    ]).toEqual([true, true]);
  });

  it('stops matching an ops.json once it is written again, and never matches one of data checks only', () => {
    expect([
      matches('check-expectation', sqlOps),
      matches('check-expectation', mongoOps),
      matches('check-expectation', dataOnlyOps),
    ]).toEqual([false, false, false]);
  });

  it('matches a rawSql check written by hand until it carries an expectation', () => {
    expect([
      matches(
        'check-expectation-raw-sql',
        rawSqlMigration.replace(/\n\s*expectation: \{[^}]*\},/g, ''),
      ),
      matches('check-expectation-raw-sql', rawSqlMigration),
    ]).toEqual([true, false]);
  });

  it('matches an ops.json where one check carries an expectation and another, after or before it, does not', () => {
    const [first, second] = JSON.parse(sqlOps) as { precheck: Record<string, unknown>[] }[];
    const stripped = (op: { precheck: Record<string, unknown>[] } | undefined) =>
      op === undefined
        ? []
        : [
            {
              ...op,
              precheck: op.precheck.map(({ expectation: _, ...check }) => check),
            },
          ];
    const mixed = (ops: unknown[]) => JSON.stringify(ops, null, 2);
    expect([
      matches('check-expectation', mixed([first, ...stripped(second)])),
      matches('check-expectation', mixed([...stripped(first), second])),
      matches('check-expectation', mixed([first, second])),
    ]).toEqual([true, true, false]);
  });

  it('matches a migration.ts where one rawSql check carries an expectation and another does not', () => {
    const check = (description: string, expectation: string) => `{
            description: '${description}',
            sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",${expectation}
          }`;
    const withIt =
      "\n            expectation: { expects: 'absent', object: 'extension \"vector\"' },";
    const rawSql = (...checks: string[]) => `
      rawSql({
        id: 'extension.vector',
        precheck: [
          ${checks.join(',\n          ')},
        ],
        execute: [],
        postcheck: [],
      }),`;
    expect([
      matches('check-expectation-raw-sql', rawSql(check('first', withIt), check('second', ''))),
      matches(
        'check-expectation-raw-sql',
        rawSql(check('first', withIt)) + rawSql(check('second', '')),
      ),
      matches('check-expectation-raw-sql', rawSql(check('first', withIt), check('second', withIt))),
    ]).toEqual([true, true, false]);
  });
});
