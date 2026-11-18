/** The weights Postgres's `setweight` takes, strongest first. Each weight group takes the next one. */
export const FULL_TEXT_WEIGHTS = ['A', 'B', 'C', 'D'] as const;

/** Fields in order of weight: each inner list is one weight group. */
export type FullTextWeightGroups<Field> = readonly (readonly Field[])[];

/**
 * How an author lists the fields of a full-text index: one field, or a list whose items are fields
 * or lists of fields. Each top-level item is one weight group, strongest first.
 */
export type FullTextFieldsInput<Field> = Field | readonly (Field | readonly Field[])[];

export function weightGroupsOf<Field>(
  fields: FullTextFieldsInput<Field>,
  isField: (value: unknown) => value is Field,
): FullTextWeightGroups<Field> {
  if (isField(fields)) return [[fields]];
  return fields.map((item) => (isField(item) ? [item] : item));
}
