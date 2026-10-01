import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import matter from 'gray-matter';

function expression(value) {
  return ['$', '{{ ', value, ' }}'].join('');
}

function workflow(name) {
  const text = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
  return matter(`---\n${text}\n---`).data;
}

function coverageStep(steps) {
  return steps.find((step) => step.name === 'Check upgrade-instruction coverage');
}

function runStep(step, env) {
  const dir = mkdtempSync(join(tmpdir(), 'upgrade-workflow-'));
  try {
    const pnpm = join(dir, 'pnpm');
    writeFileSync(pnpm, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit "$CHECK_EXIT"\n');
    chmodSync(pnpm, 0o755);
    return spawnSync('bash', ['-e', '-c', step.run], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CHECK_EXIT: '0', ...env },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('upgrade coverage in PR and merge-group CI', () => {
  it('checks the effective tree against the event-pinned target base', () => {
    const ci = workflow('ci');
    assert.ok(Object.hasOwn(ci.on, 'pull_request'));
    assert.ok(Object.hasOwn(ci.on, 'merge_group'));
    assert.equal(ci.jobs.lint.if, undefined);
    const checkout = ci.jobs.lint.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.with['fetch-depth'], 0);
    assert.equal(checkout.with.ref, undefined);
    const step = coverageStep(ci.jobs.lint.steps);
    assert.equal(
      step.env.BASE_SHA,
      expression('github.event.pull_request.base.sha || github.event.merge_group.base_sha'),
    );
    assert.equal(step.env.HEAD_SHA, expression('github.event.merge_group.head_sha || github.sha'));
    const result = runStep(step, { BASE_SHA: 'event-base', HEAD_SHA: 'event-merge' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      'check:upgrade-coverage',
      '--mode',
      'pr',
      '--prev',
      'event-base',
      '--head',
      'event-merge',
    ]);
  });
});

describe('upgrade coverage before publication', () => {
  const publish = workflow('publish');
  const steps = publish.jobs.publish.steps;
  const step = coverageStep(steps);

  for (const tag of ['latest', 'next', 'dev', 'beta']) {
    it(`uses ${tag === 'dev' || tag === 'beta' ? 'dev' : 'publish'} checking for ${tag}`, () => {
      const result = runStep(step, { DIST_TAG: tag, GITHUB_SHA: 'publish-commit' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split('\n'), [
        'check:upgrade-coverage',
        '--mode',
        tag === 'dev' || tag === 'beta' ? 'dev' : 'publish',
        '--head',
        'publish-commit',
      ]);
    });
  }

  it('takes classification from the version step and also checks dry runs', () => {
    assert.equal(step.env.DIST_TAG, expression('steps.version.outputs.tag'));
    assert.equal(step.if, undefined);
    const index = steps.indexOf(step);
    const firstPublish = steps.findIndex((entry) => /publish-packages\.mjs/.test(entry.run ?? ''));
    assert.ok(firstPublish > index);
  });

  it('rejects a missing classification without invoking the gate in a weaker mode', () => {
    const result = runStep(step, { DIST_TAG: '', GITHUB_SHA: 'publish-commit' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('propagates a failed completeness check', () => {
    const result = runStep(step, {
      DIST_TAG: 'latest',
      GITHUB_SHA: 'publish-commit',
      CHECK_EXIT: '1',
    });
    assert.equal(result.status, 1);
  });
});
