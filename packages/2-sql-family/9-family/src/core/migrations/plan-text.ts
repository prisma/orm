import {
  type FieldCoordinate,
  type ModelCoordinate,
  modelDisplayName,
} from '@internal/framework-components/control';

/** Joins items into text: "a", "a and b", "a, b and c". */
export function joinedList(items: readonly string[]): string {
  return items.length === 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function fieldDisplayName(field: FieldCoordinate): string {
  return `${modelDisplayName(field)}.${field.field}`;
}

function namedList(noun: string, names: readonly string[]): string {
  return `${noun}${names.length === 1 ? '' : 's'} ${joinedList(names.map((name) => `"${name}"`))}`;
}

export function modelsText(models: readonly ModelCoordinate[]): string {
  return namedList('model', models.map(modelDisplayName));
}

export function fieldsText(fields: readonly FieldCoordinate[]): string {
  return namedList('field', fields.map(fieldDisplayName));
}

export function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
