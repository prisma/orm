import { isPslIdentifier } from '@internal/psl-parser';
import {
  LSPErrorCodes,
  type Range,
  ResponseError,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver';
import { identTokenAt } from './cursor-resolution';
import { type ProvideReferencesInput, provideReferences } from './references';

export type ProvidePrepareRenameInput = Omit<ProvideReferencesInput, 'includeDeclaration'>;

export interface ProvideRenameInput extends ProvidePrepareRenameInput {
  readonly newName: string;
}

export interface PrepareRenameResult {
  readonly range: Range;
  readonly placeholder: string;
}

export function providePrepareRename(input: ProvidePrepareRenameInput): PrepareRenameResult | null {
  if (provideReferences({ ...input, includeDeclaration: true }).length === 0) return null;
  const { sourceFile } = input;
  const token = identTokenAt(input.document.syntax, sourceFile.offsetAt(input.position));
  if (token === undefined) return null;
  return {
    range: {
      start: sourceFile.positionAt(token.offset),
      end: sourceFile.positionAt(token.endOffset),
    },
    placeholder: token.text,
  };
}

export function provideRename(input: ProvideRenameInput): WorkspaceEdit | null {
  const { newName, ...cursor } = input;
  if (!isPslIdentifier(newName)) {
    throw new ResponseError(
      LSPErrorCodes.RequestFailed,
      `"${newName}" is not a valid PSL identifier`,
    );
  }
  const locations = provideReferences({ ...cursor, includeDeclaration: true });
  if (locations.length === 0) return null;
  const changes: Record<string, TextEdit[]> = {};
  for (const { uri, range } of locations) {
    const edits = changes[uri] ?? [];
    edits.push({ range, newText: newName });
    changes[uri] = edits;
  }
  return { changes };
}
