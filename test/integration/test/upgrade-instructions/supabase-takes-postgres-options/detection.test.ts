import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const guide = 'upgrade-instructions/pending/supabase-takes-postgres-options/app/instructions.md';

function detects(content: string): boolean {
  return detectionPatterns(guide, 'supabase-one-binding-input').some((pattern) =>
    pattern.test(content),
  );
}

describe('the supabase-one-binding-input detection', () => {
  it.each([
    ['an options object', 'const db = await supabase({ contract, url, pg: pool, jwtSecret });'],
    ['an options variable', 'const db = await supabase(options);'],
    ['a type argument', 'await supabase<Contract>({\n  contract,\n  url,\n})'],
    ['a spread call on a new line', 'supabase(\n  { ...config, contract },\n)'],
    [
      'an aliased import from the published package',
      "import { contractSpace, supabase as createDb } from '@prisma/orm-extension-supabase/runtime';",
    ],
    [
      'an aliased import from the workspace package',
      "import {\n  supabase as createDb,\n} from '@internal/extension-supabase/runtime';",
    ],
    ['a match on the old message', "expect(error.message).toBe('The pg option takes a pg.Pool');"],
    ['a null pg', 'postgres({ contract, pg: null })'],
    [
      'a url that falls back to null',
      "postgres({ contract, url: process.env['DATABASE_URL'] ?? null })",
    ],
    ['a binding that falls back to null', 'const options = { binding: config.binding ?? null };'],
    [
      'a url that falls back to null with ||',
      'postgres({ contract, url: env.DATABASE_URL || null })',
    ],
    [
      'a url that is null on one branch',
      'supabase({ contract, url: ready ? env.url : null, jwtSecret })',
    ],
    [
      'a url that is null on the first branch',
      'postgres({ contract, url: ready ? null : env.url })',
    ],
    ['a binding with an unknown kind', "postgres({ contract, binding: { kind: 'bogus' } })"],
    [
      'a binding with a misspelt kind on several lines',
      'postgres<Contract>({\n  contract,\n  binding: { kind: "pgpool", pool },\n})',
    ],
    [
      'a binding kind that extends a known kind',
      "postgres({ contract, binding: { kind: 'urls', url } })",
    ],
  ])('finds %s', (_name, content) => {
    expect(detects(content)).toBe(true);
  });

  it.each([
    ['a call with no arguments', 'const client = supabase();'],
    ['a method of the same name', 'factory.supabase({ contract, url })'],
    ['a longer name', 'createSupabaseClient(options); mysupabase(options);'],
    ['a name that starts with supabase', 'supabaseClient(options)'],
    ['an import', "import { supabase } from '@prisma/orm-extension-supabase/runtime';"],
    [
      'an aliased import of another export',
      "import { supabaseRuntime as runtime } from '@prisma/orm-extension-supabase/runtime';",
    ],
    [
      'an aliased import from another package',
      "import { supabase as sb } from '@supabase/supabase-js';",
    ],
    [
      'an alias to supabase of another export',
      "import { createClient as supabase } from '@prisma/orm-extension-supabase/runtime';",
    ],
    [
      'a url that falls back to a string',
      "postgres({ contract, url: env.url ?? 'postgres://localhost' })",
    ],
    ['a property whose name ends in url', 'const options = { imageUrl: null };'],
    ['a member access named pg', 'const pool = config.pg ?? null;'],
    [
      'a url that falls back to a string with ||',
      "postgres({ contract, url: env.url || 'postgres://localhost' })",
    ],
    [
      'a conditional url with no null branch',
      'postgres({ contract, url: ready ? env.url : fallback })',
    ],
    ['a url binding', "postgres({ contract, binding: { kind: 'url', url } })"],
    ['a pgPool binding', 'postgres({ contract, binding: { kind: "pgPool", pool } })'],
    ['a pgClient binding', "postgres({\n  contract,\n  binding: { kind: 'pgClient', client },\n})"],
    ['an unknown kind outside a client call', "const binding = { kind: 'bogus' };"],
    ['a kind on another option', "postgres({ contract, cursor: { kind: 'bogus' } })"],
  ])('skips %s', (_name, content) => {
    expect(detects(content)).toBe(false);
  });
});
