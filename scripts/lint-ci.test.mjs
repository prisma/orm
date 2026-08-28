import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createLintTasks, runTasks } from './lint-ci.mjs';

describe('createLintTasks', () => {
  test('includes every post-build CI lint gate', () => {
    assert.deepEqual(
      createLintTasks('develop').map(({ name, args }) => [name, args]),
      [
        ['packages', ['lint:packages:ci']],
        ['deps', ['lint:deps']],
        ['script_tests', ['test:scripts']],
        ['ratchets', ['lint:ratchets']],
        ['legacy_name', ['lint:legacy-name']],
        ['examples', ['lint:examples:ci']],
        ['code', ['lint:code']],
        ['rules', ['lint:rules']],
        ['rule_symlinks', ['lint:rules:symlinks']],
        ['skills', ['lint:skills']],
        ['rule_footprint', ['lint:rules:footprint']],
        ['docs', ['lint:docs']],
        ['manifests', ['lint:manifests']],
        ['workflows', ['lint:workflows']],
        ['consumer_imports', ['lint:consumer-internal-imports']],
        ['publishability', ['lint:publishability']],
        [
          'upgrade_coverage',
          ['check:upgrade-coverage', '--mode', 'pr', '--prev', 'origin/develop'],
        ],
        ['error_reference', ['check:error-reference']],
        ['release_notes', ['check:release-notes', '--mode', 'pr', '--prev', 'origin/develop']],
      ],
    );
  });
});

describe('runTasks', () => {
  test('bounds concurrency and reports every failure', async () => {
    let active = 0;
    let peak = 0;
    const completed = [];
    const tasks = ['a', 'b', 'c', 'd'].map((name) => ({ name, args: [] }));

    const failures = await runTasks(tasks, 2, async ({ name }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      completed.push(name);
      return name === 'b' || name === 'd' ? 1 : 0;
    });

    assert.equal(peak, 2);
    assert.deepEqual(completed.sort(), ['a', 'b', 'c', 'd']);
    assert.deepEqual(failures.sort(), ['b', 'd']);
  });
});
