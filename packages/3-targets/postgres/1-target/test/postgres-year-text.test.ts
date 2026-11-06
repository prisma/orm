import { describe, expect, it } from 'vitest';
import { isoYearText, postgresYearText } from '../src/core/postgres-year-text';

describe('postgresYearText', () => {
  it.each([
    ['-004713-11-24', '4714-11-24 BC'],
    ['-000043-03-15', '0044-03-15 BC'],
    ['0000-01-01', '0001-01-01 BC'],
    ['0001-01-01', '0001-01-01'],
    ['9999-12-31', '9999-12-31'],
    ['+010000-01-01', '10000-01-01'],
    ['+275760-09-13', '275760-09-13'],
    ['+5874897-12-31', '5874897-12-31'],
    ['-000043-03-15T12:00:00', '0044-03-15T12:00:00 BC'],
    ['-000043-03-15T12:00:00.000Z', '0044-03-15T12:00:00.000Z BC'],
    ['+010000-01-01T00:00:00Z', '10000-01-01T00:00:00Z'],
    ['+002024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'],
  ])('writes %s as %s', (iso, postgres) => {
    expect(postgresYearText(iso)).toBe(postgres);
  });

  it.each(['12:34:56', '12:34:56+02:00', 'P1Y', 'infinity', '-infinity'])(
    'leaves %s, which has no year, as it is',
    (text) => {
      expect(postgresYearText(text)).toBe(text);
    },
  );
});

describe('isoYearText', () => {
  it.each([
    ['4714-11-24 BC', '-004713-11-24'],
    ['0044-03-15 BC', '-000043-03-15'],
    ['0001-01-01 BC', '0000-01-01'],
    ['0001-01-01', '0001-01-01'],
    ['9999-12-31', '9999-12-31'],
    ['10000-01-01', '+010000-01-01'],
    ['275760-09-13', '+275760-09-13'],
    ['0044-03-15 12:00:00 BC', '-000043-03-15 12:00:00'],
    ['0044-03-15 12:00:00+00 BC', '-000043-03-15 12:00:00+00'],
    ['0044-03-15T12:00:00.000Z BC', '-000043-03-15T12:00:00.000Z'],
  ])('reads %s as %s', (postgres, iso) => {
    expect(isoYearText(postgres)).toBe(iso);
  });

  it.each([
    '-004713-11-24',
    '+010000-01-01',
    '2024-01-01T00:00:00Z',
    '12:34:56',
    'infinity',
    '-infinity',
    '0000-01-01 BC',
  ])('leaves %s as it is', (text) => {
    expect(isoYearText(text)).toBe(text);
  });

  it.each([
    '-004713-11-24',
    '-000043-03-15',
    '0000-01-01',
    '0001-01-01',
    '9999-12-31',
    '+010000-01-01',
    '+275760-09-13',
    '-000043-03-15T12:00:00.5Z',
  ])('reads back what postgresYearText writes for %s', (iso) => {
    expect(isoYearText(postgresYearText(iso))).toBe(iso);
  });
});
