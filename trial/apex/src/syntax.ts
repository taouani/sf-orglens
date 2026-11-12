/**
 * The syntax of Apex as the resolver sees it, and the interface a parser has to offer.
 *
 * The two parsers of the trial build very different trees. An adapter lowers the tree of its parser into this
 * small model, and the resolver is written once against the model. The model keeps what a reference needs: names
 * with their places, types as written, statements, expressions and queries. It keeps no comment and no white space.
 *
 * Lines and columns start at 1. A column counts UTF-16 units.
 */

export interface Pos {
  readonly line: number;
  readonly column: number;
}

/** A word of the source with the place it starts at. */
export interface Name {
  readonly text: string;
  readonly at: Pos;
}

/** A type as written: `Map<Id, List<Invoice__c>>`, `Database.BatchableContext`, `Invoice__c[]`. */
export interface TypeRef {
  /** The dotted name without arguments, as written. */
  readonly name: string;
  readonly args: readonly TypeRef[];
  /** The number of `[]` after the name. */
  readonly array: number;
  readonly at: Pos;
}

export interface Problem {
  readonly at: Pos;
  readonly message: string;
}

/** One file: a class, an interface or an enum, or a trigger. */
export interface Unit {
  readonly types: readonly TypeDecl[];
  readonly trigger: TriggerDecl | undefined;
  readonly problems: readonly Problem[];
}

export interface TriggerDecl {
  readonly name: Name;
  readonly object: Name;
  readonly body: readonly Stmt[];
  readonly members: readonly Member[];
}

export interface TypeDecl {
  readonly kind: 'class' | 'interface' | 'enum';
  readonly name: Name;
  readonly extends: TypeRef | undefined;
  readonly members: readonly Member[];
  /** The names of the values of an enum. */
  readonly values: readonly Name[];
}

export type Member =
  | { readonly kind: 'type'; readonly decl: TypeDecl }
  | {
      readonly kind: 'method';
      readonly name: Name;
      /** A constructor. Its name is the name of the class. */
      readonly ctor: boolean;
      readonly static: boolean;
      readonly params: readonly Param[];
      readonly returns: TypeRef | undefined;
      readonly body: Stmt | undefined;
    }
  | {
      readonly kind: 'field';
      readonly type: TypeRef;
      readonly static: boolean;
      readonly final: boolean;
      readonly vars: readonly Declarator[];
    }
  | {
      readonly kind: 'property';
      readonly type: TypeRef;
      readonly static: boolean;
      readonly name: Name;
      readonly accessors: readonly Stmt[];
    }
  | { readonly kind: 'initializer'; readonly static: boolean; readonly body: Stmt };

export interface Param {
  readonly type: TypeRef;
  readonly name: Name;
}

export interface Declarator {
  readonly name: Name;
  readonly init: Expr | undefined;
}

export type DmlOp = 'insert' | 'update' | 'upsert' | 'delete' | 'undelete' | 'merge';

export type Stmt =
  | { readonly kind: 'block'; readonly stmts: readonly Stmt[] }
  | { readonly kind: 'local'; readonly type: TypeRef; readonly vars: readonly Declarator[] }
  | { readonly kind: 'expr'; readonly expr: Expr }
  | { readonly kind: 'if'; readonly cond: Expr; readonly then: Stmt; readonly else: Stmt | undefined }
  | {
      readonly kind: 'for';
      readonly init: readonly Stmt[];
      readonly cond: Expr | undefined;
      readonly update: readonly Expr[];
      readonly body: Stmt | undefined;
    }
  | {
      readonly kind: 'foreach';
      readonly type: TypeRef;
      readonly name: Name;
      readonly iterable: Expr;
      readonly body: Stmt | undefined;
    }
  | { readonly kind: 'while'; readonly cond: Expr; readonly body: Stmt | undefined }
  | { readonly kind: 'return'; readonly expr: Expr | undefined }
  | { readonly kind: 'throw'; readonly expr: Expr }
  | {
      readonly kind: 'try';
      readonly block: Stmt;
      readonly catches: readonly { readonly type: TypeRef; readonly name: Name; readonly block: Stmt }[];
      readonly finally: Stmt | undefined;
    }
  | { readonly kind: 'switch'; readonly on: Expr; readonly whens: readonly When[] }
  | {
      readonly kind: 'dml';
      readonly op: DmlOp;
      /** The place of the keyword. */
      readonly at: Pos;
      /** The records. A merge has two expressions. */
      readonly targets: readonly Expr[];
      /** The field named after the records of an `upsert`, as written: the last word is the field. */
      readonly key: readonly Name[];
    }
  | { readonly kind: 'runas'; readonly args: readonly Expr[]; readonly block: Stmt }
  | { readonly kind: 'other' };

export interface When {
  /** `when Invoice__c invoice`: the type and the variable it binds. */
  readonly binding: { readonly type: TypeRef; readonly name: Name } | undefined;
  readonly values: readonly Expr[];
  readonly block: Stmt;
}

export type Expr =
  | { readonly kind: 'name'; readonly name: Name }
  | {
      readonly kind: 'string';
      /** The place of the opening quote. */
      readonly at: Pos;
      /** The text between the quotes, as written, escapes included. */
      readonly raw: string;
    }
  | { readonly kind: 'literal'; readonly at: Pos; readonly text: string }
  | { readonly kind: 'dot'; readonly target: Expr; readonly name: Name; readonly safe: boolean }
  | { readonly kind: 'call'; readonly target: Expr | undefined; readonly name: Name; readonly args: readonly Expr[] }
  | { readonly kind: 'new'; readonly type: TypeRef; readonly args: readonly Expr[] }
  | {
      /** `new List<String>{ 'a' }`, `new Map<String, Object>{ 'a' => 1 }`, `new String[]{ 'a' }`, `new Integer[3]`. */
      readonly kind: 'collection';
      readonly type: TypeRef;
      readonly elements: readonly Expr[];
      readonly pairs: readonly { readonly key: Expr; readonly value: Expr }[];
    }
  | { readonly kind: 'cast'; readonly type: TypeRef; readonly expr: Expr }
  | { readonly kind: 'assign'; readonly op: string; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'binary'; readonly op: string; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'unary'; readonly op: string; readonly operand: Expr }
  | { readonly kind: 'ternary'; readonly cond: Expr; readonly then: Expr; readonly else: Expr }
  | { readonly kind: 'index'; readonly target: Expr; readonly index: Expr }
  | { readonly kind: 'instanceof'; readonly expr: Expr; readonly type: TypeRef }
  | { readonly kind: 'soql'; readonly query: Query }
  | { readonly kind: 'sosl'; readonly search: Search }
  | { readonly kind: 'this' }
  | { readonly kind: 'super' }
  | { readonly kind: 'class'; readonly type: TypeRef }
  /** What the adapter could not name. The expressions inside it are still looked at. */
  | { readonly kind: 'unknown'; readonly parts: readonly Expr[] };

/** A path of names in a query: `Account__r.Tier__c` is two names. */
export type FieldPath = readonly Name[];

export interface Query {
  /** The object after `FROM`, or the relationship of a sub-query in the `SELECT` list. Dotted names are split. */
  readonly from: FieldPath;
  /** The alias of the object, in lower case. */
  readonly alias: string | undefined;
  /** Every field the query names, in any clause, also inside a function. An alias of a field is not a field. */
  readonly fields: readonly FieldPath[];
  /** The sub-queries of the `SELECT` list. Their `from` is a child relationship. */
  readonly children: readonly Query[];
  /** The sub-queries of the `WHERE` clause. Their `from` is an object. */
  readonly nested: readonly Query[];
  readonly typeOfs: readonly TypeOf[];
  /** The Apex expressions after a colon. */
  readonly binds: readonly Expr[];
}

export interface TypeOf {
  readonly relationship: FieldPath;
  readonly whens: readonly { readonly object: Name; readonly fields: readonly FieldPath[] }[];
  /** The fields after `ELSE`. Which object they belong to is not known. */
  readonly otherwise: readonly FieldPath[];
}

export interface Search {
  readonly returning: readonly { readonly object: Name; readonly fields: readonly FieldPath[] }[];
  readonly binds: readonly Expr[];
}

/** What a parser has to offer to the trial. */
export interface SyntaxAdapter {
  readonly name: string;
  /** Never throws. A file that cannot be read at all gives a unit without types and with a problem. */
  parseUnit(source: string, kind: 'class' | 'trigger'): Unit;
  /**
   * Reads the text of a query that Apex builds at run time. The text has one line. Returns `undefined` when the
   * parser cannot make a query of it.
   */
  parseQuery(text: string): Query | undefined;
}
