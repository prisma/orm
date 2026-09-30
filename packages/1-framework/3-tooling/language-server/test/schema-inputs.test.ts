import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalFileIdentity,
  isWatcherCacheEligible,
  normalizeFileUri,
  resolveSchemaInputs,
  type SchemaInputConfig,
  toWatcherGlobPattern,
} from '../src/schema-inputs';

afterEach(() => vi.restoreAllMocks());

function useWindowsPlatform(): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
}

function configWith(
  inputs: readonly string[] | undefined,
  format: string | null = 'psl',
): SchemaInputConfig {
  return {
    contract: {
      source: {
        ...(format ? { format } : {}),
        ...(inputs ? { inputs } : {}),
      },
    },
  };
}

const directive = '// use prisma-8\n';
const alwaysMember = (): string => directive;

describe('normalized file URIs', () => {
  it.each([
    ['linux', 'file:///abs/%73chema.psl', 'file:///abs/schema.psl'],
    ['linux', 'file:///abs/Schema.psl', 'file:///abs/Schema.psl'],
    ['win32', 'file:///D%3A/Project/%73chema.psl', 'file:///d:/project/schema.psl'],
    ['win32', 'file://SERVER/Share/%73chema.psl', 'file://server/share/schema.psl'],
    ['linux', 'untitled:Schema.psl', 'untitled:Schema.psl'],
    ['linux', 'not a URI', 'not a URI'],
    ['linux', 'file:///abs/%2Fschema.psl', 'file:///abs/%2Fschema.psl'],
    ['linux', 'file://server/share/schema.psl', 'file://server/share/schema.psl'],
  ] as const)('normalizes %s URI %s', (platform, uri, expected) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    expect(normalizeFileUri(uri)).toBe(expected);
    expect(normalizeFileUri(expected)).toBe(expected);
    expect(canonicalFileIdentity(expected)).toBe(canonicalFileIdentity(uri));
  });
});

describe('watcher glob patterns', () => {
  it.each([
    ['win32', 'C:\\project\\*.prisma', 'C:/project/*.prisma'],
    ['win32', '\\\\server\\share\\*.prisma', '//server/share/*.prisma'],
    ['win32', 'C:/project/*.prisma', 'C:/project/*.prisma'],
    ['linux', '/project/\\[draft\\].prisma', '/project/\\[draft\\].prisma'],
    ['linux', '/project/\\\\name.prisma', '/project/\\\\name.prisma'],
    ['linux', '/project/*.prisma', '/project/*.prisma'],
    ['darwin', '/project/\\[draft\\].prisma', '/project/\\[draft\\].prisma'],
  ] as const)('normalizes %s pattern %s', (platform, pattern, expected) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    expect(toWatcherGlobPattern(pattern)).toBe(expected);
  });
});

describe('watcher cache eligibility', () => {
  it.each([
    '/project/schema.prisma',
    '/project/*.prisma',
    '/project/**/*.prisma',
    '/project/model?.prisma',
  ])('accepts interoperable pattern %s', (pattern) =>
    expect(isWatcherCacheEligible(configWith([pattern]))).toBe(true),
  );

  it.each([
    '/project/@(user|post).prisma',
    '/project/!(user).prisma',
    '!/project/user.prisma',
    '/project/{user,post}.prisma',
    '/project/model{1..3}.prisma',
    '/project/[up]*.prisma',
    '/project/\\*.prisma',
    'file:///project/schema.prisma',
    '/project/**model.prisma',
    '/project/***/schema.prisma',
  ])('rejects uncertain pattern %s even alongside a literal input', (pattern) => {
    expect(isWatcherCacheEligible(configWith(['/project/schema.prisma', pattern]))).toBe(false);
  });

  it('requires nonempty PSL inputs', () => {
    expect(isWatcherCacheEligible(configWith([]))).toBe(false);
    expect(isWatcherCacheEligible(configWith(undefined))).toBe(false);
    expect(isWatcherCacheEligible(configWith(['/project/schema.prisma'], 'ts'))).toBe(false);
  });
});

describe('resolveSchemaInputs', () => {
  it('includes only the listed inputs by their file URI', async () => {
    const set = await resolveSchemaInputs(
      configWith(['/abs/schema.psl', '/abs/more.psl']),
      alwaysMember,
    );
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(true);
    expect(set.includes(pathToFileURL('/abs/more.psl').toString())).toBe(true);
    expect(set.includes(pathToFileURL('/abs/other.psl').toString())).toBe(false);
  });

  it('treats every configured input as a schema, not just the first', async () => {
    const set = await resolveSchemaInputs(
      configWith(['/abs/a.psl', '/abs/b.psl', '/abs/c.psl']),
      alwaysMember,
    );
    expect(set.includes(pathToFileURL('/abs/c.psl').toString())).toBe(true);
  });

  it.each([
    'file:///D:/project/next.prisma',
    'file:///d:/project/next.prisma',
    'file:///D%3A/project/next.prisma',
    'file:///d%3A/project/next.prisma',
  ])('matches equivalent Windows file URI %s', async (uri) => {
    useWindowsPlatform();
    const set = await resolveSchemaInputs(configWith(['D:\\project\\next.prisma']), alwaysMember);
    expect(set.includes(uri)).toBe(true);
  });

  it.each(['D:/project/next.prisma', 'D:\\project\\next.prisma'])(
    'matches Windows configured path separators in %s',
    async (input) => {
      useWindowsPlatform();
      const set = await resolveSchemaInputs(configWith([input]), alwaysMember);
      expect(set.includes('file:///d%3A/project/next.prisma')).toBe(true);
    },
  );

  it('matches percent-encoded and differently-cased Windows paths', async () => {
    useWindowsPlatform();
    const set = await resolveSchemaInputs(
      configWith(['D:\\Project Files\\Schema #1.prisma']),
      alwaysMember,
    );
    expect(set.includes('file:///d%3A/project%20files/schema%20%231.PRISMA')).toBe(true);
    expect([...set.uris()]).toEqual(['file:///d:/project%20files/schema%20%231.prisma']);
  });

  it('matches Windows UNC inputs', async () => {
    useWindowsPlatform();
    const set = await resolveSchemaInputs(
      configWith(['\\\\server\\share\\schema.prisma']),
      alwaysMember,
    );
    expect([...set.uris()]).toEqual(['file://server/share/schema.prisma']);
    expect(set.includes('file://SERVER/share/SCHEMA.prisma')).toBe(true);
  });

  it.runIf(process.platform !== 'win32')(
    'uses POSIX semantics for Windows-shaped file URIs on non-Windows hosts',
    async () => {
      const set = await resolveSchemaInputs(configWith(['/D:/Project/Next.prisma']), alwaysMember);
      expect(set.includes('file:///d:/project/next.prisma')).toBe(false);
    },
  );

  it('matches percent-encoded POSIX paths', async () => {
    const set = await resolveSchemaInputs(
      configWith(['/abs/project files/schema #1%.prisma']),
      alwaysMember,
    );
    expect(set.includes('file:///abs/project%20files/schema%20%231%25.prisma')).toBe(true);
  });

  it('preserves configured file URIs', async () => {
    const uri = 'file:///abs/project%20files/schema.prisma';
    const set = await resolveSchemaInputs(configWith([uri]), alwaysMember);
    expect([...set.uris()]).toEqual([uri]);
    expect(set.includes('file:///abs/project%20files/./schema.prisma')).toBe(true);
  });

  it('does not treat non-file URIs as configured inputs', async () => {
    const set = await resolveSchemaInputs(configWith(['/abs/schema.psl']), alwaysMember);
    expect(set.includes('untitled:next.prisma')).toBe(false);
  });

  it('excludes everything when inputs is absent', async () => {
    const set = await resolveSchemaInputs(configWith(undefined), alwaysMember);
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('excludes everything when source format is typescript', async () => {
    const set = await resolveSchemaInputs(
      configWith(['/abs/schema.psl'], 'typescript'),
      alwaysMember,
    );
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('excludes everything when source format is absent', async () => {
    const set = await resolveSchemaInputs(configWith(['/abs/schema.psl'], null), alwaysMember);
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('excludes everything when inputs is empty', async () => {
    const set = await resolveSchemaInputs(configWith([]), alwaysMember);
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('is empty when there is no contract config', async () => {
    const set = await resolveSchemaInputs({}, alwaysMember);
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('lists the configured input URIs in sorted order', async () => {
    const set = await resolveSchemaInputs(configWith(['/abs/a.psl', '/abs/b.psl']), alwaysMember);
    expect([...set.uris()]).toEqual([
      pathToFileURL('/abs/a.psl').toString(),
      pathToFileURL('/abs/b.psl').toString(),
    ]);
  });

  it('lists no URIs when there are no configured inputs', async () => {
    expect([...(await resolveSchemaInputs({}, alwaysMember)).uris()]).toEqual([]);
  });

  describe('directive gate', () => {
    it('excludes a glob-matched member whose current text carries no directive', async () => {
      const uri = pathToFileURL('/abs/schema.psl').toString();
      const set = await resolveSchemaInputs(
        configWith(['/abs/schema.psl']),
        () => 'model Stray {}',
      );
      expect(set.includes(uri)).toBe(false);
      expect([...set.uris()]).toEqual([]);
    });

    it('excludes a member with no readable text', async () => {
      const uri = pathToFileURL('/abs/schema.psl').toString();
      const set = await resolveSchemaInputs(configWith(['/abs/schema.psl']), () => undefined);
      expect(set.includes(uri)).toBe(false);
    });

    it('re-checks the directive live on every call, not once at resolution time', async () => {
      const uri = pathToFileURL('/abs/schema.psl').toString();
      let text = 'model Stray {}';
      const set = await resolveSchemaInputs(configWith(['/abs/schema.psl']), () => text);
      expect(set.includes(uri)).toBe(false);
      text = directive;
      expect(set.includes(uri)).toBe(true);
      expect([...set.uris()]).toEqual([uri]);
    });
  });

  describe('glob expansion', { timeout: timeouts.databaseOperation }, () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
      for (const dir of tempDirs) {
        await rm(dir, { recursive: true, force: true });
      }
      tempDirs.length = 0;
    });

    async function fixtureDir(): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'schema-inputs-'));
      tempDirs.push(dir);
      return dir;
    }

    it('picks up a file created after the project exists on the next resolution pass, without a config change', async () => {
      const dir = await fixtureDir();
      const firstPath = join(dir, 'first.prisma');
      await writeFile(firstPath, directive, 'utf8');
      const pattern = join(dir, '*.prisma');

      const before = await resolveSchemaInputs(configWith([pattern]), alwaysMember);
      expect([...before.uris()]).toEqual([pathToFileURL(firstPath).toString()]);

      const secondPath = join(dir, 'second.prisma');
      await writeFile(secondPath, directive, 'utf8');

      const after = await resolveSchemaInputs(configWith([pattern]), alwaysMember);
      expect([...after.uris()].sort()).toEqual(
        [pathToFileURL(firstPath).toString(), pathToFileURL(secondPath).toString()].sort(),
      );
      expect([...before.uris()]).toEqual([pathToFileURL(firstPath).toString()]);
    });
  });
});
