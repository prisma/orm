import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSchemaInputs, type SchemaInputConfig } from '../src/schema-inputs';

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

describe('resolveSchemaInputs', () => {
  it('includes only the listed inputs by their file URI', () => {
    const set = resolveSchemaInputs(configWith(['/abs/schema.psl', '/abs/more.psl']));
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(true);
    expect(set.includes(pathToFileURL('/abs/more.psl').toString())).toBe(true);
    expect(set.includes(pathToFileURL('/abs/other.psl').toString())).toBe(false);
  });

  it('treats every configured input as a schema, not just the first', () => {
    const set = resolveSchemaInputs(configWith(['/abs/a.psl', '/abs/b.psl', '/abs/c.psl']));
    expect(set.includes(pathToFileURL('/abs/c.psl').toString())).toBe(true);
  });

  it.each([
    'file:///D:/project/next.prisma',
    'file:///d:/project/next.prisma',
    'file:///D%3A/project/next.prisma',
    'file:///d%3A/project/next.prisma',
  ])('matches equivalent Windows file URI %s', (uri) => {
    useWindowsPlatform();
    const set = resolveSchemaInputs(configWith(['D:\\project\\next.prisma']));
    expect(set.includes(uri)).toBe(true);
  });

  it.each(['D:/project/next.prisma', 'D:\\project\\next.prisma'])(
    'matches Windows configured path separators in %s',
    (input) => {
      useWindowsPlatform();
      const set = resolveSchemaInputs(configWith([input]));
      expect(set.includes('file:///d%3A/project/next.prisma')).toBe(true);
    },
  );

  it('matches percent-encoded and differently-cased Windows paths', () => {
    useWindowsPlatform();
    const set = resolveSchemaInputs(configWith(['D:\\Project Files\\Schema #1.prisma']));
    expect(set.includes('file:///d%3A/project%20files/schema%20%231.PRISMA')).toBe(true);
  });

  it('matches Windows UNC inputs', () => {
    useWindowsPlatform();
    const set = resolveSchemaInputs(configWith(['\\\\server\\share\\schema.prisma']));
    expect([...set.uris()]).toEqual(['file://server/share/schema.prisma']);
    expect(set.includes('file://SERVER/share/SCHEMA.prisma')).toBe(true);
  });

  it.runIf(process.platform !== 'win32')(
    'uses POSIX semantics for Windows-shaped file URIs on non-Windows hosts',
    () => {
      const set = resolveSchemaInputs(configWith(['/D:/Project/Next.prisma']));
      expect(set.includes('file:///d:/project/next.prisma')).toBe(false);
    },
  );

  it('matches percent-encoded POSIX paths', () => {
    const set = resolveSchemaInputs(configWith(['/abs/project files/schema #1%.prisma']));
    expect(set.includes('file:///abs/project%20files/schema%20%231%25.prisma')).toBe(true);
  });

  it('preserves configured file URIs', () => {
    const uri = 'file:///abs/project%20files/schema.prisma';
    const set = resolveSchemaInputs(configWith([uri]));
    expect([...set.uris()]).toEqual([uri]);
    expect(set.includes('file:///abs/project%20files/./schema.prisma')).toBe(true);
  });

  it('does not treat non-file URIs as configured inputs', () => {
    const set = resolveSchemaInputs(configWith(['/abs/schema.psl']));
    expect(set.includes('untitled:next.prisma')).toBe(false);
  });

  it('excludes everything when inputs is absent', () => {
    const set = resolveSchemaInputs(configWith(undefined));
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('excludes everything when source format is typescript', () => {
    const set = resolveSchemaInputs(configWith(['/abs/schema.psl'], 'typescript'));
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('excludes everything when source format is absent', () => {
    const set = resolveSchemaInputs(configWith(['/abs/schema.psl'], null));
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('excludes everything when inputs is empty', () => {
    const set = resolveSchemaInputs(configWith([]));
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('is empty when there is no contract config', () => {
    const set = resolveSchemaInputs({});
    expect(set.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(false);
  });

  it('lists the configured input URIs in config order', () => {
    const set = resolveSchemaInputs(configWith(['/abs/a.psl', '/abs/b.psl']));
    expect([...set.uris()]).toEqual([
      pathToFileURL('/abs/a.psl').toString(),
      pathToFileURL('/abs/b.psl').toString(),
    ]);
  });

  it('lists no URIs when there are no configured inputs', () => {
    expect([...resolveSchemaInputs({}).uris()]).toEqual([]);
  });
});
