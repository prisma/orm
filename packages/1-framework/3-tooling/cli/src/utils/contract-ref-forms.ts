import {
  EMPTY_CONTRACT_REF,
  RESERVED_CONTRACT_REFS,
} from '@internal/migration-tools/ref-resolution';

const RECORDED_FORMS = ['hash', 'prefix', 'ref name', 'migration dir name', '<dir>^'] as const;

function listForms(forms: readonly string[]): string {
  return `${forms.slice(0, -1).join(', ')}, or ${forms.at(-1)}`;
}

/** The forms that name a contract recorded in the migrations directory. */
export const RECORDED_CONTRACT_REF_FORMS = listForms(RECORDED_FORMS);

/** The recorded forms plus `@empty`. */
export const RECORDED_OR_EMPTY_CONTRACT_REF_FORMS = listForms([
  ...RECORDED_FORMS,
  EMPTY_CONTRACT_REF,
]);

/** The recorded forms plus every reserved token. */
export const ALL_CONTRACT_REF_FORMS = listForms([...RECORDED_FORMS, ...RESERVED_CONTRACT_REFS]);
