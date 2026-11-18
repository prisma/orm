import { describe, expect, it } from 'vitest';
import { targetFromProviderName } from '../../../src/commands/init/input-values';

describe('targetFromProviderName', () => {
  it.each([
    ['postgresql', 'postgres'],
    ['postgres', 'postgres'],
    ['mongodb', 'mongo'],
    ['sqlite', undefined],
    ['PostgreSQL', undefined],
  ])('maps the datasource provider %s to %s', (provider, target) => {
    expect(targetFromProviderName(provider)).toBe(target);
  });
});
