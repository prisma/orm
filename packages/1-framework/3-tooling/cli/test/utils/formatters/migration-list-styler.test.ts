import { bold, createColors, cyan, cyanBright, dim, green, yellow } from 'colorette';
import { describe, expect, it } from 'vitest';
import {
  renderMigrationList,
  renderMigrationListWithStyle,
} from '../../../src/utils/formatters/migration-list-render';
import { createAnsiMigrationListStyler } from '../../../src/utils/formatters/migration-list-styler';
import type {
  MigrationListEntry,
  MigrationListResult,
  MigrationSpaceListEntry,
} from '../../../src/utils/formatters/migration-list-types';

const HASH_C = '4cb4256c30b7a8123456789012345678901234567890123456';
const HASH_D = '55bada2f123456789012345678901234567890123456789012';

let migrationHashSeq = 0;

function migration(
  overrides: Pick<MigrationListEntry, 'name' | 'toContract'> &
    Partial<Omit<MigrationListEntry, 'name' | 'toContract'>>,
): MigrationListEntry {
  return {
    hash: overrides.hash ?? `styler-mig-${migrationHashSeq++}`,
    fromContract: null,
    operationCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    refs: [],
    providedInvariants: [],
    ...overrides,
  };
}

function result(spaces: readonly MigrationSpaceListEntry[], summary: string): MigrationListResult {
  return { ok: true, spaces: [...spaces], summary };
}

describe('createAnsiMigrationListStyler', () => {
  it('returns an identity styler when useColor is false (suppresses ANSI for non-TTY / --no-color)', () => {
    const styler = createAnsiMigrationListStyler({ useColor: false });
    expect(styler.kind('*')).toBe('*');
    expect(styler.kind('↩')).toBe('↩');
    expect(styler.kind('⟲')).toBe('⟲');
    expect(styler.dirName('20260422T0720_initial')).toBe('20260422T0720_initial');
    expect(styler.sourceHash('4cb4256')).toBe('4cb4256');
    expect(styler.destHash('55bada2')).toBe('55bada2');
    expect(styler.glyph('→')).toBe('→');
    expect(styler.glyph('⟲')).toBe('⟲');
    expect(styler.glyph('∅')).toBe('∅');
    expect(styler.lane('│')).toBe('│');
    expect(styler.lane('├─┐')).toBe('├─┐');
    expect(styler.invariants(['a', 'b'])).toBe('{a, b}');
    expect(styler.refs(['production', 'staging'])).toBe('(production, staging)');
    expect(styler.refs(['db'])).toBe('(db)');
    expect(styler.spaceHeading('app:')).toBe('app:');
    expect(styler.summary('1 migration(s) on disk')).toBe('1 migration(s) on disk');
    expect(styler.emptyState('There are no migrations in migrations/app/ yet')).toBe(
      'There are no migrations in migrations/app/ yet',
    );
  });

  it('renders an identity-equivalent output when wired through renderMigrationListWithStyle', () => {
    const r = result(
      [
        {
          space: 'app',
          migrations: [
            migration({
              name: '20260422T0720_initial',
              fromContract: null,
              toContract: HASH_C,
            }),
          ],
        },
      ],
      '1 migration(s) on disk',
    );
    const styled = renderMigrationListWithStyle(
      r,
      createAnsiMigrationListStyler({ useColor: false }),
    );
    expect(styled).toBe(renderMigrationList(r));
  });

  it('wraps each token with the expected SGR style when useColor is true', () => {
    const styler = createAnsiMigrationListStyler({ useColor: true });
    expect(styler.kind('*')).toBe('*');
    expect(styler.kind('↩')).toBe('↩');
    expect(styler.kind('⟲')).toBe('⟲');
    expect(styler.dirName('20260422T0720_initial')).toBe(bold('20260422T0720_initial'));
    expect(styler.sourceHash('4cb4256')).toBe(dim(cyan('4cb4256')));
    expect(styler.destHash('55bada2')).toBe(cyanBright('55bada2'));
    expect(styler.glyph('→')).toBe(dim('→'));
    expect(styler.glyph('⟲')).toBe(dim('⟲'));
    expect(styler.glyph('∅')).toBe(dim('∅'));
    expect(styler.lane('│')).toBe(dim('│'));
    expect(styler.lane('├─┐')).toBe(dim('├─┐'));
    expect(styler.invariants(['backfill_emails_v1'])).toBe(yellow('{backfill_emails_v1}'));
    expect(styler.spaceHeading('app:')).toBe(bold('app:'));
    expect(styler.summary('1 migration(s) on disk')).toBe(dim('1 migration(s) on disk'));
    expect(styler.emptyState('There are no migrations in migrations/app/ yet')).toBe(
      dim('There are no migrations in migrations/app/ yet'),
    );
  });

  it('renders system markers with @-sigil and user refs in parentheses', () => {
    const styler = createAnsiMigrationListStyler({ useColor: true });
    expect(styler.markers(['contract'])).toBe(green('@') + bold(green('contract')));
    expect(styler.markers(['db'])).toBe(green('@') + green('db'));
    expect(styler.markers(['contract', 'db'])).toBe(
      green('@') + bold(green('contract')) + ' ' + green('@') + green('db'),
    );
    expect(styler.refs(['production'])).toBe(green('(') + green('production') + green(')'));
    expect(styler.refs(['production', 'staging'])).toBe(
      green('(') + [green('production'), green('staging')].join(green(', ')) + green(')'),
    );
  });

  it('bolds the active user ref when the tree styler overrides refs', () => {
    const base = createAnsiMigrationListStyler({ useColor: true });
    const activeRefName = 'production';
    const styler = {
      ...base,
      refs: (names: readonly string[]) => {
        const styledNames = names.map((name) => (name === activeRefName ? bold(name) : name));
        return base.refs(styledNames);
      },
    };
    expect(styler.refs(['production'])).toBe(green('(') + bold(green('production')) + green(')'));
  });
});

describe('renderMigrationListWithStyle', () => {
  it('places SGR codes around the expected tokens in a self-edge worked example', () => {
    const r = result(
      [
        {
          space: 'app',
          migrations: [
            migration({
              name: '20260601T1200_backfill_emails',
              fromContract: HASH_D,
              toContract: HASH_D,
              providedInvariants: ['backfill_emails_v1'],
              refs: ['production', 'db'],
            }),
          ],
        },
      ],
      '1 migration(s) on disk',
    );
    const styled = renderMigrationListWithStyle(
      r,
      createAnsiMigrationListStyler({ useColor: true }),
      'unicode',
      { colorize: true },
    );
    expect(styled).toContain(bold('20260601T1200_backfill_emails'));
    expect(styled).toContain(dim(cyan('55bada2')));
    expect(styled).toContain(yellow('{backfill_emails_v1}'));
    expect(styled).toContain(green('production'));
    expect(styled).toContain(green('db'));
    expect(styled).toContain(dim('1 migration(s) on disk'));
    // The graph gutter is drawn by the corner renderer, which forces colour and
    // tints each lane-0 glyph white (lane N → colour N+1). The self-edge row is
    // a white │ rail + white ⟲ self-loop marker.
    const forced = createColors({ useColor: true });
    expect(styled).toContain(`${forced.white('│')}${forced.white('⟲')}`);
    expect(styled).toContain('1 ops');
  });

  it('styles the cross-space heading and per-space rows with the correct palette', () => {
    const r = result(
      [
        {
          space: 'app',
          migrations: [
            migration({
              name: '20260422T0720_initial',
              fromContract: null,
              toContract: HASH_C,
            }),
          ],
        },
        {
          space: 'postgis',
          migrations: [],
        },
      ],
      '1 migration(s) across 2 contract space(s)',
    );
    const styled = renderMigrationListWithStyle(
      r,
      createAnsiMigrationListStyler({ useColor: true }),
      'unicode',
      { colorize: true },
    );
    expect(styled).toContain(bold('app:'));
    expect(styled).toContain(bold('postgis:'));
    expect(styled).toContain(dim('∅'));
    expect(styled).toContain(cyanBright('4cb4256'));
    expect(styled).toContain(dim('→'));
    expect(styled).toContain(dim('1 migration(s) across 2 contract space(s)'));
    expect(styled).toContain(dim('There are no migrations in migrations/postgis/ yet'));
  });

  it('preserves visual column widths (padding is unstyled spaces)', () => {
    const r = result(
      [
        {
          space: 'app',
          migrations: [
            migration({
              name: '20260422T0720_initial',
              fromContract: null,
              toContract: HASH_C,
            }),
            migration({
              name: '20260601T1200_latest',
              fromContract: HASH_C,
              toContract: HASH_D,
            }),
          ],
        },
      ],
      '2 migration(s) on disk',
    );
    const plain = renderMigrationList(r);
    const styled = renderMigrationListWithStyle(
      r,
      createAnsiMigrationListStyler({ useColor: true }),
      'unicode',
      { colorize: true },
    );

    function stripAnsi(s: string): string {
      return s.replace(
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI SGR sequences
        /\u001b\[[0-9;]*m/g,
        '',
      );
    }
    expect(stripAnsi(styled)).toBe(plain);
  });
});
