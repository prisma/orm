import { InternalError } from '@internal/utils/internal-error';
import type {
  OptionalVersionedTextDocumentIdentifier,
  TextDocumentContentChangeEvent,
  TextDocumentItem,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { canonicalFileIdentity } from './schema-inputs';

export class DocumentStore {
  private readonly documents = new Map<string, TextDocument>();

  readonly getDocument = (uri: string): TextDocument | undefined =>
    this.documents.get(canonicalFileIdentity(uri));

  all(): readonly TextDocument[] {
    return [...this.documents.values()];
  }

  open(item: TextDocumentItem): TextDocument {
    const document = TextDocument.create(item.uri, item.languageId, item.version, item.text);
    this.documents.set(canonicalFileIdentity(item.uri), document);
    return document;
  }

  change(
    identifier: OptionalVersionedTextDocumentIdentifier,
    changes: TextDocumentContentChangeEvent[],
  ): TextDocument | undefined {
    if (changes.length === 0) return undefined;
    const { uri, version } = identifier;
    if (version === null || version === undefined) {
      throw new InternalError(
        `Received document change event for ${uri} without valid version identifier`,
      );
    }
    const document = this.getDocument(uri);
    if (document === undefined) return undefined;
    const updated = TextDocument.update(document, changes, version);
    this.documents.set(canonicalFileIdentity(uri), updated);
    return updated;
  }

  close(uri: string): TextDocument | undefined {
    const document = this.getDocument(uri);
    this.documents.delete(canonicalFileIdentity(uri));
    return document;
  }
}
