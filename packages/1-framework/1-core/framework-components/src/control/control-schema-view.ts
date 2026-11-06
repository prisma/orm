/**
 * Core schema view types for family-agnostic schema visualization.
 *
 * These types provide a minimal, generic, tree-shaped representation of schemas
 * across families, designed for CLI visualization and lightweight tooling.
 *
 * Families can optionally project their family-specific Schema IR into this
 * core view via the `toSchemaView` method on `FamilyInstance`.
 */

export type SchemaViewNodeKind =
  | 'root'
  | 'namespace'
  | 'collection'
  | 'entity'
  | 'field'
  | 'index'
  | 'dependency';

export interface SchemaTreeVisitor<R> {
  visit(node: SchemaTreeNode): R;
}

/**
 * What a piece of a node's label is: the heading of the whole tree, a fixed word of the family's
 * vocabulary (such as `table` or `collection`), the text that identifies the node (a name or a key
 * list), or a qualifier about it.
 */
export type SchemaLabelPartRole = 'title' | 'keyword' | 'name' | 'detail';

/** One piece of a node's label. Separators and other plain text carry no role. */
export interface SchemaLabelPart {
  readonly text: string;
  readonly role?: SchemaLabelPartRole;
}

/** A node's label is given as parts; its plain `label` is their joined text. */
export interface SchemaTreeNodeOptions {
  readonly kind: SchemaViewNodeKind;
  readonly id: string;
  readonly labelParts: readonly SchemaLabelPart[];
  readonly meta?: Record<string, unknown>;
  readonly children?: readonly SchemaTreeNode[];
}

export class SchemaTreeNode {
  readonly kind: SchemaViewNodeKind;
  readonly id: string;
  readonly label: string;
  readonly labelParts: readonly SchemaLabelPart[];
  readonly meta?: Record<string, unknown>;
  readonly children?: readonly SchemaTreeNode[];

  constructor(options: SchemaTreeNodeOptions) {
    this.kind = options.kind;
    this.id = options.id;
    this.label = options.labelParts.map((part) => part.text).join('');
    this.labelParts = options.labelParts;
    if (options.meta !== undefined) this.meta = options.meta;
    if (options.children !== undefined) this.children = options.children;
    Object.freeze(this);
  }

  accept<R>(visitor: SchemaTreeVisitor<R>): R {
    return visitor.visit(this);
  }
}

/**
 * Core schema view providing a family-agnostic tree representation of a schema.
 * Used by CLI and cross-family tooling for visualization.
 */
export interface CoreSchemaView {
  readonly root: SchemaTreeNode;
}
