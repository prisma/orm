import { describe, expect, it } from 'vitest';
import { sessionSettingsStatement } from '../src/core/session-settings';

describe('sessionSettingsStatement', () => {
  it('sets every setting in one statement, each name quoted and each value a parameter', () => {
    expect({
      none: sessionSettingsStatement({}),
      settings: sessionSettingsStatement({ time_zone: '+00:00', 'odd`name': "it's" }),
    }).toEqual({
      none: undefined,
      settings: { sql: 'SET SESSION `time_zone` = ?, `odd``name` = ?', values: ['+00:00', "it's"] },
    });
  });

  it('sends a value of decimal integer text as a number, because MySQL refuses text for an integer variable', () => {
    expect(
      sessionSettingsStatement({ a: '5', b: '-12', c: '05x', d: '1.5', e: '' })?.values,
    ).toEqual([5n, -12n, '05x', '1.5', '']);
  });
});
