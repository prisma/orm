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
    ['a match on the old message', "expect(error.message).toBe('The pg option takes a pg.Pool');"],
  ])('finds %s', (_name, content) => {
    expect(detects(content)).toBe(true);
  });

  it.each([
    ['a call with no arguments', 'const client = supabase();'],
    ['a method of the same name', 'factory.supabase({ contract, url })'],
    ['a longer name', 'createSupabaseClient(options); mysupabase(options);'],
    ['a name that starts with supabase', 'supabaseClient(options)'],
    ['an import', "import { supabase } from '@prisma/orm-extension-supabase/runtime';"],
  ])('skips %s', (_name, content) => {
    expect(detects(content)).toBe(false);
  });
});
