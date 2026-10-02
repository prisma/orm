import type {
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  DataTypeAuthoringEntry,
} from '@internal/framework-components/authoring';
import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import type { AttributeSpecNamespace } from '../src/attribute-spec/spec-context';
import {
  type Binder,
  type BinderContext,
  createBinder,
  type DescribeUnresolvedType,
  type DescribeUnsupportedAttribute,
} from '../src/binder';
import type { PslSources, Range, SourceFile } from '../src/source-file';
import type { SymbolTable } from '../src/symbol-table';
import type { GreenElement, GreenNode } from '../src/syntax/green';

/**
 * The framework PSL built-in scalar names a typical target declares. `resolve`
 * requires the caller to supply its target's scalar set; tests that don't care
 * about a specific target pass this standard set.
 */
export const frameworkScalarTypes: ReadonlySet<string> = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);

export function ownEntry(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function escapeForDebug(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('"', '\\"');
}

/**
 * Lossless, indented pretty-print of a green tree. Nodes render their
 * `SyntaxKind`; tokens render `Kind "escaped text"`. Trivia tokens are
 * included, so the rendering pins the full tree shape.
 */
export function printTree(node: GreenNode): string {
  const lines: string[] = [];
  const walk = (element: GreenElement, depth: number): void => {
    const indent = '  '.repeat(depth);
    if (element.type === 'token') {
      lines.push(`${indent}${element.kind} "${escapeForDebug(element.text)}"`);
      return;
    }
    lines.push(`${indent}${element.kind}`);
    for (const child of element.children) {
      walk(child, depth + 1);
    }
  };
  walk(node, 0);
  return lines.join('\n');
}

/**
 * Render the whole source, underlining the diagnostic span with `~`. Every
 * line of `sourceFile.text` is emitted in order; beneath each line the span
 * covers (`range.start.line..range.end.line`), a `~`-underline marks the
 * span's columns on that line. A zero-length span underlines a single column.
 */
export function highlight(sourceFile: SourceFile, range: Range): string {
  const lines = sourceFile.text.split('\n');
  const rendered: string[] = [];
  for (let line = 0; line < lines.length; line++) {
    const lineText = lines[line] ?? '';
    rendered.push(lineText);
    if (line < range.start.line || line > range.end.line) {
      continue;
    }
    const from = line === range.start.line ? range.start.character : 0;
    const to = line === range.end.line ? range.end.character : lineText.length;
    rendered.push(`${' '.repeat(from)}${'~'.repeat(Math.max(1, to - from))}`);
  }
  // Lead with a newline so Vitest's inline-snapshot serializer puts the
  // opening quote on its own line, keeping the source line and `~` underline
  // at the same indentation (otherwise the quote shifts the first line right).
  // Trail with a newline too so the closing quote sits on its own line,
  // mirroring the opening quote (the underline line no longer ends in `~"`).
  return `\n${rendered.join('\n')}\n`;
}

export function binderContext(
  input: {
    readonly contributedTypes?: AuthoringTypeNamespace;
    readonly attributeSpecs?: AttributeSpecNamespace;
    readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
    readonly defaultFunctionRegistry?: ControlMutationDefaultRegistry;
    readonly dataTypeEntries?: Readonly<Record<string, DataTypeAuthoringEntry>>;
    readonly describeUnsupportedAttribute?: DescribeUnsupportedAttribute;
    readonly describeUnresolvedType?: DescribeUnresolvedType;
  } = {},
): BinderContext {
  const { describeUnsupportedAttribute, describeUnresolvedType } = input;
  return {
    authoringContributions: {
      field: {},
      type: input.contributedTypes ?? {},
      entityTypes: {},
      pslBlockDescriptors: input.pslBlockDescriptors ?? {},
      modelAttributes: {},
      attributeSpecs: input.attributeSpecs ?? { model: {}, field: {} },
      dataTypes: input.dataTypeEntries ?? {},
    },
    controlMutationDefaults: {
      defaultFunctionRegistry: input.defaultFunctionRegistry ?? new Map(),
    },
    pslDiagnostics: {
      ...(describeUnsupportedAttribute === undefined
        ? {}
        : { describeUnsupportedAttribute: () => describeUnsupportedAttribute }),
      ...(describeUnresolvedType === undefined
        ? {}
        : { describeUnresolvedType: () => describeUnresolvedType }),
    },
  };
}

export function supportBinder(input: {
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
}): Binder {
  return createBinder({
    sources: input.sources,
    symbolTable: input.symbolTable,
    context: binderContext(
      input.pslBlockDescriptors === undefined
        ? {}
        : { pslBlockDescriptors: input.pslBlockDescriptors },
    ),
  }).binder;
}
