import {
  EMPTY_CONTRACT_REF,
  LIVE_MARKER_REF,
  WORKING_CONTRACT_REF,
} from '@internal/migration-tools/ref-resolution';

const ON_DISK_FORMS = ['hash', 'prefix', 'ref name', 'migration dir name', '<dir>^'] as const;

function listForms(forms: readonly string[]): string {
  return `${forms.slice(0, -1).join(', ')}, or ${forms.at(-1)}`;
}

/** The forms that name a contract on disk. */
export const ON_DISK_CONTRACT_REF_FORMS = listForms(ON_DISK_FORMS);

/** The on-disk forms plus `@empty`. */
export const ON_DISK_OR_EMPTY_CONTRACT_REF_FORMS = listForms([
  ...ON_DISK_FORMS,
  EMPTY_CONTRACT_REF,
]);

/** The on-disk forms plus every reserved token. */
export const ALL_CONTRACT_REF_FORMS = listForms([
  ...ON_DISK_FORMS,
  WORKING_CONTRACT_REF,
  LIVE_MARKER_REF,
  EMPTY_CONTRACT_REF,
]);
