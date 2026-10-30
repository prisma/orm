import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { BlockSymbol, PslSpan } from '@internal/psl-parser';
import { nodePslSpan } from '@internal/psl-parser';
import type {
  AttributeArgAst,
  ExpressionAst,
  PslSources,
  SyntaxNode,
} from '@internal/psl-parser/syntax';
import {
  ArrayLiteralAst,
  dottedPathsIn,
  FunctionCallAst,
  IdentifierAst,
  printSyntax,
  StringLiteralExprAst,
} from '@internal/psl-parser/syntax';
import { prisma7Diagnostic } from './diagnostics';
import type { Prisma7ExtensionPack } from './native-types';
import type { Prisma7DatabaseExtensions } from './target-binding';

export interface Prisma7SchemaBlock {
  readonly block: BlockSymbol;
  readonly sourceId: string;
  readonly sources: PslSources;
}

/** A listed extension no pack declares, which the application's contract declares itself. */
export interface DatasourceExtension {
  readonly name: string;
  readonly namespaceId: string;
  readonly span: PslSpan;
  readonly sourceId: string;
}

export interface DeclaringPack {
  readonly packId: string;
  readonly namespaceId: string;
}

export interface ReadDatasourceExtensionsInput {
  readonly datasource: Prisma7SchemaBlock;
  readonly generators: readonly Prisma7SchemaBlock[];
  readonly binding: Prisma7DatabaseExtensions;
  readonly composedExtensions: ReadonlySet<string>;
  /** The composed pack whose contract declares the extension, and the namespace it declares it in. */
  readonly declaringPack: (extensionName: string) => DeclaringPack | undefined;
  readonly defaultNamespaceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}

/** The config edit that composes `pack`. */
export function composePackAdvice(pack: Prisma7ExtensionPack): string {
  return `Add the pack to extensions in prisma.config.ts: import ${pack.importName} from '${pack.importPath}', then extensions: [${pack.importName}].`;
}

const PRISMA7_EXTENSION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function entryValue(source: Prisma7SchemaBlock, key: string) {
  return source.block.entries.find((entry) => entry.key()?.name() === key);
}

function stringOf(expression: ExpressionAst | undefined): string | undefined {
  return expression === undefined
    ? undefined
    : StringLiteralExprAst.cast(expression.syntax)?.value();
}

function previewFeatures(generators: readonly Prisma7SchemaBlock[]): ReadonlySet<string> {
  const features = new Set<string>();
  for (const generator of generators) {
    const value = entryValue(generator, 'previewFeatures')?.value();
    const list = value === undefined ? undefined : ArrayLiteralAst.cast(value.syntax);
    for (const element of list?.elements() ?? []) {
      const feature = stringOf(element);
      if (feature !== undefined) features.add(feature);
    }
  }
  return features;
}

function text(node: { readonly syntax: SyntaxNode }): string {
  return printSyntax(node.syntax).trim();
}

/**
 * The datasource `extensions` list: each listed extension no composed pack's contract declares, in the namespace of its `schema:` argument or the default one. An extension a composed pack's contract declares is left to that pack; one the binding names a pack for that is not composed, and arguments the contract cannot describe, are reported.
 */
export function readDatasourceExtensions(
  input: ReadDatasourceExtensionsInput,
): readonly DatasourceExtension[] {
  const { datasource, binding, diagnostics } = input;
  const { sourceId, sources } = datasource;
  const entry = entryValue(datasource, 'extensions');
  const value = entry?.value();
  if (entry === undefined || value === undefined) return [];
  if (!previewFeatures(input.generators).has(binding.previewFeature)) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_EXTENSIONS_PREVIEW_FEATURE_MISSING',
        `The datasource lists extensions, which Prisma 7 reads only with the "${binding.previewFeature}" preview feature, so Prisma 7 refuses this schema too. Add "${binding.previewFeature}" to previewFeatures in the generator block.`,
        sourceId,
        nodePslSpan(entry.syntax, sources),
      ),
    );
    return [];
  }
  const invalid = (what: string, span: PslSpan): void => {
    diagnostics.push({
      code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
      message: `datasource "${datasource.block.name}": ${what}, and Prisma 7 refuses it too. List each extension by name, such as extensions = [pg_trgm].`,
      sourceId,
      span,
    });
  };
  const list = ArrayLiteralAst.cast(value.syntax);
  if (list === undefined) {
    invalid(
      `extensions is ${text(value)}, which is not a list`,
      nodePslSpan(value.syntax, sources),
    );
    return [];
  }

  const extensions = new Map<string, DatasourceExtension>();
  for (const element of list.elements()) {
    const span = nodePslSpan(element.syntax, sources);
    const call = FunctionCallAst.cast(element.syntax);
    if (dottedPathsIn(element).length > 0) continue;
    const name = call === undefined ? IdentifierAst.cast(element.syntax)?.name() : call.path()[0];
    if (name === undefined) {
      invalid(`extensions lists ${text(element)}, which is not an extension name`, span);
      continue;
    }
    const schema = readArguments(name, call, input);
    const namespaceId = schema ?? input.defaultNamespaceId;
    const declaring = input.declaringPack(name);
    if (declaring !== undefined) {
      if (declaring.namespaceId !== namespaceId) {
        const packNamespace = declaring.namespaceId;
        const edit =
          schema === undefined
            ? `write ${name}(schema: "${packNamespace}")`
            : packNamespace === input.defaultNamespaceId
              ? `remove schema: "${schema}"`
              : `write schema: "${packNamespace}"`;
        diagnostics.push(
          prisma7Diagnostic(
            'PSL.PRISMA7_EXTENSION_SCHEMA_MISMATCH',
            `Extension "${name}": the "${declaring.packId}" extension pack declares it in schema "${packNamespace}", so Prisma 8 expects it there, but this entry puts it in schema "${namespaceId}". Moving it is a database change the pack does not make: move it with ALTER EXTENSION "${name}" SET SCHEMA "${packNamespace}", then ${edit}.`,
            sourceId,
            span,
          ),
        );
      }
      continue;
    }
    const pack = Object.hasOwn(binding.packs, name) ? binding.packs[name] : undefined;
    if (pack !== undefined && !input.composedExtensions.has(pack.id)) {
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_EXTENSION_PACK_MISSING',
          `Extension "${name}" is declared by the "${pack.id}" extension pack, which is not available. ${composePackAdvice(pack)}`,
          sourceId,
          span,
        ),
      );
      continue;
    }
    if (!extensions.has(name)) extensions.set(name, { name, namespaceId, span, sourceId });
  }
  return [...extensions.values()];
}

/** Reports each argument the contract cannot describe; returns the `schema:` argument's value. */
function readArguments(
  name: string,
  call: FunctionCallAst | undefined,
  input: ReadDatasourceExtensionsInput,
): string | undefined {
  if (call === undefined) return undefined;
  const { sourceId, sources } = input.datasource;
  const args = [...call.args()];
  const refuse = (arg: AttributeArgAst, message: string): void => {
    input.diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_EXTENSION_ARGUMENT_UNSUPPORTED',
        `Extension "${name}": ${message}`,
        sourceId,
        nodePslSpan(arg.syntax, sources),
      ),
    );
  };
  let schema: string | undefined;
  for (const arg of args) {
    const argName = arg.name()?.name();
    const argValue = stringOf(arg.value());
    if (argName === undefined) {
      refuse(arg, `the argument ${text(arg)} has no name, and Prisma 7 refuses it too. Remove it.`);
      continue;
    }
    if (argValue === undefined && ['schema', 'version', 'map'].includes(argName)) {
      refuse(arg, `${argName} must be a string, and Prisma 7 refuses ${text(arg)} too.`);
      continue;
    }
    switch (argName) {
      case 'schema':
        schema = argValue;
        break;
      case 'version':
        refuse(
          arg,
          `the version argument is not supported, because the contract does not record an extension's version. Remove ${text(arg)}; Prisma 7's next migration is then empty.`,
        );
        break;
      case 'map': {
        if (argValue === undefined || !PRISMA7_EXTENSION_NAME.test(argValue)) {
          refuse(
            arg,
            `the map argument is not supported, and Prisma 7 can write the name "${argValue}" only with map, so Prisma 8 cannot read this schema until it reads map.`,
          );
          break;
        }
        const others = args.filter((other) => other !== arg).map(text);
        const replacement = others.length === 0 ? argValue : `${argValue}(${others.join(', ')})`;
        refuse(
          arg,
          `the map argument is not supported. Replace ${text(call)} with ${replacement}, the extension's name in the database; Prisma 7's next migration is then empty.`,
        );
        break;
      }
      default:
        refuse(arg, `argument "${argName}" is not known, and Prisma 7 refuses it too. Remove it.`);
    }
  }
  return schema;
}
