import { describe, expect, it } from 'vitest';
import { canonicalUuid } from '../src/core/codec-helpers';

describe('canonicalUuid', () => {
  it.each([
    ['lower case, hyphenated 8-4-4-4-12', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
    ['upper case', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'],
    ['mixed case', 'A0eeBC99-9c0B-4EF8-bb6d-6BB9bd380A11'],
    ['in braces', '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}'],
    ['without hyphens', 'a0eebc999c0b4ef8bb6d6bb9bd380a11'],
    ['with a hyphen after every four digits', 'a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11'],
    ['upper case in braces, grouped by eights', '{A0EEBC99-9C0B4EF8-BB6D6BB9-BD380A11}'],
  ])('writes a uuid spelled %s as Postgres prints it', (_spelling, text) => {
    expect(canonicalUuid(text)).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });

  it.each([
    ['text that is not a uuid', 'Not-A-Uuid'],
    ['one digit short', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A1'],
    ['one digit too many', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A111'],
    ['a hyphen inside a group of four', 'A0E-EBC99-9C0B-4EF8-BB6D-6BB9BD380A11'],
    ['two hyphens in a row', 'A0EEBC99--9C0B-4EF8-BB6D-6BB9BD380A11'],
    ['a trailing hyphen', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11-'],
    ['an opening brace without a closing one', '{A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'],
    ['a closing brace without an opening one', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11}'],
    ['surrounding spaces', ' A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11 '],
    ['a letter past f', 'G0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'],
  ])('returns nothing for %s, because Postgres does not read it as a uuid', (_case, text) => {
    expect(canonicalUuid(text)).toBeUndefined();
  });
});
