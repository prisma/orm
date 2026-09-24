import { readdirSync, readFileSync } from 'node:fs';
import { importedSpecifiers } from '@internal/publish-surface/import-roots';
import { join, relative } from 'pathe';
import { describe, expect, it } from 'vitest';

const srcDir = join(import.meta.dirname, '../src');

function sourceFiles(): string[] {
  return readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(srcDir, file));
}

function importsMatching(pattern: RegExp): string[] {
  return sourceFiles()
    .flatMap((file) =>
      importedSpecifiers(readFileSync(file, 'utf8'))
        .filter((specifier) => pattern.test(specifier))
        .map((specifier) => `${relative(srcDir, file)} -> ${specifier}`),
    )
    .sort();
}

describe('target package layering (ADR 198)', () => {
  it('scans the target sources', () => {
    expect(importsMatching(/^@internal\/family-mongo\//)).not.toEqual([]);
  });

  it('imports no adapter or driver package', () => {
    expect(importsMatching(/^@internal\/(adapter|driver)-mongo(\/|$)/)).toEqual([]);
  });
});
