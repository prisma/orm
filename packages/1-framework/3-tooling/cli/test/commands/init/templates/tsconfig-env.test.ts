import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  envExampleContent,
  envFileContent,
  MIN_SERVER_VERSION,
} from '../../../../src/commands/init/templates/env';
import {
  defaultTsConfig,
  mergeTsConfig,
  parseTsConfigText,
  REQUIRED_COMPILER_OPTIONS,
  REQUIRED_COMPILER_OPTIONS_TYPES,
  TsConfigParseError,
} from '../../../../src/commands/init/templates/tsconfig';

// ---------------------------------------------------------------------------
// tsconfig.json compiler options emitted for a fresh project
// ---------------------------------------------------------------------------

describe('defaultTsConfig', () => {
  it('emits all required compiler options', () => {
    const parsed = JSON.parse(defaultTsConfig()) as {
      compilerOptions: Record<string, unknown>;
    };
    for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
      expect(parsed.compilerOptions[key]).toBe(value);
    }
  });

  it('includes the required types array (notably "node") so process.env resolves under bundler resolution', () => {
    const parsed = JSON.parse(defaultTsConfig()) as {
      compilerOptions: { types?: unknown };
    };
    expect(parsed.compilerOptions.types).toEqual([...REQUIRED_COMPILER_OPTIONS_TYPES]);
    expect(parsed.compilerOptions.types).toContain('node');
  });
});

describe('mergeTsConfig', () => {
  it('adds the required compiler options to a minimal user config', () => {
    const existing = JSON.stringify({ compilerOptions: { strict: true } });
    const merged = JSON.parse(mergeTsConfig(existing)) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(merged.compilerOptions['strict']).toBe(true);
    for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
      expect(merged.compilerOptions[key]).toBe(value);
    }
    expect(merged.compilerOptions['types']).toEqual(['node']);
  });

  it('merges into an existing types array without duplicating "node"', () => {
    const existing = JSON.stringify({
      compilerOptions: { types: ['vite/client', 'node'] },
    });
    const merged = JSON.parse(mergeTsConfig(existing)) as {
      compilerOptions: { types: string[] };
    };
    expect(merged.compilerOptions.types).toEqual(['vite/client', 'node']);
  });

  it('preserves user-added types when merging in the required ones', () => {
    const existing = JSON.stringify({
      compilerOptions: { types: ['vitest/globals'] },
    });
    const merged = JSON.parse(mergeTsConfig(existing)) as {
      compilerOptions: { types: string[] };
    };
    expect(merged.compilerOptions.types).toContain('vitest/globals');
    expect(merged.compilerOptions.types).toContain('node');
  });

  it('replaces a non-array types value with the required minimum', () => {
    // `types` must be an array per the TS config schema; anything else
    // is invalid and the safest fix is to overwrite with what we need.
    const existing = JSON.stringify({ compilerOptions: { types: 'node' } });
    const merged = JSON.parse(mergeTsConfig(existing)) as {
      compilerOptions: { types: string[] };
    };
    expect(merged.compilerOptions.types).toEqual(['node']);
  });

  it('is idempotent on a previously-merged config', () => {
    const first = mergeTsConfig(JSON.stringify({ compilerOptions: { strict: true } }));
    const second = mergeTsConfig(first);
    expect(JSON.parse(second)).toEqual(JSON.parse(first));
  });
});

describe('mergeTsConfig JSONC support', () => {
  it('parses comments and trailing commas', () => {
    const jsonc = [
      '{',
      '  // top comment',
      '  "compilerOptions": {',
      '    "strict": true, // trailing comma + comment below',
      '  },',
      '}',
    ].join('\n');
    const merged = mergeTsConfig(jsonc);
    // Merged file is itself valid JSONC and re-parses cleanly.
    const reparsed = parseTsConfigText(merged).config as {
      compilerOptions: Record<string, unknown>;
    };
    expect(reparsed.compilerOptions['strict']).toBe(true);
    expect(reparsed.compilerOptions['moduleResolution']).toBe('bundler');
    expect(reparsed.compilerOptions['types']).toEqual(['node']);
  });

  it('preserves user comments through the merge where possible', () => {
    const jsonc = [
      '{',
      '  // important: do not delete this comment',
      '  "compilerOptions": {',
      '    "strict": true',
      '  }',
      '}',
    ].join('\n');
    const merged = mergeTsConfig(jsonc);
    expect(merged).toContain('// important: do not delete this comment');
  });

  it('throws TsConfigParseError on bare unparseable input', () => {
    expect(() => mergeTsConfig('{ "compilerOptions": ')).toThrow(TsConfigParseError);
  });

  it('throws TsConfigParseError when the input does not parse to an object', () => {
    expect(() => mergeTsConfig('"a string at the root"')).toThrow(TsConfigParseError);
    expect(() => mergeTsConfig('[1, 2, 3]')).toThrow(TsConfigParseError);
  });
});

describe('parseTsConfigText', () => {
  it('returns the parsed object for a valid JSONC tsconfig', () => {
    const { config } = parseTsConfigText('{ "compilerOptions": { "strict": true /* ok */ } }');
    expect(config).toEqual({ compilerOptions: { strict: true } });
  });

  it('throws TsConfigParseError on malformed input', () => {
    expect(() => parseTsConfigText('{ broken')).toThrow(TsConfigParseError);
  });
});

// ---------------------------------------------------------------------------
// .env.example template per target
// ---------------------------------------------------------------------------

describe('envExampleContent', () => {
  it('writes a postgresql:// placeholder for the postgres target', () => {
    const md = envExampleContent('postgres');
    expect(md).toContain('DATABASE_URL=');
    expect(md).toContain('postgresql://');
  });

  it('writes a mongodb:// placeholder with credentials and a database segment for the mongo target', () => {
    const md = envExampleContent('mongo');
    expect(md).toContain('mongodb://');
    expect(md).toContain('DATABASE_URL="mongodb://user:password@localhost:27017/mydb"');
  });

  it('documents replica-set requirements without baking query params into the default URL', () => {
    const md = envExampleContent('mongo');
    expect(md).toMatch(/replica set/i);
    expect(md).toMatch(/standalone local mongod/i);
  });

  it('documents the minimum supported server version', () => {
    expect(envExampleContent('postgres')).toMatch(/Requires PostgreSQL >= \d/);
    expect(envExampleContent('mongo')).toMatch(/Requires MongoDB >= \d/);
  });

  it('explains the copy-to-.env workflow (so first-run users know what to do)', () => {
    expect(envExampleContent('postgres')).toMatch(/Copy this file to `\.env`/i);
  });
});

describe('envFileContent', () => {
  it('omits the example-only "Copy this file to `.env`…" intro', () => {
    // The real `.env` is the destination of that copy, so the line
    // would lie if it ended up in the scaffolded `.env` itself.
    for (const target of ['postgres', 'mongo'] as const) {
      expect(envFileContent(target)).not.toMatch(/Copy this file to/i);
    }
  });

  it('keeps the same placeholder body as the example so a single edit boots the project', () => {
    for (const target of ['postgres', 'mongo'] as const) {
      const example = envExampleContent(target);
      const real = envFileContent(target);
      expect(real).toContain('DATABASE_URL=');
      expect(real).toMatch(/Requires (PostgreSQL|MongoDB) >= /);
      // The example file's body trails the intro, so the real file
      // matches the suffix once the intro is removed.
      expect(example).toContain(real.trim());
    }
  });

  it('writes a target-specific connection-string placeholder', () => {
    expect(envFileContent('postgres')).toContain('postgresql://');
    expect(envFileContent('mongo')).toContain('mongodb://user:password@localhost:27017/mydb');
  });
});

// ---------------------------------------------------------------------------
// The CLI's MIN_SERVER_VERSION constant mirrors the target packages'
// package.json#prismaNext.minServerVersion fields. The constant is
// checked into source so we don't pay a workspace-fs read at every CLI
// startup, but drift between the two values would silently mislead every
// freshly-initialised user about which server versions Prisma 8
// actually supports. This test fails loudly when the two diverge,
// requiring the bump to be a coordinated change.
// ---------------------------------------------------------------------------

describe('MIN_SERVER_VERSION mirrors target packages', () => {
  // Resolved relative to this test file so the assertion does not
  // depend on the test runner's `cwd`.
  const REPO_ROOT = join(import.meta.dirname, '../../../../../../../..');
  const TARGET_PACKAGE_JSONS = {
    postgres: join(REPO_ROOT, 'packages/3-targets/3-targets/postgres/package.json'),
    mongo: join(REPO_ROOT, 'packages/3-mongo-target/1-mongo-target/package.json'),
  } as const;

  function readMinServerVersion(packageJsonPath: string): string {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      prismaNext?: { minServerVersion?: unknown };
    };
    const value = pkg.prismaNext?.minServerVersion;
    if (typeof value !== 'string') {
      throw new Error(
        `${packageJsonPath} is missing a string "prismaNext.minServerVersion" field. ` +
          'Every target package must declare its minimum server version.',
      );
    }
    return value;
  }

  for (const [target, packageJsonPath] of Object.entries(TARGET_PACKAGE_JSONS)) {
    it(`${target}: matches package.json#prismaNext.minServerVersion`, () => {
      const declared = readMinServerVersion(packageJsonPath);
      expect(MIN_SERVER_VERSION[target as keyof typeof MIN_SERVER_VERSION]).toBe(declared);
    });
  }
});
