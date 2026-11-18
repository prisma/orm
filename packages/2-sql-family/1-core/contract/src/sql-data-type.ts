/**
 * SQL data types: the texts a database type is written and reported with, its parameters, its
 * normal form, and how a reported type is recognised from those declarations.
 *
 * A data type declares its facts once. Everything that writes a type name, compares a catalog text
 * or reads a reported type goes through the functions here and contains no type name of its own.
 *
 * ADR 254.
 */

import type {
  DataType,
  DataTypeId,
  DataTypeLookup,
  DataTypeSpec,
  TypeLookups,
} from '@internal/framework-components/codec';
import {
  assertDataTypeParams,
  dataType,
  dataTypeParams,
  objectSchemaKeys,
  schemaKeysAllowing,
} from '@internal/framework-components/codec';
import { canonicalizeJson } from '@internal/framework-components/utils';
import type { ReportedSqlType } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { type as arktype, type Type } from 'arktype';
import { contractError } from './contract-errors';

/** One way a database type is written or reported. */
export interface SqlTypeText {
  /** Lower case with single spaces; `{name}` stands for the parameter `name`. */
  readonly text: string;
  /** A migration writes this text. */
  readonly written?: true;
  /** The database catalog prints this text. */
  readonly catalog?: true;
  /** The exact characters written and printed, when they differ from `text` in letter case only. */
  readonly display?: string;
}

export type SqlTypeParams = Readonly<Record<string, unknown>>;

export interface SqlDataTypeSpec<Params extends SqlTypeParams = SqlTypeParams>
  extends Omit<DataTypeSpec, 'normalize'> {
  readonly params?: Type<Params>;
  readonly texts?: readonly SqlTypeText[];
  /** The kind of reported type this data type claims, instead of any text. */
  readonly claimsKind?: string;
  /** The id of the type a column of this type is stored as, with the same parameters. A type stored as another declares no texts. */
  readonly storedAs?: DataTypeId;
  readonly normalize?: (params: Params) => Params;
  /** The parameters the database catalog prints for parameters as written, when they are not their normal form: PostgreSQL prints no precision for a bare `timestamptz`, though its normal form has precision 6. */
  readonly catalogParams?: (params: Params) => Params;
  /** The type's name from its parameters, for a type that claims a kind or whose name is its catalog text. */
  readonly render?: (params: Params) => string;
  readonly fromReported?: (reported: ReportedSqlType) => Params;
  /**
   * The name `render` writes is the text the database catalog prints, exactly. Such a type has no
   * texts and claims no kind; it has no base name; verify compares its name with the reported text
   * unchanged; and a target writes and sends it as given. ADR 273.
   */
  readonly nameIsCatalogText?: true;
}

export interface SqlDataTypeFacts<Params extends SqlTypeParams = SqlTypeParams> {
  readonly texts: readonly SqlTypeText[];
  readonly claimsKind: string | undefined;
  readonly storedAs: DataTypeId | undefined;
  /** The normal form of `params`; parameters the type's schema refuses are returned as written. */
  readonly normalize: (params: Params) => Params;
  /** The parameters the catalog prints for `params` as written: the declared {@link SqlDataTypeSpec.catalogParams}, or else the normal form. */
  readonly catalogParams: (params: Params) => Params;
  readonly render: ((params: Params) => string) | undefined;
  readonly fromReported: ((reported: ReportedSqlType) => Params) | undefined;
  readonly nameIsCatalogText: boolean;
}

export interface SqlDataType<Params extends SqlTypeParams = SqlTypeParams> extends DataType {
  readonly params?: Type<Params>;
  readonly sql: SqlDataTypeFacts<Params>;
}

/** A data type that claims a type text, with the parameters the text gives in their normal form. */
export interface ResolvedSqlType {
  readonly dataType: SqlDataType;
  readonly typeParams: SqlTypeParams;
}

/** A type a migration writes, read as {@link ResolvedSqlType}, with its parameters also as the text writes them, before the normal form. */
export interface ResolvedWrittenSqlType extends ResolvedSqlType {
  readonly writtenTypeParams: SqlTypeParams;
}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
const LITERAL_CHARACTERS = /^[a-z0-9_ (),.]*$/;
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function paramKeysOf(id: DataTypeId, schema: Type<unknown> | undefined): readonly string[] {
  if (schema === undefined) return [];
  const keys = objectSchemaKeys(schema);
  if (keys === undefined) {
    refuseDeclaration(id, 'its parameter schema must be an arktype object schema.');
  }
  return keys;
}

function placeholdersOf(text: string): readonly string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
}

function placeholderSetOf(text: string): string {
  return [...placeholdersOf(text)].sort().join(',');
}

function patternOf(text: string, signedKeys: readonly string[] = []): RegExp {
  const escaped = text.replace(REGEXP_SPECIAL, '\\$&');
  const placeholders = escaped.replace(/\\\{([A-Za-z][A-Za-z0-9]*)\\\}/g, (_, name: string) =>
    signedKeys.includes(name) ? '(-?\\d+)' : '(\\d+)',
  );
  return new RegExp(`^${placeholders}$`);
}

function refuseDeclaration(id: DataTypeId, why: string): never {
  throw new InternalError(`Data type ${id}: ${why}`);
}

function checkText(id: DataTypeId, text: SqlTypeText, paramKeys: readonly string[]): void {
  const quoted = JSON.stringify(text.text);
  const refuse = (why: string): never => refuseDeclaration(id, `the text ${quoted} ${why}.`);
  if (text.text === '') refuse('is empty');
  if (text.text !== text.text.trim()) refuse('starts or ends with a space');
  if (text.text.includes('  ')) refuse('has two spaces in a row');
  const literal = text.text.replace(PLACEHOLDER, '');
  if (literal.includes('{') || literal.includes('}')) {
    refuse('has a placeholder that is not written {name}');
  }
  if (!LITERAL_CHARACTERS.test(literal)) {
    refuse(
      'must be lower case and contain only letters, digits, spaces, brackets, commas, dots, underscores and placeholders',
    );
  }
  for (const name of placeholdersOf(text.text)) {
    if (!paramKeys.includes(name)) {
      refuse(`names the parameter {${name}}, which the type does not declare`);
    }
  }
  if (text.display === undefined) return;
  const display = JSON.stringify(text.display);
  if (text.display.toLowerCase() !== text.text.toLowerCase()) {
    refuse(`has the display ${display}, which differs from it beyond letter case`);
  }
  if (placeholdersOf(text.display).join(',') !== placeholdersOf(text.text).join(',')) {
    refuse(`has the display ${display}, which writes a placeholder differently`);
  }
}

function checkMarks(id: DataTypeId, texts: readonly SqlTypeText[]): void {
  const marked = new Map<string, { written?: string; catalog?: string }>();
  for (const text of texts) {
    const key = placeholderSetOf(text.text);
    const entry = marked.get(key) ?? {};
    for (const mark of ['written', 'catalog'] as const) {
      if (text[mark] !== true) continue;
      const other = entry[mark];
      if (other !== undefined) {
        refuseDeclaration(
          id,
          `the texts ${JSON.stringify(other)} and ${JSON.stringify(text.text)} have the same placeholders and are both ${mark}.`,
        );
      }
      entry[mark] = text.text;
    }
    marked.set(key, entry);
  }
}

function checkKindClaim<Params extends SqlTypeParams>(
  id: DataTypeId,
  spec: SqlDataTypeSpec<Params>,
): void {
  if (spec.nameIsCatalogText === true) {
    if (spec.render === undefined) {
      refuseDeclaration(id, 'a type whose name is its catalog text declares render.');
    }
    if (spec.texts !== undefined || spec.claimsKind !== undefined) {
      refuseDeclaration(
        id,
        'a type whose name is its catalog text declares no texts and claims no kind.',
      );
    }
  }
  if (spec.claimsKind === undefined) {
    if (spec.render !== undefined && spec.nameIsCatalogText !== true) {
      refuseDeclaration(
        id,
        'render is allowed only together with claimsKind or nameIsCatalogText.',
      );
    }
    if (spec.fromReported !== undefined) {
      refuseDeclaration(id, 'fromReported is allowed only together with claimsKind.');
    }
    return;
  }
  if (spec.texts !== undefined) {
    refuseDeclaration(id, 'a type that claims a kind declares no texts.');
  }
}

function checkStoredAs<Params extends SqlTypeParams>(
  id: DataTypeId,
  spec: SqlDataTypeSpec<Params>,
): void {
  if (spec.storedAs === undefined) return;
  if (spec.texts !== undefined) {
    refuseDeclaration(
      id,
      'a type stored as another declares no texts; its name is the name of the type it is stored as.',
    );
  }
  if (spec.claimsKind !== undefined) {
    refuseDeclaration(id, 'a type stored as another claims no kind.');
  }
}

const identity = <Params>(params: Params): Params => params;

function isParamsOf<Params extends SqlTypeParams>(
  schema: Type<Params> | undefined,
  params: SqlTypeParams,
): params is Params {
  return schema === undefined || !(schema(params) instanceof arktype.errors);
}

function checkNormalFormsWritten<Params extends SqlTypeParams>(type: SqlDataType<Params>): void {
  const written = new Set(
    type.sql.texts
      .filter((text) => text.written === true)
      .map((text) => placeholderSetOf(text.text)),
  );
  if (written.size === 0) return;
  const probes = [
    {},
    ...type.sql.texts.map((text) =>
      Object.fromEntries(placeholdersOf(text.text).map((name) => [name, 1])),
    ),
  ];
  for (const probe of probes) {
    if (!isParamsOf(type.params, probe)) continue;
    const normalKeys = presentKeys(type.sql.normalize(probe));
    if (!written.has([...normalKeys].sort().join(','))) {
      refuseDeclaration(
        type.id,
        `the parameters ${formatKeys(Object.keys(probe))} have the normal form ${formatKeys(normalKeys)}, which no written text takes.`,
      );
    }
  }
}

/** Declare a SQL data type, refusing a declaration that breaks a rule of the module. */
export function sqlDataType<Params extends SqlTypeParams = SqlTypeParams>(
  id: string,
  spec: SqlDataTypeSpec<Params>,
): SqlDataType<Params> {
  const declaredNormalize = spec.normalize ?? identity;
  const normalize = (params: Params): Params =>
    isParamsOf(spec.params, params) ? declaredNormalize(params) : params;
  const { params: _untypedParams, ...declared } = dataType(id, {
    ...spec,
    normalize,
  });
  const texts = spec.texts ?? [];
  const paramKeys = paramKeysOf(declared.id, spec.params);
  for (const text of texts) checkText(declared.id, text, paramKeys);
  checkMarks(declared.id, texts);
  checkKindClaim(declared.id, spec);
  checkStoredAs(declared.id, spec);
  const declaredCatalogParams = spec.catalogParams;
  const catalogParams =
    declaredCatalogParams === undefined
      ? normalize
      : (params: Params): Params =>
          isParamsOf(spec.params, params) ? declaredCatalogParams(params) : params;
  const type: SqlDataType<Params> = {
    ...declared,
    ...ifDefined('params', spec.params),
    sql: {
      texts,
      claimsKind: spec.claimsKind,
      storedAs: spec.storedAs,
      normalize,
      catalogParams,
      render: spec.render,
      fromReported: spec.fromReported,
      nameIsCatalogText: spec.nameIsCatalogText === true,
    },
  };
  checkNormalFormsWritten(type);
  return type;
}

/** Whether the name of `type` is the text the database catalog prints, as declared by {@link SqlDataTypeSpec.nameIsCatalogText}. */
export function nameIsCatalogText<Params extends SqlTypeParams>(
  type: SqlDataType<Params>,
): boolean {
  return type.sql.nameIsCatalogText;
}

/** Whether `type` is a data type a SQL column can have. `sql/expression` is the one data type no column has. */
export function isSqlDataType(type: DataType): type is SqlDataType {
  return 'sql' in type;
}

function presentKeys(params: SqlTypeParams): readonly string[] {
  return Object.keys(params).filter((key) => params[key] !== undefined);
}

function formatKeys(keys: readonly string[]): string {
  return `[${[...keys].sort().join(', ')}]`;
}

/** The parameters, when `type` accepts them; otherwise `CONTRACT.TYPE_PARAMS_INVALID` naming each parameter it refuses. */
export function validateSqlTypeParams<Params extends SqlTypeParams>(
  type: SqlDataType<Params>,
  params: SqlTypeParams,
): Params {
  assertDataTypeParams(type, params);
  return blindCast<
    Params,
    'the schema accepted params, or the type declares none; an object schema of parameters has no morphs, so the accepted value is the parameters as declared'
  >(params);
}

function pickText<Params extends SqlTypeParams>(
  type: SqlDataType<Params>,
  mark: 'written' | 'catalog',
  keys: readonly string[],
): SqlTypeText {
  const candidates = type.sql.texts.filter((text) => text[mark] === true);
  const wanted = [...keys].sort().join(',');
  const found = candidates.find((text) => placeholderSetOf(text.text) === wanted);
  if (found !== undefined) return found;
  const verb = mark === 'written' ? 'written' : 'reported';
  const takes =
    candidates.length === 0
      ? `it is never ${verb}`
      : `it is ${verb} with ${candidates.map((text) => formatKeys(placeholdersOf(text.text))).join(', ')}`;
  throw contractError(
    'CONTRACT.TYPE_PARAMS_INVALID',
    `${type.id} cannot be ${verb} with parameters ${formatKeys(keys)}; ${takes}`,
    { meta: { dataType: type.id, parameters: [...keys] } },
  );
}

function substitute<Params extends SqlTypeParams>(
  type: SqlDataType<Params>,
  text: SqlTypeText,
  params: SqlTypeParams,
): string {
  return (text.display ?? text.text).replace(PLACEHOLDER, (_, name: string) => {
    const value = params[name];
    if (!Number.isSafeInteger(value)) {
      throw contractError(
        'CONTRACT.TYPE_PARAMS_INVALID',
        `${type.id}: the parameter ${name} is written into the type name and must be an integer`,
        { meta: { dataType: type.id, parameters: [name] } },
      );
    }
    return String(value);
  });
}

/**
 * The name of `type` with no parameters, for places where parameters must not appear, such as a
 * cast. A type whose name is its catalog text has none: its parameters cannot be separated from its
 * name, so it is refused.
 */
export function sqlBaseName<Params extends SqlTypeParams>(
  type: SqlDataType<Params>,
  params: SqlTypeParams,
): string {
  if (type.sql.nameIsCatalogText) {
    throw new InternalError(
      `Data type ${type.id} names its type by its catalog text, so it has no base name.`,
    );
  }
  if (type.sql.render !== undefined) return type.sql.render(validateSqlTypeParams(type, params));
  const written = type.sql.texts.filter((text) => text.written === true);
  const fewest = written.reduce<SqlTypeText | undefined>(
    (best, text) =>
      best === undefined || placeholdersOf(text.text).length < placeholdersOf(best.text).length
        ? text
        : best,
    undefined,
  );
  if (fewest === undefined) {
    throw new InternalError(
      `Data type ${type.id} has no written text and no render, so it has no base name.`,
    );
  }
  const name = fewest.display ?? fewest.text;
  if (placeholdersOf(fewest.text).length === 0) return name;
  const bracket = name.indexOf('(');
  return bracket === -1 ? name : name.slice(0, bracket);
}

/**
 * The base name of `type` with `params`, unquoted, for display. It differs from {@link sqlBaseName}
 * for a type that claims a kind, where it is the `typeName` parameter as written (`app.status`)
 * while `sqlBaseName` gives the quoted name `render` writes into SQL (`"app"."status"`), and for a
 * type whose name is its catalog text, where it is that whole text.
 */
export function unquotedSqlBaseName<Params extends SqlTypeParams>(
  type: SqlDataType<Params>,
  params: SqlTypeParams,
): string {
  if (type.sql.nameIsCatalogText) return renderSqlTypeName(type, params);
  if (type.sql.claimsKind === undefined) return sqlBaseName(type, params);
  const { typeName } = validateSqlTypeParams(type, params);
  if (typeof typeName !== 'string') {
    throw new InternalError(
      `Data type ${type.id} claims the kind "${type.sql.claimsKind}" but declares no string typeName parameter.`,
    );
  }
  return typeName;
}

const ADD_THE_CODEC_PACK =
  'Add the pack that provides the codec, and so declares its data type, to the configuration: to `extensions` in prisma.config or in defineContract.';

/** The SQL data type the codec `codecId` represents. */
export function sqlDataTypeOfCodec(codecId: string, lookups: TypeLookups): SqlDataType {
  const descriptor = lookups.codecLookup.descriptorFor(codecId);
  if (descriptor === undefined) {
    throw contractError(
      'CONTRACT.CODEC_DESCRIPTOR_MISSING',
      `No codec "${codecId}" is registered, so its column type cannot be named.`,
      { fix: ADD_THE_CODEC_PACK, meta: { codecId } },
    );
  }
  const type = lookups.dataTypeLookup.get(descriptor.dataType);
  if (type === undefined) {
    throw contractError(
      'CONTRACT.DATA_TYPE_UNREGISTERED',
      `Codec "${codecId}" represents data type "${descriptor.dataType}", which no component registers.`,
      { fix: ADD_THE_CODEC_PACK, meta: { codecId, dataType: descriptor.dataType } },
    );
  }
  if (!isSqlDataType(type)) {
    throw new InternalError(`Data type ${type.id} is not a SQL data type, so it has no type name.`);
  }
  return type;
}

/**
 * The length of a column of data type `type` with `typeParams`, in the type's normal form, as verify compares it: a bare Postgres `character` holds 1. `undefined` when the column has no length, or when its data type drops the length because the database does not limit it, as SQLite's text types do.
 */
export function sqlColumnLength(
  type: DataType | undefined,
  typeParams: Readonly<Record<string, unknown>> | undefined,
): number | undefined {
  if (type === undefined || !isSqlDataType(type)) return undefined;
  const length = type.sql.normalize(dataTypeParams(type, typeParams ?? {}))['length'];
  return typeof length === 'number' ? length : undefined;
}

/** The length of a column of `codecId` in its data type's normal form, or `undefined` for a column with no length or one whose database does not limit it. */
export function sqlCodecColumnLength(
  dataTypes: {
    readonly lookup: Pick<DataTypeLookup, 'get'>;
    readonly dataTypeOfCodec: (codecId: string) => DataTypeId | undefined;
  },
  codecId: string,
  typeParams: Readonly<Record<string, unknown>> | undefined,
): number | undefined {
  const dataTypeId = dataTypes.dataTypeOfCodec(codecId);
  return sqlColumnLength(
    dataTypeId === undefined ? undefined : dataTypes.lookup.get(dataTypeId),
    typeParams,
  );
}

/** The type a column of `type` is stored as, whose name DDL writes and the database reports: `type` itself unless it names another. */
export function sqlStorageType(
  type: SqlDataType,
  lookup: Pick<DataTypeLookup, 'get'>,
): SqlDataType {
  if (type.sql.storedAs === undefined) return type;
  const storage = lookup.get(type.sql.storedAs);
  if (storage === undefined || !isSqlDataType(storage)) {
    throw contractError(
      'CONTRACT.DATA_TYPE_UNREGISTERED',
      `Data type "${type.id}" is stored as "${type.sql.storedAs}", which no component registers as a SQL data type.`,
      { meta: { dataType: type.sql.storedAs, storedBy: type.id } },
    );
  }
  return storage;
}

/** The id of the type a column of the data type `dataTypeId` is stored as: {@link sqlStorageType} of it, which refuses a storage type the lookup does not register, or `dataTypeId` itself when the lookup does not know it as a SQL data type. */
export function sqlStorageTypeId(dataTypeId: string, lookup: Pick<DataTypeLookup, 'get'>): string {
  const type = lookup.get(dataTypeId);
  return type !== undefined && isSqlDataType(type) ? sqlStorageType(type, lookup).id : dataTypeId;
}

/** The parts of a contract column that make its type. */
export interface SqlColumnTypeFields {
  readonly dataType: string;
  readonly typeParams?: Readonly<Record<string, unknown>>;
  readonly many?: unknown;
}

/** The type a column is stored as, with its parameters in normal form, or the column's own id and parameters as written when the lookup does not know its data type as a SQL data type. */
function storedColumnType(column: SqlColumnTypeFields, lookup: Pick<DataTypeLookup, 'get'>) {
  const type = lookup.get(column.dataType);
  if (type === undefined || !isSqlDataType(type)) {
    return { id: column.dataType, params: column.typeParams ?? {} };
  }
  const storage = sqlStorageType(type, lookup);
  return {
    id: storage.id,
    params: storage.sql.normalize(dataTypeParams(storage, column.typeParams ?? {})),
  };
}

/**
 * Whether two contract columns have the same type: the types their data types are stored as are one type, those types' parameters are equal in normal form, and both or neither are lists. ADR 254.
 */
export function sameSqlColumnType(
  a: SqlColumnTypeFields,
  b: SqlColumnTypeFields,
  lookup: Pick<DataTypeLookup, 'get'>,
): boolean {
  const isList = (column: SqlColumnTypeFields) =>
    column.many !== undefined && column.many !== false;
  const left = storedColumnType(a, lookup);
  const right = storedColumnType(b, lookup);
  return (
    left.id === right.id &&
    canonicalizeJson(left.params) === canonicalizeJson(right.params) &&
    isList(a) === isList(b)
  );
}

/** The type a column of the codec `codecId` is stored as: {@link sqlStorageType} of the data type it represents. */
export function sqlStorageTypeOfCodec(codecId: string, lookups: TypeLookups): SqlDataType {
  return sqlStorageType(sqlDataTypeOfCodec(codecId, lookups), lookups.dataTypeLookup);
}

/** {@link unquotedSqlBaseName} of the type a column of the codec `codecId` is stored as. */
export function unquotedSqlBaseNameOfCodec(
  codecId: string,
  typeParams: SqlTypeParams | undefined,
  lookups: TypeLookups,
): string {
  const type = sqlStorageTypeOfCodec(codecId, lookups);
  return unquotedSqlBaseName(type, dataTypeParams(type, typeParams));
}

/** The text a migration writes for `type` with the raw `params`. */
export function renderSqlTypeName<Params extends SqlTypeParams>(
  type: SqlDataType<Params>,
  params: SqlTypeParams,
): string {
  const validated = validateSqlTypeParams(type, params);
  if (type.sql.render !== undefined) return type.sql.render(validated);
  const normalized = type.sql.normalize(validated);
  const keys = presentKeys(params).filter((key) => Object.hasOwn(normalized, key));
  return substitute(type, pickText(type, 'written', keys), params);
}

/** The text the database catalog prints for `type` with `params` as written, from the parameters its catalog prints for them ({@link SqlDataTypeFacts.catalogParams}). */
export function renderSqlCatalogText<Params extends SqlTypeParams>(
  type: SqlDataType<Params>,
  params: SqlTypeParams,
): string {
  const validated = validateSqlTypeParams(type, params);
  if (type.sql.claimsKind !== undefined) {
    throw new InternalError(
      `Data type ${type.id} claims the kind "${type.sql.claimsKind}" and has no catalog text.`,
    );
  }
  if (type.sql.render !== undefined) return type.sql.render(validated);
  const printed = type.sql.catalogParams(validated);
  return substitute(type, pickText(type, 'catalog', presentKeys(printed)), printed);
}

function prepareReportedText(text: string): string {
  let prepared = '';
  let quoted = false;
  let spacePending = false;
  for (const character of text.trim()) {
    if (!quoted && /\s/.test(character)) {
      spacePending = true;
      continue;
    }
    if (spacePending && !/[(,]$/.test(prepared) && character !== ')') prepared += ' ';
    spacePending = false;
    if (character === '"') quoted = !quoted;
    prepared += quoted ? character : character.toLowerCase();
  }
  return prepared;
}

function claims(text: SqlTypeText): boolean {
  return text.catalog === true || text.written !== true;
}

function claimingTexts<Params extends SqlTypeParams>(type: SqlDataType<Params>): readonly string[] {
  return type.sql.texts.filter(claims).map((text) => text.text);
}

function textsCollide(a: string, b: string): boolean {
  const withOnes = (text: string) => text.replace(PLACEHOLDER, '1');
  return patternOf(a).test(withOnes(b)) || patternOf(b).test(withOnes(a));
}

/** Two SQL data types that would both recognise one reported type, and what each claims. */
export interface SqlDataTypeCollision {
  readonly first: SqlDataType;
  readonly second: SqlDataType;
  readonly claims:
    | { readonly by: 'text'; readonly first: string; readonly second: string }
    | { readonly by: 'kind'; readonly kind: string };
}

function collisionBetween(
  first: SqlDataType,
  second: SqlDataType,
): SqlDataTypeCollision['claims'] | undefined {
  const kind = first.sql.claimsKind;
  if (kind !== undefined && kind === second.sql.claimsKind) return { by: 'kind', kind };
  for (const a of claimingTexts(first)) {
    const b = claimingTexts(second).find((text) => textsCollide(a, text));
    if (b !== undefined) return { by: 'text', first: a, second: b };
  }
  return undefined;
}

/**
 * The first two SQL data types in `types` that would both recognise one reported type: a claiming
 * text of each collides, or both claim the same kind. Two texts collide when either one's pattern
 * matches the other with each placeholder written as 1.
 */
export function findSqlDataTypeCollision(
  types: readonly DataType[],
): SqlDataTypeCollision | undefined {
  const sqlTypes = types.filter(isSqlDataType);
  for (const [index, first] of sqlTypes.entries()) {
    for (const second of sqlTypes.slice(index + 1)) {
      const claims = collisionBetween(first, second);
      if (claims !== undefined) return { first, second, claims };
    }
  }
  return undefined;
}

/**
 * The data type that claims a reported type, with its parameters in normal form, or undefined when
 * no type in `dataTypes` claims it or its parameters fail the type's schema.
 */
export function resolveReportedSqlType(
  reported: ReportedSqlType,
  dataTypes: readonly DataType[],
): ResolvedSqlType | undefined {
  const sqlTypes = dataTypes.filter(isSqlDataType);
  if (reported.kind !== undefined) {
    const claimant = sqlTypes.find((type) => type.sql.claimsKind === reported.kind);
    if (claimant === undefined) return undefined;
    return resolvedWith(claimant, claimant.sql.fromReported?.(reported) ?? {});
  }
  const text = prepareReportedText(reported.text);
  for (const type of sqlTypes) {
    for (const candidate of type.sql.texts) {
      if (!claims(candidate)) continue;
      const params = paramsMatching(type, candidate, text);
      if (params !== undefined) return resolvedWith(type, params);
    }
  }
  return undefined;
}

const signedParamKeysByType = new WeakMap<SqlDataType, readonly string[]>();

/** The parameters of `type` that may be negative, whose placeholders read a leading minus. */
function signedParamKeys(type: SqlDataType): readonly string[] {
  const known = signedParamKeysByType.get(type);
  if (known !== undefined) return known;
  const keys = schemaKeysAllowing(type.params, -1) ?? [];
  signedParamKeysByType.set(type, keys);
  return keys;
}

function paramsMatching(
  type: SqlDataType,
  candidate: SqlTypeText,
  text: string,
): SqlTypeParams | undefined {
  const match = patternOf(candidate.text, signedParamKeys(type)).exec(text);
  if (match === null) return undefined;
  return Object.fromEntries(
    placeholdersOf(candidate.text).map((name, index) => [
      name,
      Number.parseInt(match[index + 1] ?? '', 10),
    ]),
  );
}

/**
 * Every data type in `dataTypes` that reads `text` as a migration may write it, with its parameters
 * in normal form and as written: any of a type's texts counts, whether written, printed by the catalog or only
 * claimed. Empty when no type reads it or its parameters fail the type's schema. A type that claims
 * a kind has no texts, so it never reads one.
 */
export function resolveWrittenSqlTypes(
  text: string,
  dataTypes: readonly DataType[],
): readonly ResolvedWrittenSqlType[] {
  const prepared = prepareReportedText(text);
  return dataTypes.filter(isSqlDataType).flatMap((type) => {
    for (const candidate of type.sql.texts) {
      const params = paramsMatching(type, candidate, prepared);
      if (params === undefined) continue;
      const resolved = resolvedWith(type, params);
      if (resolved !== undefined) return [{ ...resolved, writtenTypeParams: params }];
    }
    return [];
  });
}

function resolvedWith(type: SqlDataType, params: SqlTypeParams): ResolvedSqlType | undefined {
  if (type.params !== undefined && type.params(params) instanceof arktype.errors) return undefined;
  return { dataType: type, typeParams: type.sql.normalize(params) };
}
