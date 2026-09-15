import pluralizeLib from 'pluralize';

export function pluralize(word: string): string {
  return pluralizeLib.plural(word);
}

export function deriveBackRelationFieldName(childModelName: string, isOneToOne: boolean): string {
  const base = childModelName.charAt(0).toLowerCase() + childModelName.slice(1);
  return isOneToOne ? base : pluralize(base);
}
