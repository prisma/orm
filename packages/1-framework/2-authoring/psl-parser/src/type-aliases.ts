import {
  type AuthoringTypeAliasDescriptor,
  type AuthoringTypeConstructorDescriptor,
  type AuthoringTypeNamespace,
  type DataTypeSupport,
  findAuthoringTypeConstructorCall,
  instantiateAuthoringTypeAlias,
} from '@internal/framework-components/authoring';
import type { GeneratorFunctionRegistry } from '@internal/framework-components/components';
import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import type { TypeAttributeSpecContext } from './attribute-spec/spec-context';
import { type Binder, contributedTypeOf, type Resolution, typeReferenceNode } from './binder';
import {
  type ContributedTypeChoiceSymbol,
  isContributedTypeChoice,
} from './contributed-type-scope';
import { diagnosticSource, type PslDiagnosticCollector } from './diagnostic';
import type { PslSources } from './source-file';
import type {
  BlockSymbol,
  FieldSymbol,
  NamedTypeSymbol,
  ResolvedAttribute,
  ResolvedTypeConstructorCall,
  SymbolTable,
} from './symbol-table';
import type { FieldAttributeAst } from './syntax/ast/attributes';
import { isTrivia } from './syntax/navigation';
import type { SyntaxNode } from './syntax/red';
import { isBareTypeConstructor } from './type-constructor-calls';

/** The attributes a type alias may carry. Every field typed by the alias takes them. */
export const TYPE_ALIAS_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  'default',
  'onCreate',
  'onUpdate',
]);

/** What a type alias is written as: a type constructor, called or bare, or a block such as an enum, which its family reads. */
export type TypeAliasBase =
  | {
      readonly kind: 'typeConstructor';
      readonly descriptor: AuthoringTypeConstructorDescriptor;
      /** `undefined` when the constructor is written bare. */
      readonly call: ResolvedTypeConstructorCall | undefined;
    }
  | {
      readonly kind: 'typeChoice';
      readonly symbol: ContributedTypeChoiceSymbol;
      /** `undefined` when the type choice is written bare. */
      readonly call: ResolvedTypeConstructorCall | undefined;
    }
  | { readonly kind: 'block'; readonly symbol: BlockSymbol };

/** A `types {}` declaration read as a type alias: its base, one level deep, and the attributes its fields take. */
export interface TypeAlias {
  readonly symbol: NamedTypeSymbol;
  readonly base: TypeAliasBase;
  /** The base as written, such as `VarChar(64)`'s `VarChar` or an enum's name. */
  readonly baseName: string;
  readonly baseResolution: Resolution;
  /** The alias's `@default`, `@onCreate` and `@onUpdate`. */
  readonly attributes: readonly ResolvedAttribute<FieldAttributeAst>[];
}

function writtenBase(declaration: NamedTypeSymbol, sources: PslSources): string {
  const node = typeReferenceNode(declaration);
  if (node === undefined) return declaration.baseType ?? '';
  return sources.sourceFileFor(node).text.slice(node.offset, node.endOffset).trim();
}

/** A node's text without its comments, each run of whitespace and comments written as one space. */
function writtenText(node: SyntaxNode): string {
  let text = '';
  let pendingSpace = false;
  for (const token of node.tokens()) {
    if (isTrivia(token)) {
      pendingSpace = text.length > 0;
      continue;
    }
    text += `${pendingSpace ? ' ' : ''}${token.text}`;
    pendingSpace = false;
  }
  return text;
}

/** The alias `declaration` is written as, if it is written as another `types {}` declaration. */
function declaredBaseOf(
  declaration: NamedTypeSymbol,
  declarations: readonly NamedTypeSymbol[],
  sources: PslSources,
): NamedTypeSymbol | undefined {
  const base = writtenBase(declaration, sources);
  return declarations.find((other) => other !== declaration && other.name === base);
}

/**
 * What `declaration` stands for, written as one alias with a base that is not an alias: the type of the last alias of the chain, and the attributes of every alias in it, a nearer alias's attribute replacing a farther one's. `undefined` when the chain loops or ends at a contributed alias.
 */
function expandedDefinition(
  declaration: NamedTypeSymbol,
  declarations: readonly NamedTypeSymbol[],
  sources: PslSources,
  binder: Binder,
): string | undefined {
  const chain = [declaration];
  let next = declaredBaseOf(declaration, declarations, sources);
  while (next !== undefined) {
    if (chain.includes(next)) return undefined;
    chain.push(next);
    next = declaredBaseOf(next, declarations, sources);
  }
  const last = chain.at(-1) ?? declaration;
  const reference = typeReferenceNode(last);
  const annotation = last.node.typeAnnotation()?.syntax;
  if (annotation === undefined || reference === undefined) return undefined;
  if (contributedTypeAliasOf(binder.symbolForNode(reference)) !== undefined) return undefined;
  const attributes = new Map<string, string>();
  for (const alias of [...chain].reverse()) {
    for (const attribute of alias.attributes) {
      attributes.set(attribute.name, writtenText(attribute.node.syntax));
    }
  }
  return [writtenText(annotation), ...attributes.values()].join(' ');
}

/** `path`, called with `args` when it takes any; `undefined` when an argument is not a number, string or boolean. */
function writtenCall(path: readonly string[], args: readonly unknown[]): string | undefined {
  const written: string[] = [];
  for (const arg of args) {
    if (typeof arg === 'string') written.push(JSON.stringify(arg));
    else if (typeof arg === 'number' || typeof arg === 'boolean') written.push(String(arg));
    else return undefined;
  }
  const name = path.join('.');
  return written.length === 0 ? name : `${name}(${written.join(', ')})`;
}

/** The refusal of an alias written as another alias, saying what to write instead; `undefined` when its base is not an alias. */
function aliasBaseMessage(
  declaration: NamedTypeSymbol,
  resolution: Resolution | undefined,
  input: {
    readonly declarations: readonly NamedTypeSymbol[];
    readonly sources: PslSources;
    readonly binder: Binder;
    readonly authoringTypes: AuthoringTypeNamespace | undefined;
  },
): string | undefined {
  const refusal = (base: string) =>
    `Type alias "${declaration.name}" is written as the type alias "${base}", and a type alias cannot be written as another one.`;
  const declared = declaredBaseOf(declaration, input.declarations, input.sources);
  if (declared !== undefined) {
    const expanded = expandedDefinition(
      declaration,
      input.declarations,
      input.sources,
      input.binder,
    );
    if (expanded === undefined) return refusal(declared.name);
    const meaning =
      declaredBaseOf(declared, input.declarations, input.sources) === undefined
        ? 'is written as'
        : 'stands for';
    return `${refusal(declared.name)} Write what "${declared.name}" ${meaning} instead: ${declaration.name} = ${expanded}`;
  }
  const contributed = contributedTypeAliasOf(resolution);
  if (contributed === undefined) return undefined;
  const { onCreate, onUpdate } = contributed.descriptor.output;
  const attributes = Object.entries({ onCreate, onUpdate }).flatMap(([phase, call]) =>
    call === undefined ? [] : [`@${phase}(${call.name}())`],
  );
  const insteadOfAlias = `${refusal(contributed.name)} Type the fields ${contributed.name} instead`;
  const call =
    input.authoringTypes === undefined
      ? undefined
      : findAuthoringTypeConstructorCall(
          input.authoringTypes,
          instantiateAuthoringTypeAlias(contributed.descriptor).type,
        );
  const type = call === undefined ? undefined : writtenCall(call.path, call.args);
  if (type !== undefined) {
    return `${insteadOfAlias}, or write: ${[`${declaration.name} = ${type}`, ...attributes].join(' ')}`;
  }
  const written = attributes.length === 0 ? '' : ` with ${attributes.join(' ')}`;
  return `${insteadOfAlias}, or write ${declaration.name} as a type constructor${written}.`;
}

function baseOf(
  declaration: NamedTypeSymbol,
  resolution: Resolution | undefined,
): TypeAliasBase | undefined {
  if (resolution?.kind === 'block' && !declaration.isConstructor) {
    return { kind: 'block', symbol: resolution.symbol };
  }
  if (resolution?.kind !== 'contributedType') return undefined;
  if (isContributedTypeChoice(resolution.symbol)) {
    return { kind: 'typeChoice', symbol: resolution.symbol, call: declaration.typeConstructor };
  }
  const { descriptor } = resolution.symbol;
  if (descriptor.kind !== 'typeConstructor') return undefined;
  if (declaration.isConstructor) {
    return { kind: 'typeConstructor', descriptor, call: declaration.typeConstructor };
  }
  return isBareTypeConstructor(descriptor)
    ? { kind: 'typeConstructor', descriptor, call: undefined }
    : undefined;
}

function fieldOnlyAttributeMessage(
  attribute: ResolvedAttribute<FieldAttributeAst>,
  declaration: NamedTypeSymbol,
): string | undefined {
  return attribute.name === 'id' || attribute.name === 'unique'
    ? `Type alias "${declaration.name}" cannot carry @${attribute.name}. @id and @unique belong to a model's field, not to its type; write them on the field.`
    : undefined;
}

/**
 * Reads each `types {}` declaration as a type alias. A base must be a type constructor or a block; another alias or anything else is refused, as is an alias with no base. Of the attributes, those the family accepts are kept and every other one is refused and dropped, keeping the alias, so its fields are not refused for it too.
 */
export function resolveTypeAliases(input: {
  readonly declarations: readonly NamedTypeSymbol[];
  readonly binder: Binder;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
  /** The stack's type constructors, which the refusal of an alias written as a contributed alias suggests from. */
  readonly authoringTypes: AuthoringTypeNamespace | undefined;
  /** The attributes the family lets a type alias carry; `TYPE_ALIAS_ATTRIBUTE_NAMES` by default. */
  readonly acceptedAttributes?: ReadonlySet<string>;
  /** The family's wording for an attribute no type alias takes, or `undefined` for the shared wording. */
  readonly describeUnsupportedAttribute?: (
    attribute: ResolvedAttribute<FieldAttributeAst>,
    declaration: NamedTypeSymbol,
  ) => string | undefined;
}): Map<NamedTypeSymbol, TypeAlias> {
  const aliases = new Map<NamedTypeSymbol, TypeAlias>();
  const accepted = input.acceptedAttributes ?? TYPE_ALIAS_ATTRIBUTE_NAMES;
  for (const declaration of input.declarations) {
    const source = diagnosticSource(input.sources, declaration.node.syntax);
    const refuseBase = (code: string, message: string, span = declaration.span) =>
      input.diagnostics.push({ code, message, ...source.at(span) });
    const reference = typeReferenceNode(declaration);
    const resolution = reference === undefined ? undefined : input.binder.symbolForNode(reference);
    const written = declaration.isConstructor ? declaration.typeConstructor : declaration.baseType;
    if (written === undefined) {
      refuseBase(
        'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        `Type alias "${declaration.name}" must declare a base type or constructor`,
      );
      continue;
    }
    const base = baseOf(declaration, resolution);
    if (base === undefined || resolution === undefined) {
      if (declaration.typeConstructor !== undefined) {
        refuseBase(
          'PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR',
          `Type alias "${declaration.name}" references unsupported constructor "${declaration.typeConstructor.path.join('.')}"`,
          declaration.typeConstructor.span,
        );
      } else {
        refuseBase(
          'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          aliasBaseMessage(declaration, resolution, input) ??
            `Type alias "${declaration.name}" references unsupported base type "${writtenBase(declaration, input.sources)}"`,
        );
      }
      continue;
    }

    const attributes: ResolvedAttribute<FieldAttributeAst>[] = [];
    for (const attribute of declaration.attributes) {
      if (accepted.has(attribute.name)) {
        attributes.push(attribute);
        continue;
      }
      const message =
        fieldOnlyAttributeMessage(attribute, declaration) ??
        input.describeUnsupportedAttribute?.(attribute, declaration) ??
        `Type alias "${declaration.name}" uses unsupported attribute "${attribute.name}"`;
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message,
        ...source.at(attribute.span),
      });
    }

    aliases.set(declaration, {
      symbol: declaration,
      base,
      baseName: declaration.baseType ?? writtenBase(declaration, input.sources),
      baseResolution: resolution,
      attributes,
    });
  }
  return aliases;
}

/** A type alias a pack contributes, such as `temporal.CreatedAt`. */
export interface ContributedTypeAlias {
  /** The alias's path, as a field writes it. */
  readonly name: string;
  readonly descriptor: AuthoringTypeAliasDescriptor;
}

/** The contributed type alias a type reference resolves to, if it resolves to one. */
export function contributedTypeAliasOf(
  resolution: Resolution | undefined,
): ContributedTypeAlias | undefined {
  if (resolution?.kind !== 'contributedType') return undefined;
  const { descriptor, path } = resolution.symbol;
  return descriptor.kind === 'typeAlias' ? { name: path.join('.'), descriptor } : undefined;
}

/** The names of the attributes a type alias sets for every field typed by it. */
export function typeAliasAttributeNames(
  alias: TypeAlias | ContributedTypeAlias,
): ReadonlySet<string> {
  if ('symbol' in alias) return new Set(alias.attributes.map(({ name }) => name));
  const { onCreate, onUpdate } = alias.descriptor.output;
  return new Set(
    Object.entries({ onCreate, onUpdate }).flatMap(([name, value]) =>
      value === undefined ? [] : [name],
    ),
  );
}

/** The type alias a field is typed by, if it is typed by one. */
export function typeAliasOfField(
  field: FieldSymbol,
  binder: Binder,
  aliases: ReadonlyMap<NamedTypeSymbol, TypeAlias>,
): TypeAlias | undefined {
  const node = typeReferenceNode(field);
  const resolution = node === undefined ? undefined : binder.symbolForNode(node);
  return resolution?.kind === 'namedType' ? aliases.get(resolution.symbol) : undefined;
}

/** The spec context the attributes a type alias carries are read in, as a field's are read in its own. */
export function typeAliasSpecContext(
  alias: TypeAlias,
  input: {
    readonly symbols: SymbolTable;
    readonly binder: Binder;
    readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
    readonly generatorFunctions: GeneratorFunctionRegistry;
    readonly dataTypes: DataTypeSupport;
  },
): TypeAttributeSpecContext {
  return {
    symbols: input.symbols,
    defaultFunctionRegistry: input.defaultFunctionRegistry,
    generatorFunctions: input.generatorFunctions,
    dataTypes: input.dataTypes,
    subject: { kind: 'type alias', name: alias.symbol.name },
    list: false,
    typeName: alias.baseName,
    typeResolution: alias.baseResolution,
    contributedType: contributedTypeOf(
      alias.baseResolution,
      input.binder,
      alias.symbol.typeConstructor,
    ),
  };
}

/**
 * Refuses each attribute a field writes that its type alias already carries, at the field's attribute. Returns whether it refused any.
 */
export function refuseRepeatedTypeAliasAttributes(input: {
  readonly field: FieldSymbol;
  /** `Model.field`. */
  readonly fieldPath: string;
  readonly alias: TypeAlias | ContributedTypeAlias;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): boolean {
  const carried = typeAliasAttributeNames(input.alias);
  const aliasName = 'symbol' in input.alias ? input.alias.symbol.name : input.alias.name;
  const repeated = input.field.attributes.filter(({ name }) => carried.has(name));
  const source = diagnosticSource(input.sources, input.field.node.syntax);
  for (const attribute of repeated) {
    input.diagnostics.push({
      code: 'PSL_DUPLICATE_ATTRIBUTE',
      message: `Field "${input.fieldPath}" writes @${attribute.name}, which its type alias "${aliasName}" already sets. Remove one of them.`,
      ...source.at(attribute.span),
    });
  }
  return repeated.length > 0;
}
