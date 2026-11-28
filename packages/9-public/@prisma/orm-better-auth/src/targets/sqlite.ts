import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@prisma/orm-framework/contract/default-namespace';
import type { TargetSupport } from '../target-support';
import { standardPslType } from './standard-psl-type';
import { compareTextBySubstring } from './substring-text';
import { sqlFamilyCodecKinds, valueKindOf } from './value-kinds';

const valueKind = valueKindOf(sqlFamilyCodecKinds, {
  string: ['sqlite/text@1'],
  date: ['sqlite/datetime@1'],
  number: ['sqlite/integer@1', 'sqlite/real@1', 'sqlite/bigintnumber@1'],
  boolean: ['sqlite/boolean@1'],
  json: ['sqlite/json@1'],
  other: [
    'sqlite/bigint@1',
    'sqlite/decimal@1',
    'sqlite/datetime-temporal@1',
    'sqlite/datetime-string@1',
    'sqlite/date-string@1',
    'sqlite/date-temporal@1',
    'sqlite/time-string@1',
    'sqlite/time-temporal@1',
    'sqlite/duration-string@1',
    'sqlite/blob@1',
  ],
});

export const sqliteSupport: TargetSupport = {
  target: 'sqlite',
  valueKind,
  compareText: compareTextBySubstring,
  defaultNamespace: UNBOUND_DOMAIN_NAMESPACE_ID,
  pslType: standardPslType,
};
