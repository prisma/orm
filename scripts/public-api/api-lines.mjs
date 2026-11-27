// Reads one line of an api.txt, as scripts/public-api/flatten.mjs writes it, back into the import
// path and the export the line belongs to. Only Node built-ins, so the pull request check that
// holds a write token can run it without installing anything.

export class ApiLineError extends Error {}

// The order api.txt is sorted in.
export const compareCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const DECLARATION = new RegExp(
  `^(?:(?:abstract|declare|async)\\s+)*(?:class|interface|type|function\\*?|const|let|var|enum|namespace|module)\\s+(${IDENTIFIER})`,
);
const DEFAULT_EXPORT = /^export (?:type )?default = /;
const TYPE_ONLY_MARKER = 'export type ';
const FORWARD = new RegExp(`^export (?:type )?(${IDENTIFIER})(?: = | from )`);
const STAR_FORWARD = /^everything from \S+$/;
const AUGMENTATION = new RegExp(`^augments \\S+ interface ${IDENTIFIER}`);

export function exportOfLine(line) {
  const exported = /^(\.[^:]*): /.exec(line);
  const subpath = exported?.[1];
  let rest;
  if (exported) rest = line.slice(exported[0].length);
  else if (line.startsWith('(not exported) ')) rest = line.slice('(not exported) '.length);
  else throw new ApiLineError(`cannot read the api.txt line: ${line}`);
  rest = rest.replace(/^deprecated: /, '');

  const name = nameOf(rest);
  if (name === undefined) {
    throw new ApiLineError(
      `cannot tell which export the api.txt line belongs to: ${line}\nThe line format in scripts/public-api/flatten.mjs has changed; teach scripts/public-api/api-lines.mjs to read it.`,
    );
  }
  return { subpath, name };
}

function nameOf(rest) {
  if (DEFAULT_EXPORT.test(rest)) return 'default';
  if (STAR_FORWARD.test(rest)) return rest;
  const augmentation = AUGMENTATION.exec(rest);
  if (augmentation) return augmentation[0];
  const declaration = rest.startsWith(TYPE_ONLY_MARKER)
    ? DECLARATION.exec(rest.slice(TYPE_ONLY_MARKER.length))
    : DECLARATION.exec(rest);
  if (declaration) return declaration[1];
  return FORWARD.exec(rest)?.[1];
}
