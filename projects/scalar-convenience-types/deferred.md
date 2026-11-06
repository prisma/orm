# Deferred

- **The Supabase contract generator does not reproduce the committed contract on `main`.** `packages/3-extensions/supabase/scripts/generate-contract.ts` needs a live Supabase-shaped database, and its output on `main` already differs from the committed `src/contract/contract.prisma`. The `Json` change edited that schema by hand instead of rerunning the generator. Emitting the edited schema gives a `contract.json` identical to the committed one. The generator belongs to the Supabase pack, and fixing it is outside this project.
