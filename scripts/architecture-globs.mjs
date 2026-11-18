export const DEPENDENCY_CRUISER_EXCLUDES = [
  'node_modules',
  '\\.test\\.',
  '\\.spec\\.',
  '/test/',
  '\\.config\\.',
  'vitest\\.config',
  'tsdown\\.config',
  '\\.d\\.ts$',
  'dist',
  'coverage',
  '^packages/document/',
  '^test/',
];

export const normalizeGlob = (glob) => {
  const DOUBLE_WILDCARD = '__DOUBLE_WILDCARD__';
  const SINGLE_WILDCARD = '__SINGLE_WILDCARD__';
  const hasWildcard = glob.includes('*');
  const lastPathSegment = glob.split('/').pop() ?? '';
  const isFileLikePattern = !hasWildcard && lastPathSegment.includes('.');

  let pattern = glob
    .replace(/\*\*/g, DOUBLE_WILDCARD)
    .replace(/\*/g, SINGLE_WILDCARD)
    .replaceAll(DOUBLE_WILDCARD, '.*')
    .replaceAll(SINGLE_WILDCARD, '[^/]*');

  if (isFileLikePattern) {
    return `^${pattern}$`;
  }
  if (!hasWildcard && !pattern.endsWith('/')) {
    pattern += '/.*';
  }
  return `^${pattern}`;
};
