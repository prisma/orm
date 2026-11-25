// The compiler options both readings use, in tsconfig form: API Extractor reads them as its
// tsconfig, and read-exports.mjs converts them for the TypeScript API. Both must see the same
// program: the `dom` library, for example, is what makes API Extractor rename `Document`.
export const COMPILER_OPTIONS = {
  target: 'es2022',
  module: 'nodenext',
  moduleResolution: 'nodenext',
  lib: ['es2023', 'dom'],
  strict: true,
  skipLibCheck: true,
  types: ['node'],
};
