import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectPackageManager,
  formatAddArgs,
  formatAddDevArgs,
  formatRunCommand,
  formatRunScriptCommand,
  hasProjectManifest,
} from '../../../src/commands/init/detect-package-manager';

describe('detectPackageManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pm-detect-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects pnpm from lockfile', async () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');

    expect(await detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('detects yarn from lockfile', async () => {
    writeFileSync(join(tmpDir, 'yarn.lock'), '');

    expect(await detectPackageManager(tmpDir)).toBe('yarn');
  });

  it('detects bun from bun.lockb', async () => {
    writeFileSync(join(tmpDir, 'bun.lockb'), '');

    expect(await detectPackageManager(tmpDir)).toBe('bun');
  });

  it('detects npm from package-lock.json', async () => {
    writeFileSync(join(tmpDir, 'package-lock.json'), '{}');

    expect(await detectPackageManager(tmpDir)).toBe('npm');
  });

  it('detects deno from deno.lock', async () => {
    writeFileSync(join(tmpDir, 'deno.lock'), '{}');

    expect(await detectPackageManager(tmpDir)).toBe('deno');
  });

  it('falls back to packageManager field in package.json', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }));

    expect(await detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('defaults to npm when nothing detected', async () => {
    const previous = process.env['npm_config_user_agent'];
    delete process.env['npm_config_user_agent'];
    try {
      expect(await detectPackageManager(tmpDir)).toBe('npm');
    } finally {
      if (previous !== undefined) process.env['npm_config_user_agent'] = previous;
    }
  });

  it('detects lockfile in ancestor directory', async () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');
    const child = join(tmpDir, 'packages', 'my-app');
    mkdirSync(child, { recursive: true });

    expect(await detectPackageManager(child)).toBe('pnpm');
  });

  it('falls back to npm_config_user_agent when no project is found (TML-2496)', async () => {
    const previous = process.env['npm_config_user_agent'];
    process.env['npm_config_user_agent'] = 'pnpm/9.7.0 npm/? node/v24.0.0 darwin arm64';
    try {
      expect(await detectPackageManager(tmpDir)).toBe('pnpm');
    } finally {
      if (previous === undefined) delete process.env['npm_config_user_agent'];
      else process.env['npm_config_user_agent'] = previous;
    }
  });

  it('prefers an ancestor lockfile over the user agent', async () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');
    const child = join(tmpDir, 'packages', 'my-app');
    mkdirSync(child, { recursive: true });

    const previous = process.env['npm_config_user_agent'];
    process.env['npm_config_user_agent'] = 'yarn/4.0.0 npm/? node/v24.0.0 darwin arm64';
    try {
      expect(await detectPackageManager(child)).toBe('pnpm');
    } finally {
      if (previous === undefined) delete process.env['npm_config_user_agent'];
      else process.env['npm_config_user_agent'] = previous;
    }
  });
});

describe('hasProjectManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pm-manifest-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true for package.json', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{}');

    expect(hasProjectManifest(tmpDir)).toBe(true);
  });

  it('returns true for deno.json', () => {
    writeFileSync(join(tmpDir, 'deno.json'), '{}');

    expect(hasProjectManifest(tmpDir)).toBe(true);
  });

  it('returns true for deno.jsonc', () => {
    writeFileSync(join(tmpDir, 'deno.jsonc'), '{}');

    expect(hasProjectManifest(tmpDir)).toBe(true);
  });

  it('returns false for empty directory', () => {
    expect(hasProjectManifest(tmpDir)).toBe(false);
  });
});

describe('formatRunCommand', () => {
  it('uses npx for npm', () => {
    expect(formatRunCommand('npm', 'prisma', 'contract emit')).toBe('npx prisma contract emit');
  });

  it('uses deno run npm: for deno', () => {
    expect(formatRunCommand('deno', 'prisma', 'contract emit')).toBe(
      'deno run npm:prisma contract emit',
    );
  });

  it('uses pm directly for pnpm/yarn/bun', () => {
    expect(formatRunCommand('pnpm', 'prisma', 'contract emit')).toBe('pnpm prisma contract emit');
    expect(formatRunCommand('bun', 'prisma', 'contract emit')).toBe('bun prisma contract emit');
  });
});

describe('formatAddArgs', () => {
  it('prefixes packages with npm: for deno', () => {
    expect(formatAddArgs('deno', ['@internal/postgres', 'dotenv'])).toEqual([
      'add',
      'npm:@internal/postgres',
      'npm:dotenv',
    ]);
  });

  it('passes packages directly for other managers', () => {
    expect(formatAddArgs('pnpm', ['@internal/postgres', 'dotenv'])).toEqual([
      'add',
      '@internal/postgres',
      'dotenv',
    ]);
  });
});

describe('formatAddDevArgs', () => {
  it('uses --dev for deno with npm: prefix', () => {
    expect(formatAddDevArgs('deno', ['prisma'])).toEqual(['add', '--dev', 'npm:prisma']);
  });

  it('uses -D for other managers', () => {
    expect(formatAddDevArgs('npm', ['prisma'])).toEqual(['add', '-D', 'prisma']);
  });
});

describe('formatRunScriptCommand', () => {
  it('formats npm run for npm', () => {
    expect(formatRunScriptCommand('npm', 'db:init')).toBe('npm run db:init');
  });

  it('formats pnpm run for pnpm', () => {
    expect(formatRunScriptCommand('pnpm', 'dev')).toBe('pnpm run dev');
  });

  it('formats yarn run for yarn', () => {
    expect(formatRunScriptCommand('yarn', 'dev')).toBe('yarn run dev');
  });

  it('formats bun run for bun', () => {
    expect(formatRunScriptCommand('bun', 'dev')).toBe('bun run dev');
  });

  it('formats deno task for deno', () => {
    expect(formatRunScriptCommand('deno', 'db:init')).toBe('deno task db:init');
  });
});
