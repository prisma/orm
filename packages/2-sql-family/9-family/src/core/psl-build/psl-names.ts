const PSL_RESERVED_WORDS = new Set(['model', 'enum', 'types', 'type', 'generator', 'datasource']);

const IDENTIFIER_PART_PATTERN = /[A-Za-z0-9]+/g;

export function hasSeparators(input: string): boolean {
  return /[^A-Za-z0-9]/.test(input);
}

function extractIdentifierParts(input: string): string[] {
  return input.match(IDENTIFIER_PART_PATTERN) ?? [];
}

function createSyntheticIdentifier(input: string): string {
  let hash = 2166136261;

  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return `x${(hash >>> 0).toString(16)}`;
}

function sanitizeIdentifierCharacters(input: string): string {
  const sanitized = input.replace(/[^\w]/g, '');
  return sanitized.length > 0 ? sanitized : createSyntheticIdentifier(input);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function snakeToPascalCase(input: string): string {
  const parts = extractIdentifierParts(input);
  if (parts.length === 0) {
    return capitalize(sanitizeIdentifierCharacters(input));
  }
  return parts.map(capitalize).join('');
}

export function snakeToCamelCase(input: string): string {
  const parts = extractIdentifierParts(input);
  if (parts.length === 0) {
    return sanitizeIdentifierCharacters(input);
  }
  const [firstPart = input, ...rest] = parts;
  return firstPart.charAt(0).toLowerCase() + firstPart.slice(1) + rest.map(capitalize).join('');
}

export function needsEscaping(name: string): boolean {
  return PSL_RESERVED_WORDS.has(name.toLowerCase()) || /^\d/.test(name);
}

export function escapeName(name: string): string {
  return `_${name}`;
}

export function escapeIfNeeded(name: string): string {
  return needsEscaping(name) ? escapeName(name) : name;
}

const VALID_IDENTIFIER_PATTERN = /^[A-Za-z_]\w*$/;

/**
 * PSL member name for a native-enum value. The value itself always prints
 * explicitly (`member = "value"`), so the returned name never needs a map:
 * a value that already is a valid, non-reserved identifier is kept verbatim
 * (case included); anything else is camelCased/escaped like a field name.
 */
export function toEnumMemberName(value: string): string {
  if (VALID_IDENTIFIER_PATTERN.test(value) && !needsEscaping(value)) {
    return value;
  }
  return escapeIfNeeded(snakeToCamelCase(value));
}
