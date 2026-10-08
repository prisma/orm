import { describe, expect, it } from 'vitest';
import type { Range } from 'vscode-languageserver';
import { provideDefinition } from '../src/definition';
import { providePslHover } from '../src/hover';
import { provideReferences } from '../src/references';
import { provideRename } from '../src/rename';
import { cursorInput, type Files } from './helpers/reference-fixtures';

const files: Files = {
  'decl.prisma': ['label Sticker {', '}', ''].join('\n'),
  'ref.prisma': ['model Item {', '  id   Int @id', '  kind ref.label(Sticker)', '}', ''].join('\n'),
};

const qualified: Files = {
  'decl.prisma': ['namespace shop {', '  label Sticker {', '  }', '}', ''].join('\n'),
  'ref.prisma': ['model Item {', '  id   Int @id', '  kind ref.label(shop.Sticker)', '}', ''].join(
    '\n',
  ),
};

function marked(source: Files, uri: string, range: Range, replacement?: string): string {
  const line = (source[uri] ?? '').split('\n')[range.start.line] ?? '';
  const inside = line.slice(range.start.character, range.end.character);
  if (replacement?.includes('\n')) return `${uri}: ${JSON.stringify(replacement)} before "${line}"`;
  const shown = replacement === undefined ? `<${inside}>` : replacement;
  return `${uri}: ${`${line.slice(0, range.start.character)}${shown}${line.slice(range.end.character)}`.trim()}`;
}

function referencesAt(source: Files, uri: string, at: string, includeDeclaration: boolean) {
  return provideReferences({ ...cursorInput(source, uri, at), includeDeclaration }).map(
    (location) => marked(source, location.uri, location.range),
  );
}

function renameAt(source: Files, uri: string, at: string, newName: string) {
  const edit = provideRename({ ...cursorInput(source, uri, at), newName });
  return Object.entries(edit?.changes ?? {}).flatMap(([file, edits]) =>
    edits.map(({ range, newText }) => marked(source, file, range, newText)),
  );
}

const stickerToBadge = [
  'decl.prisma: label Badge {',
  'decl.prisma: "\\n  @@map(\\"Sticker\\")\\n" before "}"',
  'ref.prisma: kind ref.label(Badge)',
];

describe('entity argument of a type constructor', () => {
  it('goes to the definition of the block the argument names', () => {
    const input = cursorInput(files, 'ref.prisma', 'ref.label(Stic|ker)');

    expect(provideDefinition({ ...input, linkSupport: false })).toEqual([
      {
        uri: 'decl.prisma',
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
      },
    ]);
  });

  it('shows the declaration line of the block on hover', () => {
    const input = cursorInput(files, 'ref.prisma', 'ref.label(Stic|ker)');

    expect(providePslHover(input)).toEqual({
      contents: { kind: 'markdown', value: '```prisma\nlabel Sticker\n```' },
      range: { start: { line: 2, character: 17 }, end: { line: 2, character: 24 } },
    });
  });

  it('is listed as a usage of the block', () => {
    expect(referencesAt(files, 'decl.prisma', 'label Stic|ker', false)).toEqual([
      'ref.prisma: kind ref.label(<Sticker>)',
    ]);
  });

  it('lists the declaration of the block when asked from the argument', () => {
    expect(referencesAt(files, 'ref.prisma', 'ref.label(Stic|ker)', true)).toEqual([
      'decl.prisma: label <Sticker> {',
      'ref.prisma: kind ref.label(<Sticker>)',
    ]);
  });

  it('is renamed with the block from the declaration, with one @@map', () => {
    expect(renameAt(files, 'decl.prisma', 'label Stic|ker', 'Badge')).toEqual(stickerToBadge);
  });

  it('renames the block from the argument with the same edit', () => {
    expect(renameAt(files, 'ref.prisma', 'ref.label(Stic|ker)', 'Badge')).toEqual(stickerToBadge);
  });

  it('renames only the last segment of a qualified argument for the block', () => {
    expect(renameAt(qualified, 'ref.prisma', 'shop.Stic|ker', 'Badge')).toEqual([
      'decl.prisma: label Badge {',
      'decl.prisma: "\\n    @@map(\\"Sticker\\")\\n" before "  }"',
      'ref.prisma: kind ref.label(shop.Badge)',
    ]);
  });

  it('renames only the qualifier of a qualified argument for the namespace', () => {
    expect(renameAt(qualified, 'ref.prisma', 'sh|op.Sticker', 'store')).toEqual([
      'decl.prisma: namespace store {',
      'ref.prisma: kind ref.label(store.Sticker)',
    ]);
  });
});
