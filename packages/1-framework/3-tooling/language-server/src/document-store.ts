import { InternalError } from '@internal/utils/internal-error';
import type {
  OptionalVersionedTextDocumentIdentifier,
  TextDocumentContentChangeEvent,
  TextDocumentItem,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { canonicalFileIdentity } from './schema-inputs';

export interface DocumentStore {
  getDocument(uri: string): TextDocument | undefined;
  all(): readonly TextDocument[];
  open(item: TextDocumentItem): TextDocument;
  change(
    identifier: OptionalVersionedTextDocumentIdentifier,
    changes: TextDocumentContentChangeEvent[],
  ): TextDocument | undefined;
  close(uri: string): TextDocument | undefined;
}

export function createDocumentStore(): DocumentStore {
  const documents = new Map<string, TextDocument>();
  const getDocument = (uri: string) => documents.get(canonicalFileIdentity(uri));

  return {
    getDocument,
    all: () => [...documents.values()],
    open(item) {
      const document = TextDocument.create(item.uri, item.languageId, item.version, item.text);
      documents.set(canonicalFileIdentity(item.uri), document);
      return document;
    },
    change(identifier, changes) {
      if (changes.length === 0) return undefined;
      const { uri, version } = identifier;
      if (version === null || version === undefined) {
        throw new InternalError(
          `Received document change event for ${uri} without valid version identifier`,
        );
      }
      const document = getDocument(uri);
      if (document === undefined) return undefined;
      const updated = TextDocument.update(document, changes, version);
      documents.set(canonicalFileIdentity(uri), updated);
      return updated;
    },
    close(uri) {
      const document = getDocument(uri);
      documents.delete(canonicalFileIdentity(uri));
      return document;
    },
  };
}
