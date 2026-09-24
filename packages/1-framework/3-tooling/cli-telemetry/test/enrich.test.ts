import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTelemetryEvent,
  buildTelemetryEventFromProcess,
  type EnrichEnvironment,
  loadProjectConfig,
  type ProjectConfigFields,
  parsePackageManager,
  readTsVersionFromPackageJson,
} from '../src/enrich';
import type { ParentToSenderPayload } from '../src/payload';

const basePayload: ParentToSenderPayload = {
  installationId: 'install-1',
  version: '0.9.0',
  command: 'migration new',
  flags: ['name', 'dry-run'],
  projectRoot: '/project',
  endpoint: 'http://localhost/events',
};

const baseProjectConfig: ProjectConfigFields = {
  databaseTarget: 'postgres',
  extensions: ['pgvector'],
};

const EMPTY_PROJECT_CONFIG: ProjectConfigFields = {
  databaseTarget: null,
  extensions: [],
};

const baseEnv: EnrichEnvironment = {
  platform: 'darwin',
  arch: 'arm64',
  versions: { node: '24.13.0' },
  env: {},
  agent: null,
  readProjectPackageJson: () => null,
};

describe('parsePackageManager', () => {
  it('extracts the leading <pm>/<version> token from npm_config_user_agent', () => {
    expect(parsePackageManager('pnpm/10.27.0 npm/? node/v24.13.0 darwin arm64')).toBe(
      'pnpm/10.27.0',
    );
  });

  it('handles npm, yarn, and bun ua strings', () => {
    expect(parsePackageManager('npm/10.5.0 node/v24.13.0 darwin arm64')).toBe('npm/10.5.0');
    expect(parsePackageManager('yarn/4.6.0 npm/? node/v24.13.0 darwin arm64')).toBe('yarn/4.6.0');
    expect(parsePackageManager('bun/1.3.0 node/v24.13.0 darwin arm64')).toBe('bun/1.3.0');
  });

  it('returns null for undefined, empty, or malformed values', () => {
    expect(parsePackageManager(undefined)).toBeNull();
    expect(parsePackageManager('')).toBeNull();
    expect(parsePackageManager('nopepenope')).toBeNull();
  });
});

describe('readTsVersionFromPackageJson', () => {
  it('reads typescript from devDependencies and strips a leading ^', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ devDependencies: { typescript: '^5.9.3' } })),
    ).toBe('5.9.3');
  });

  it('falls back to dependencies when devDependencies is absent', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ dependencies: { typescript: '5.9.3' } })),
    ).toBe('5.9.3');
  });

  it('strips a leading ~ in addition to ^', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ devDependencies: { typescript: '~5.9.0' } })),
    ).toBe('5.9.0');
  });

  it('prefers devDependencies over dependencies when both are present', () => {
    expect(
      readTsVersionFromPackageJson(
        JSON.stringify({
          devDependencies: { typescript: '5.9.0' },
          dependencies: { typescript: '5.0.0' },
        }),
      ),
    ).toBe('5.9.0');
  });

  it('returns null on null input (file missing)', () => {
    expect(readTsVersionFromPackageJson(null)).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(readTsVersionFromPackageJson('{not-json')).toBeNull();
  });

  it('returns null when typescript key is absent', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ dependencies: { foo: '1.0' } })),
    ).toBeNull();
  });

  it('returns null when typescript is not a string', () => {
    expect(
      readTsVersionFromPackageJson(JSON.stringify({ devDependencies: { typescript: 5 } })),
    ).toBeNull();
  });
});

describe('buildTelemetryEvent', () => {
  it('round-trips the parent payload and overlays child-side probes', () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      env: { npm_config_user_agent: 'pnpm/10.27.0 node/v24.13.0' },
      readProjectPackageJson: () => JSON.stringify({ devDependencies: { typescript: '^5.9.3' } }),
    });

    expect(event).toEqual({
      installationId: 'install-1',
      version: '0.9.0',
      command: 'migration new',
      flags: ['name', 'dry-run'],
      runtimeName: 'node',
      runtimeVersion: '24.13.0',
      os: 'darwin',
      arch: 'arm64',
      packageManager: 'pnpm/10.27.0',
      databaseTarget: 'postgres',
      tsVersion: '5.9.3',
      agent: null,
      extensions: ['pgvector'],
      exitCode: null,
    });
  });

  it('carries the parent-reported exit code onto the event', () => {
    const event = buildTelemetryEvent({ ...basePayload, exitCode: 4 }, baseProjectConfig, baseEnv);
    expect(event.exitCode).toBe(4);
  });

  it('reports exitCode null when the parent sent none', () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, baseEnv);
    expect(event.exitCode).toBeNull();
  });

  it('detects bun as the runtime when versions.bun is present', () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      versions: { node: '24.13.0', bun: '1.3.0' },
    });
    expect(event.runtimeName).toBe('bun');
    expect(event.runtimeVersion).toBe('1.3.0');
  });

  it('detects deno as the runtime when versions.deno is present', () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      versions: { node: '24.13.0', deno: '2.5.0' },
    });
    expect(event.runtimeName).toBe('deno');
    expect(event.runtimeVersion).toBe('2.5.0');
  });

  it('passes the pre-resolved agent label through to the event', () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      agent: 'claude',
    });
    expect(event.agent).toBe('claude');
  });

  it('passes null tsVersion when the project package.json read fails', () => {
    const event = buildTelemetryEvent(basePayload, baseProjectConfig, {
      ...baseEnv,
      readProjectPackageJson: () => null,
    });
    expect(event.tsVersion).toBeNull();
  });

  it('passes null packageManager when npm_config_user_agent is absent', () => {
    expect(buildTelemetryEvent(basePayload, baseProjectConfig, baseEnv).packageManager).toBeNull();
  });

  it('passes the project-config slice straight through (databaseTarget + extensions)', () => {
    const event = buildTelemetryEvent(
      basePayload,
      { databaseTarget: 'mongodb', extensions: ['pgvector', 'paradedb'] },
      baseEnv,
    );
    expect(event.databaseTarget).toBe('mongodb');
    expect(event.extensions).toEqual(['pgvector', 'paradedb']);
  });
});

/**
 * Build a `prisma.config.mjs` source string that satisfies
 * the `orm` config schema (`ormConfigSchema` in `@internal/config-loader`).
 * `target.targetId` is the only structurally-significant variable
 * the telemetry projection cares about; `extensions` defaults to
 * empty. Caller can override either via the parameters; pass a
 * pre-formed `extensions` literal to inject specific ids, or
 * `omitExtensions: true` to drop the field entirely (validator
 * accepts the absent-field branch separately from the empty-array
 * branch — useful for cases that mean to exercise the former).
 */
function validConfigSource(
  options: {
    readonly targetId?: string;
    readonly extensionsLiteral?: string;
    readonly omitExtensions?: boolean;
  } = {},
): string {
  const targetId = options.targetId ?? 'postgres';
  const descriptor = (kind: string) =>
    `{ kind: '${kind}', id: '${targetId}', familyId: 'sql', targetId: '${targetId}', version: '0.0.1', create: () => ({}) }`;
  const lines = [
    'const orm = {',
    `  family: { kind: 'family', id: 'sql', familyId: 'sql', version: '0.0.1', emission: {}, create: () => ({}) },`,
    `  target: ${descriptor('target')},`,
    `  adapter: ${descriptor('adapter')},`,
  ];
  if (options.omitExtensions !== true) {
    const extensionsLiteral = options.extensionsLiteral ?? '[]';
    lines.push(`  extensions: ${extensionsLiteral},`);
  }
  lines.push('};');
  lines.push('export default { $prismaConfig: 1, orm };\n');
  return lines.join('\n');
}

describe('loadProjectConfig', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'cli-telemetry-loadcfg-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('returns empty config when no prisma.config.* exists in projectRoot', async () => {
    expect(await loadProjectConfig(projectDir)).toEqual(EMPTY_PROJECT_CONFIG);
  });

  it('extracts target.targetId and extensions[].id from a validated .mjs config', async () => {
    writeFileSync(
      join(projectDir, 'prisma.config.mjs'),
      validConfigSource({
        extensionsLiteral:
          "[{ kind: 'extension', id: 'pgvector', familyId: 'sql', targetId: 'postgres', version: '0.0.1', create: () => ({}) }, { kind: 'extension', id: 'paradedb', familyId: 'sql', targetId: 'postgres', version: '0.0.1', create: () => ({}) }]",
      }),
    );
    expect(await loadProjectConfig(projectDir)).toEqual({
      databaseTarget: 'postgres',
      extensions: ['pgvector', 'paradedb'],
    });
  });

  it('returns empty config for a flat config without the $prismaConfig marker', async () => {
    const flatSource = `${validConfigSource().replace('export default { $prismaConfig: 1, orm };\n', '')}export default orm;\n`;
    writeFileSync(join(projectDir, 'prisma.config.mjs'), flatSource);
    expect(await loadProjectConfig(projectDir)).toEqual(EMPTY_PROJECT_CONFIG);
  });

  it('returns empty extensions when extensions is truly omitted from an otherwise valid config', async () => {
    // Exercises the validator's absent-field branch, which is
    // distinct from the empty-array branch. The projection collapses
    // both to `extensions: []` via `(config.extensions ?? []).map(…)`,
    // but the validator paths differ — worth covering directly.
    writeFileSync(
      join(projectDir, 'prisma.config.mjs'),
      validConfigSource({ omitExtensions: true }),
    );
    expect(await loadProjectConfig(projectDir)).toEqual({
      databaseTarget: 'postgres',
      extensions: [],
    });
  });

  it('returns empty config when the canonical validator rejects a missing target descriptor', async () => {
    writeFileSync(
      join(projectDir, 'prisma.config.mjs'),
      `export default { $prismaConfig: 1, orm: { family: { kind: 'family', id: 'sql', familyId: 'sql', version: '0.0.1', emission: {}, create: () => ({}) } } };\n`,
    );
    // Validator throws on missing `target` -> caught -> EMPTY_PROJECT_CONFIG.
    expect(await loadProjectConfig(projectDir)).toEqual(EMPTY_PROJECT_CONFIG);
  });

  it('returns empty config when an extensions entry fails validation', async () => {
    writeFileSync(
      join(projectDir, 'prisma.config.mjs'),
      validConfigSource({
        // Missing `create: function` field on the pack — validator rejects.
        extensionsLiteral:
          "[{ kind: 'extension', id: 'pgvector', familyId: 'sql', targetId: 'postgres', version: '0.0.1' }]",
      }),
    );
    expect(await loadProjectConfig(projectDir)).toEqual(EMPTY_PROJECT_CONFIG);
  });

  it('swallows errors from a config file that throws during load', async () => {
    writeFileSync(
      join(projectDir, 'prisma.config.mjs'),
      `throw new Error('boom — user config crashed');\n`,
    );
    expect(await loadProjectConfig(projectDir)).toEqual(EMPTY_PROJECT_CONFIG);
  });
});

describe('buildTelemetryEventFromProcess — parent databaseTarget override', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'cli-telemetry-override-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('overrides the c12-derived databaseTarget when payload.databaseTarget is a string', async () => {
    writeFileSync(
      join(projectDir, 'prisma.config.mjs'),
      validConfigSource({ targetId: 'postgres' }),
    );
    const event = await buildTelemetryEventFromProcess({
      installationId: 'install-1',
      version: '0.9.0',
      command: 'init',
      flags: [],
      projectRoot: projectDir,
      endpoint: 'http://localhost/events',
      databaseTarget: 'mongodb',
    });
    expect(event.databaseTarget).toBe('mongodb');
  });

  it('falls back to the c12-derived databaseTarget when payload.databaseTarget is omitted', async () => {
    writeFileSync(
      join(projectDir, 'prisma.config.mjs'),
      validConfigSource({ targetId: 'postgres' }),
    );
    const event = await buildTelemetryEventFromProcess({
      installationId: 'install-1',
      version: '0.9.0',
      command: 'migration new',
      flags: [],
      projectRoot: projectDir,
      endpoint: 'http://localhost/events',
    });
    expect(event.databaseTarget).toBe('postgres');
  });

  it('uses the override even when no prisma.config.* exists on disk (first-init shape)', async () => {
    const event = await buildTelemetryEventFromProcess({
      installationId: 'install-1',
      version: '0.9.0',
      command: 'init',
      flags: [],
      projectRoot: projectDir,
      endpoint: 'http://localhost/events',
      databaseTarget: 'postgres',
    });
    expect(event.databaseTarget).toBe('postgres');
    expect(event.extensions).toEqual([]);
  });
});
