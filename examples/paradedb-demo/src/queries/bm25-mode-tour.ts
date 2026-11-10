import { db } from '../prisma/db';

export async function bm25ModeTour() {
  const cases = [
    {
      label: "matchAny 'with cooling'",
      note: "tokenized OR — items with 'with' OR 'cooling'",
      run: () =>
        db.query(
          db.sql.public.item
            .select('id', 'description')
            .where((f, fns) => fns.paradeDbMatchAny(f.description, 'with cooling'))
            .build(),
        ),
    },
    {
      label: "matchAll 'with cooling'",
      note: "tokenized AND — items with 'with' AND 'cooling' (any order)",
      run: () =>
        db.query(
          db.sql.public.item
            .select('id', 'description')
            .where((f, fns) => fns.paradeDbMatchAll(f.description, 'with cooling'))
            .build(),
        ),
    },
    {
      label: "phrase 'cooling fan'",
      note: 'exact ordered, consecutive — adjacent tokens',
      run: () =>
        db.query(
          db.sql.public.item
            .select('id', 'description')
            .where((f, fns) => fns.paradeDbPhrase(f.description, 'cooling fan'))
            .build(),
        ),
    },
    {
      label: "phrase 'fan cooling'",
      note: 'same tokens reversed — fails because phrase is order-sensitive',
      run: () =>
        db.query(
          db.sql.public.item
            .select('id', 'description')
            .where((f, fns) => fns.paradeDbPhrase(f.description, 'fan cooling'))
            .build(),
        ),
    },
    {
      label: "matchAll 'shoes running'",
      note: 'AND ignores order — both tokens present, anywhere',
      run: () =>
        db.query(
          db.sql.public.item
            .select('id', 'description')
            .where((f, fns) => fns.paradeDbMatchAll(f.description, 'shoes running'))
            .build(),
        ),
    },
    {
      label: "phrase 'shoes running'",
      note: "same tokens — phrase requires the original 'running shoes' order",
      run: () =>
        db.query(
          db.sql.public.item
            .select('id', 'description')
            .where((f, fns) => fns.paradeDbPhrase(f.description, 'shoes running'))
            .build(),
        ),
    },
    {
      label: "term 'wireless'",
      note: 'exact indexed token — finds the literal post-tokenizer term',
      run: () =>
        db.query(
          db.sql.public.item
            .select('id', 'description')
            .where((f, fns) => fns.paradeDbTerm(f.description, 'wireless'))
            .build(),
        ),
    },
    {
      label: "term 'wireless mechanical'",
      note: 'multi-word string — never an indexed token, so empty',
      run: () =>
        db.query(
          db.sql.public.item
            .select('id', 'description')
            .where((f, fns) => fns.paradeDbTerm(f.description, 'wireless mechanical'))
            .build(),
        ),
    },
  ];

  const results: Array<{
    label: string;
    note: string;
    matches: ReadonlyArray<{ id: number; description: string }>;
  }> = [];
  for (const c of cases) {
    const rows = await c.run();
    results.push({
      label: c.label,
      note: c.note,
      matches: rows.map((r) => ({ id: r.id, description: r.description })),
    });
  }
  return results;
}
