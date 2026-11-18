const EXAMPLE_INTRO =
  '# Copy this file to `.env` and replace the placeholder with your real connection string.';

/**
 * `.env.example`: the target package's placeholder body under an intro that only makes sense for
 * the example file. The real `.env` is the destination of that copy, so it gets the body alone.
 */
export function envExampleContent(body: string): string {
  return `${EXAMPLE_INTRO}\n${body}`;
}
