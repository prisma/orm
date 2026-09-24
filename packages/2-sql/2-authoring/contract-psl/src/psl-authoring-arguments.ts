import type { AuthoringArgumentDescriptor } from '@internal/framework-components/authoring';
import type {
  DiagnosticSource,
  PslDiagnosticCollector,
  PslSpan,
  ResolvedAttributeArg,
} from '@internal/psl-parser';
import { unquoteStringLiteral } from './psl-attribute-parsing';

const INVALID_AUTHORING_ARGUMENT = Symbol('invalidAuthoringArgument');

type ParsedPslLiteral =
  | string
  | number
  | boolean
  | null
  | ParsedPslLiteral[]
  | { [key: string]: ParsedPslLiteral };

function isIdentifierStartCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_$]/.test(character);
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function parseJsLikeLiteral(value: string): ParsedPslLiteral | typeof INVALID_AUTHORING_ARGUMENT {
  let index = 0;

  function skipWhitespace() {
    while (/\s/.test(value[index] ?? '')) {
      index += 1;
    }
  }

  function parseIdentifier(): string | typeof INVALID_AUTHORING_ARGUMENT {
    const first = value[index];
    if (!isIdentifierStartCharacter(first)) {
      return INVALID_AUTHORING_ARGUMENT;
    }

    let end = index + 1;
    while (isIdentifierCharacter(value[end])) {
      end += 1;
    }

    const identifier = value.slice(index, end);
    index = end;
    return identifier;
  }

  function parseString(): string | typeof INVALID_AUTHORING_ARGUMENT {
    const quote = value[index];
    if (quote !== '"' && quote !== "'") {
      return INVALID_AUTHORING_ARGUMENT;
    }

    index += 1;
    let result = '';

    while (index < value.length) {
      const character = value[index];
      index += 1;

      if (character === undefined) {
        return INVALID_AUTHORING_ARGUMENT;
      }

      if (character === quote) {
        return result;
      }

      if (character !== '\\') {
        result += character;
        continue;
      }

      const escaped = value[index];
      index += 1;

      if (escaped === undefined) {
        return INVALID_AUTHORING_ARGUMENT;
      }

      switch (escaped) {
        case "'":
        case '"':
        case '\\':
        case '/':
          result += escaped;
          break;
        case 'b':
          result += '\b';
          break;
        case 'f':
          result += '\f';
          break;
        case 'n':
          result += '\n';
          break;
        case 'r':
          result += '\r';
          break;
        case 't':
          result += '\t';
          break;
        case 'u': {
          const hex = value.slice(index, index + 4);
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
            return INVALID_AUTHORING_ARGUMENT;
          }
          result += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
          break;
        }
        default:
          return INVALID_AUTHORING_ARGUMENT;
      }
    }

    return INVALID_AUTHORING_ARGUMENT;
  }

  function parseNumber(): number | typeof INVALID_AUTHORING_ARGUMENT {
    const match = value.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    const raw = match?.[0];
    if (!raw) {
      return INVALID_AUTHORING_ARGUMENT;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return INVALID_AUTHORING_ARGUMENT;
    }

    index += raw.length;
    return parsed;
  }

  function parseArray(): ParsedPslLiteral[] | typeof INVALID_AUTHORING_ARGUMENT {
    if (value[index] !== '[') {
      return INVALID_AUTHORING_ARGUMENT;
    }

    index += 1;
    const result: ParsedPslLiteral[] = [];

    skipWhitespace();
    if (value[index] === ']') {
      index += 1;
      return result;
    }

    while (index < value.length) {
      const entry = parseValue();
      if (entry === INVALID_AUTHORING_ARGUMENT) {
        return INVALID_AUTHORING_ARGUMENT;
      }
      result.push(entry);

      skipWhitespace();
      if (value[index] === ',') {
        index += 1;
        skipWhitespace();
        continue;
      }
      if (value[index] === ']') {
        index += 1;
        return result;
      }
      return INVALID_AUTHORING_ARGUMENT;
    }

    return INVALID_AUTHORING_ARGUMENT;
  }

  function parseObject(): { [key: string]: ParsedPslLiteral } | typeof INVALID_AUTHORING_ARGUMENT {
    if (value[index] !== '{') {
      return INVALID_AUTHORING_ARGUMENT;
    }

    index += 1;
    const result: { [key: string]: ParsedPslLiteral } = {};

    skipWhitespace();
    if (value[index] === '}') {
      index += 1;
      return result;
    }

    while (index < value.length) {
      skipWhitespace();
      const key = value[index] === '"' || value[index] === "'" ? parseString() : parseIdentifier();
      if (key === INVALID_AUTHORING_ARGUMENT) {
        return INVALID_AUTHORING_ARGUMENT;
      }

      skipWhitespace();
      if (value[index] !== ':') {
        return INVALID_AUTHORING_ARGUMENT;
      }

      index += 1;
      const entry = parseValue();
      if (entry === INVALID_AUTHORING_ARGUMENT) {
        return INVALID_AUTHORING_ARGUMENT;
      }
      result[key] = entry;

      skipWhitespace();
      if (value[index] === ',') {
        index += 1;
        skipWhitespace();
        continue;
      }
      if (value[index] === '}') {
        index += 1;
        return result;
      }
      return INVALID_AUTHORING_ARGUMENT;
    }

    return INVALID_AUTHORING_ARGUMENT;
  }

  function parseValue(): ParsedPslLiteral | typeof INVALID_AUTHORING_ARGUMENT {
    skipWhitespace();
    const character = value[index];
    if (character === '{') {
      return parseObject();
    }
    if (character === '[') {
      return parseArray();
    }
    if (character === '"' || character === "'") {
      return parseString();
    }
    if (character === '-' || /\d/.test(character ?? '')) {
      return parseNumber();
    }

    const identifier = parseIdentifier();
    if (identifier === INVALID_AUTHORING_ARGUMENT) {
      return INVALID_AUTHORING_ARGUMENT;
    }
    if (identifier === 'true') {
      return true;
    }
    if (identifier === 'false') {
      return false;
    }
    if (identifier === 'null') {
      return null;
    }
    return INVALID_AUTHORING_ARGUMENT;
  }

  skipWhitespace();
  const parsed = parseValue();
  if (parsed === INVALID_AUTHORING_ARGUMENT) {
    return parsed;
  }

  skipWhitespace();
  return index === value.length ? parsed : INVALID_AUTHORING_ARGUMENT;
}

function parseStringArrayLiteral(
  value: string,
): readonly string[] | typeof INVALID_AUTHORING_ARGUMENT {
  const parsed = parseJsLikeLiteral(value);
  if (parsed === INVALID_AUTHORING_ARGUMENT || !Array.isArray(parsed)) {
    return INVALID_AUTHORING_ARGUMENT;
  }
  if (!parsed.every((item): item is string => typeof item === 'string')) {
    return INVALID_AUTHORING_ARGUMENT;
  }
  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePslObjectLiteral(
  value: string,
): Record<string, unknown> | typeof INVALID_AUTHORING_ARGUMENT {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return INVALID_AUTHORING_ARGUMENT;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = parseJsLikeLiteral(trimmed);
    if (parsed === INVALID_AUTHORING_ARGUMENT) {
      return INVALID_AUTHORING_ARGUMENT;
    }
  }

  if (!isPlainObject(parsed)) {
    return INVALID_AUTHORING_ARGUMENT;
  }

  return parsed;
}

function parsePslAuthoringArgumentValue(
  descriptor: AuthoringArgumentDescriptor,
  rawValue: string,
): unknown | typeof INVALID_AUTHORING_ARGUMENT {
  switch (descriptor.kind) {
    case 'string':
      return unquoteStringLiteral(rawValue);
    case 'boolean': {
      const trimmed = rawValue.trim();
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
      return INVALID_AUTHORING_ARGUMENT;
    }
    case 'number': {
      const parsed = Number(unquoteStringLiteral(rawValue));
      return Number.isNaN(parsed) ? INVALID_AUTHORING_ARGUMENT : parsed;
    }
    case 'stringArray':
      return parseStringArrayLiteral(rawValue);
    case 'object':
      return parsePslObjectLiteral(rawValue);
    case 'option': {
      const trimmed = rawValue.trim();
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : INVALID_AUTHORING_ARGUMENT;
    }
    default: {
      const _exhaustive: never = descriptor;
      void _exhaustive;
      return INVALID_AUTHORING_ARGUMENT;
    }
  }
}

function pushInvalidPslHelperArgument(input: {
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
  readonly entityLabel: string;
  readonly helperLabel: string;
  readonly message: string;
}): undefined {
  input.diagnostics.push({
    code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
    message: `${input.entityLabel} ${input.helperLabel} ${input.message}`,
    ...input.source.at(input.span),
  });
  return undefined;
}

export function mapPslHelperArgs(input: {
  readonly args: readonly ResolvedAttributeArg[];
  readonly descriptors: readonly AuthoringArgumentDescriptor[];
  readonly helperLabel: string;
  readonly span: PslSpan;
  readonly diagnostics: PslDiagnosticCollector;
  readonly source: DiagnosticSource;
  readonly entityLabel: string;
}): readonly unknown[] | undefined {
  const mappedArgs: unknown[] = input.descriptors.map(() => undefined);

  const positionalArgs = input.args.filter((arg) => arg.kind === 'positional');
  const namedArgs = input.args.filter((arg) => arg.kind === 'named');

  if (positionalArgs.length > input.descriptors.length) {
    return pushInvalidPslHelperArgument({
      diagnostics: input.diagnostics,
      source: input.source,
      span: input.span,
      entityLabel: input.entityLabel,
      helperLabel: input.helperLabel,
      message: `accepts at most ${input.descriptors.length} argument(s), received ${positionalArgs.length}.`,
    });
  }

  for (const [index, argument] of positionalArgs.entries()) {
    const descriptor = input.descriptors[index];
    if (!descriptor) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        source: input.source,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `does not define positional argument #${index + 1}.`,
      });
    }

    const value = parsePslAuthoringArgumentValue(descriptor, argument.value);
    if (value === INVALID_AUTHORING_ARGUMENT) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        source: input.source,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `cannot parse argument #${index + 1} for descriptor kind "${descriptor.kind}".`,
      });
    }

    mappedArgs[index] = value;
  }

  for (const argument of namedArgs) {
    const descriptorIndex = input.descriptors.findIndex(
      (descriptor) => descriptor.name === argument.name,
    );
    if (descriptorIndex < 0) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        source: input.source,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `received unknown named argument "${argument.name}".`,
      });
    }

    if (mappedArgs[descriptorIndex] !== undefined) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        source: input.source,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `received duplicate value for argument "${argument.name}".`,
      });
    }

    const descriptor = input.descriptors[descriptorIndex];
    if (!descriptor) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        source: input.source,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `does not define named argument "${argument.name}".`,
      });
    }

    const value = parsePslAuthoringArgumentValue(descriptor, argument.value);
    if (value === INVALID_AUTHORING_ARGUMENT) {
      return pushInvalidPslHelperArgument({
        diagnostics: input.diagnostics,
        source: input.source,
        span: argument.span,
        entityLabel: input.entityLabel,
        helperLabel: input.helperLabel,
        message: `cannot parse named argument "${argument.name}" for descriptor kind "${descriptor.kind}".`,
      });
    }

    mappedArgs[descriptorIndex] = value;
  }

  return mappedArgs;
}
