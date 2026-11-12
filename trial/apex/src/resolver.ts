/**
 * The resolver of the trial: from the syntax of the Apex files of a project to references to objects and fields.
 *
 * It is written once, against the model of `syntax.ts`, and knows nothing of the parser behind an adapter. It
 * keeps scopes, works out the declared type of an expression against the objects and fields of the project,
 * tells a read from a write, reads inline queries and searches, and follows text that a query is built from at
 * run time through constants and local variables.
 *
 * This is a spike. It is small on purpose and it is not the resolver of the product. What it does not do is
 * listed in the README of the trial.
 */
import {
  apexSignature,
  buildKey,
  type ComponentKey,
  type SubComponent,
} from '../../../packages/engine/src/core/keys.ts';
import { isObjectName, isStandardRelationship, standardTarget, type Schema } from './schema.ts';
import type {
  DmlOp,
  Expr,
  FieldPath,
  Member,
  Name,
  Param,
  Pos,
  Query,
  Search,
  Stmt,
  SyntaxAdapter,
  TypeDecl,
  TypeRef,
  Unit,
} from './syntax.ts';

type FoundKind = 'reads' | 'writes' | 'references' | 'extends' | 'triggers-on';
type FoundVia = 'field' | 'soql' | 'sosl' | 'dml' | 'token' | 'text' | 'declaration';
type Tier = 'confirmed' | 'probable' | 'possible';

export interface Found {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** The word at the place. */
  readonly match: string;
  readonly from: ComponentKey;
  readonly to: ComponentKey;
  readonly kind: FoundKind;
  readonly via: FoundVia;
  readonly tier: Tier;
  readonly op: DmlOp | undefined;
}

/** A place where the source names something whose target cannot be known. */
interface Unknown {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly match: string;
  readonly from: ComponentKey;
  readonly why: string;
}

/** A call from a member of a class to a method or constructor of a class of the project. */
interface CallEdge {
  readonly from: ComponentKey;
  /** `outer.inner.method/2`, in lower case. A constructor is named `<init>`. */
  readonly to: string;
}

export interface Analysis {
  readonly references: readonly Found[];
  readonly unknowns: readonly Unknown[];
  readonly calls: readonly CallEdge[];
  /** Queries built as text: how many were found, and how many of them the parser could not read. */
  readonly dynamicQueries: { readonly found: number; readonly unread: number };
}

export interface SourceFile {
  /** The path as the references name it, with forward slashes. */
  readonly path: string;
  readonly unit: Unit;
}

// ---------------------------------------------------------------- text that is built at run time

type Origin =
  /** A text literal. `map[i]` is where character `i` of the text stands after the opening quote. */
  | { readonly kind: 'literal'; readonly at: Pos; readonly map: readonly number[] }
  /** A constant or a variable that is joined in. Every name of its text stands at this word. */
  | { readonly kind: 'word'; readonly name: Name };

type Piece =
  | { readonly hole: false; readonly value: string; readonly origin: Origin }
  /** Text that is not known. `origin` is the word that stands for it, if there is one. */
  | { readonly hole: true; readonly origin: Name | undefined };

type Text = readonly Piece[];

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

/** The text of a literal without its escapes, and where each of its characters stands in the source. */
function unescape(raw: string): { value: string; map: number[] } {
  let value = '';
  const map: number[] = [];
  for (let at = 0; at < raw.length; at += 1) {
    const char = raw.charAt(at);
    if (char !== '\\' || at + 1 >= raw.length) {
      value += char;
      map.push(at);
      continue;
    }
    const next = raw.charAt(at + 1);
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(at + 2, at + 6))) {
      value += String.fromCharCode(Number.parseInt(raw.slice(at + 2, at + 6), 16));
      map.push(at);
      at += 5;
    } else {
      value += ESCAPES[next] ?? next;
      map.push(at);
      at += 1;
    }
  }
  return { value, map };
}

const hole = (origin: Name | undefined): Piece => ({ hole: true, origin });

/** The text as it reads when it stands behind a word: every name of it is at the word. */
function relocate(text: Text, name: Name): Text {
  return text.map((piece) =>
    piece.hole ? hole(name) : { hole: false, value: piece.value, origin: { kind: 'word', name } },
  );
}

/** The whole text, when no part of it is unknown. */
function known(text: Text | undefined): string | undefined {
  if (text === undefined || text.some((piece) => piece.hole)) return undefined;
  return text.map((piece) => (piece.hole ? '' : piece.value)).join('');
}

// ---------------------------------------------------------------- types and values

type Type =
  /** A record. `object` is `undefined` for `SObject` and for an object the trial cannot name. */
  | { readonly k: 'sobject'; readonly object: string | undefined }
  | { readonly k: 'list'; readonly of: Type }
  | { readonly k: 'map'; readonly key: Type; readonly value: Type }
  | { readonly k: 'class'; readonly cls: ClassInfo }
  /** The class itself, as in `InvoiceConstants.AMOUNT`. */
  | { readonly k: 'classRef'; readonly cls: ClassInfo }
  /** The name of an object in an expression, as in `Invoice__c.Amount__c`. */
  | { readonly k: 'objectRef'; readonly object: Name }
  | { readonly k: 'namespace'; readonly name: 'schema' | 'sobjecttype' | 'trigger' | 'database' | 'string' }
  | { readonly k: 'string' }
  | { readonly k: 'objectToken'; readonly object: string | undefined }
  | { readonly k: 'fieldToken'; readonly object: string | undefined; readonly field: string | undefined }
  | { readonly k: 'describe'; readonly object: string | undefined }
  /** `fields` of a describe result or of an object: the next name is a field. */
  | { readonly k: 'fieldsOf'; readonly object: string | undefined }
  /** `fields.getMap()`: field tokens by name. */
  | { readonly k: 'fieldMap'; readonly object: string | undefined }
  /** `Schema.getGlobalDescribe()`: object tokens by name. */
  | { readonly k: 'objectMap' }
  | { readonly k: 'other' };

const OTHER: Type = { k: 'other' };
const STRING: Type = { k: 'string' };

interface Value {
  readonly type: Type;
  readonly text?: Text | undefined;
  /** The values of a list that is written out, as in `new List<String>{ 'a', 'b' }`. */
  readonly list?: readonly Value[] | undefined;
  /**
   * A reference that making this value reported and that the use of the value may replace: the object of a
   * describe result when a field follows, a field token when it is the argument of `get` or `put`.
   */
  readonly made?: Found | undefined;
}

const VALUE: Value = { type: OTHER };

interface Variable {
  type: Type;
  /** The text a `String` holds: one entry for each way the method builds it. */
  texts: Text[] | undefined;
  list: readonly Value[] | undefined;
}

interface Scope {
  readonly vars: Map<string, Variable>;
  readonly parent: Scope | undefined;
}

// ---------------------------------------------------------------- the classes of the project

interface FieldEntry {
  readonly type: TypeRef;
  readonly constant: boolean;
  readonly init: Expr | undefined;
  readonly owner: ClassInfo;
  value: Value | 'working' | undefined;
}

interface MethodEntry {
  readonly params: readonly Param[];
  readonly returns: TypeRef | undefined;
  readonly owner: ClassInfo;
}

interface ClassInfo {
  /** The name of the outermost class, as written. */
  readonly top: string;
  /** The path below the outermost class, as the sub-components of a key. */
  readonly subs: readonly SubComponent[];
  /** `outer.inner`, in lower case. */
  readonly qualified: string;
  readonly outer: ClassInfo | undefined;
  readonly extends: TypeRef | undefined;
  readonly fields: Map<string, FieldEntry>;
  readonly methods: Map<string, MethodEntry[]>;
  readonly inner: Map<string, ClassInfo>;
}

interface Context {
  readonly file: string;
  readonly from: ComponentKey;
  readonly cls: ClassInfo | undefined;
  /** The object of the trigger whose body is read. */
  readonly triggerObject: string | undefined;
  /** How often the body of the member assigns to a name. A name that is assigned once keeps its value. */
  readonly assigned: ReadonlyMap<string, number>;
  /** Nothing is reported: the value of a constant is worked out for a use somewhere else. */
  readonly quiet: boolean;
  scope: Scope;
}

interface Place {
  readonly at: Pos;
  readonly match: string;
  /** The place stands for text that is not known. */
  readonly hole: boolean;
}

interface QueryMode {
  readonly via: 'soql' | 'sosl' | 'text';
  readonly tier: Tier;
  /** Whether the query is built as text. Its bound expressions are then not Apex of this file. */
  readonly dynamic: boolean;
  readonly locate: (name: Name) => Place | undefined;
}

const typeText = (type: TypeRef): string =>
  `${type.name}${type.args.length > 0 ? `<${type.args.map(typeText).join(',')}>` : ''}${'[]'.repeat(type.array)}`;

/** The word that stands for an expression, if one does. */
function anchor(expr: Expr | undefined): Name | undefined {
  if (expr === undefined) return undefined;
  if (expr.kind === 'name') return expr.name;
  if (expr.kind === 'dot' || expr.kind === 'call') return expr.name;
  if (expr.kind === 'cast') return anchor(expr.expr);
  return undefined;
}

/** The first operand of a chain of `+`. */
function leftmost(expr: Expr): Expr {
  return expr.kind === 'binary' && expr.op === '+' ? leftmost(expr.left) : expr;
}

const HOLE_MARK = /zqh(\d+)qz/;
const DATABASE_QUERIES = new Set([
  'query',
  'querywithbinds',
  'countquery',
  'countquerywithbinds',
  'getquerylocator',
  'getquerylocatorwithbinds',
  'getcursor',
  'getcursorwithbinds',
]);
const DATABASE_DML = new Map<string, DmlOp>([
  ['insert', 'insert'],
  ['insertimmediate', 'insert'],
  ['insertasync', 'insert'],
  ['update', 'update'],
  ['updateimmediate', 'update'],
  ['updateasync', 'update'],
  ['upsert', 'upsert'],
  ['delete', 'delete'],
  ['deleteimmediate', 'delete'],
  ['deleteasync', 'delete'],
  ['undelete', 'undelete'],
  ['merge', 'merge'],
]);

class Resolver {
  private readonly found = new Map<string, Found>();
  private readonly unknowns = new Map<string, Unknown>();
  private readonly calls = new Map<string, CallEdge>();
  private readonly classes = new Map<string, ClassInfo>();
  private dynamicFound = 0;
  private dynamicUnread = 0;
  private ctx: Context;
  private readonly schema: Schema;
  private readonly adapter: SyntaxAdapter;

  constructor(schema: Schema, adapter: SyntaxAdapter) {
    this.schema = schema;
    this.adapter = adapter;
    this.ctx = this.context('', '' as ComponentKey, undefined, undefined, undefined, true);
  }

  // -------------------------------------------------------------- the index of classes

  index(decl: TypeDecl, outer: ClassInfo | undefined): ClassInfo {
    const top = outer?.top ?? decl.name.text;
    const subs: SubComponent[] = outer === undefined ? [] : [...outer.subs, { kind: 'inner', name: decl.name.text }];
    const info: ClassInfo = {
      top,
      subs,
      qualified: (outer === undefined ? '' : `${outer.qualified}.`) + decl.name.text.toLowerCase(),
      outer,
      extends: decl.extends,
      fields: new Map(),
      methods: new Map(),
      inner: new Map(),
    };
    for (const member of decl.members) {
      if (member.kind === 'type') {
        info.inner.set(member.decl.name.text.toLowerCase(), this.index(member.decl, info));
      } else if (member.kind === 'field') {
        for (const declared of member.vars) {
          info.fields.set(declared.name.text.toLowerCase(), {
            type: member.type,
            constant: member.static && member.final,
            init: declared.init,
            owner: info,
            value: undefined,
          });
        }
      } else if (member.kind === 'property') {
        info.fields.set(member.name.text.toLowerCase(), {
          type: member.type,
          constant: false,
          init: undefined,
          owner: info,
          value: undefined,
        });
      } else if (member.kind === 'method') {
        const name = member.ctor ? '<init>' : member.name.text.toLowerCase();
        const entry: MethodEntry = { params: member.params, returns: member.returns, owner: info };
        info.methods.set(name, [...(info.methods.get(name) ?? []), entry]);
      }
    }
    if (outer === undefined) this.classes.set(info.qualified, info);
    return info;
  }

  /** The class a name stands for, seen from inside a class: an inner class, a class around it, or a class of the project. */
  private findClass(name: string, from: ClassInfo | undefined): ClassInfo | undefined {
    const [first, ...rest] = name.toLowerCase().split('.');
    if (first === undefined) return undefined;
    let start: ClassInfo | undefined;
    for (let at = from; at !== undefined && start === undefined; at = at.outer) {
      start = at.inner.get(first) ?? (at.qualified.split('.').at(-1) === first ? at : undefined);
    }
    start ??= this.classes.get(first);
    for (const part of rest) start = start?.inner.get(part);
    return start;
  }

  private superOf(cls: ClassInfo): ClassInfo | undefined {
    return cls.extends === undefined ? undefined : this.findClass(cls.extends.name, cls.outer ?? cls);
  }

  /** A class, the classes it extends, then the classes around it. */
  private *chain(cls: ClassInfo): Generator<ClassInfo> {
    const seen = new Set<ClassInfo>();
    for (let outer: ClassInfo | undefined = cls; outer !== undefined; outer = outer.outer) {
      for (let at: ClassInfo | undefined = outer; at !== undefined && !seen.has(at); at = this.superOf(at)) {
        seen.add(at);
        yield at;
      }
    }
  }

  private findField(cls: ClassInfo, name: string): FieldEntry | undefined {
    for (const at of this.chain(cls)) {
      const entry = at.fields.get(name);
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

  private key(cls: ClassInfo, sub?: SubComponent): ComponentKey {
    return buildKey({ type: 'ApexClass', fullName: cls.top, subs: sub === undefined ? cls.subs : [...cls.subs, sub] });
  }

  // -------------------------------------------------------------- reporting

  private context(
    file: string,
    from: ComponentKey,
    cls: ClassInfo | undefined,
    triggerObject: string | undefined,
    body: Stmt | readonly Stmt[] | undefined,
    quiet = false,
  ): Context {
    const assigned = new Map<string, number>();
    const count = (expr: Expr): void => {
      const target = expr.kind === 'assign' ? expr.left : expr.kind === 'unary' ? expr.operand : undefined;
      if (target?.kind === 'name' && (expr.kind === 'assign' || expr.kind === 'unary')) {
        if (expr.kind === 'assign' || expr.op.includes('++') || expr.op.includes('--')) {
          const name = target.name.text.toLowerCase();
          assigned.set(name, (assigned.get(name) ?? 0) + 1);
        }
      }
    };
    for (const stmt of body === undefined ? [] : 'kind' in body ? [body] : body) eachExpr(stmt, count);
    return { file, from, cls, triggerObject, assigned, quiet, scope: { vars: new Map(), parent: undefined } };
  }

  private add(
    place: { at: Pos; match: string } | undefined,
    kind: FoundKind,
    target: { object: string; field?: string } | ComponentKey,
    via: FoundVia,
    tier: Tier,
    op?: DmlOp,
  ): Found | undefined {
    if (this.ctx.quiet || place === undefined) return undefined;
    let to: ComponentKey;
    try {
      to =
        typeof target === 'string'
          ? target
          : target.field === undefined
            ? buildKey({ type: 'CustomObject', fullName: target.object })
            : buildKey({ type: 'CustomField', fullName: `${target.object}.${target.field}` });
    } catch {
      // A name that cannot be part of a key is not a name of an object or of a field.
      return undefined;
    }
    const { file, from } = this.ctx;
    const { line, column } = place.at;
    const id = `${file}:${String(line)}:${String(column)}:${kind}:${to}`;
    const existing = this.found.get(id);
    if (existing !== undefined) return existing;
    const found: Found = { file, line, column, match: place.match, from, to, kind, via, tier, op };
    this.found.set(id, found);
    return found;
  }

  private retract(found: Found | undefined): void {
    if (found === undefined) return;
    this.found.delete(`${found.file}:${String(found.line)}:${String(found.column)}:${found.kind}:${found.to}`);
  }

  private unknown(place: { at: Pos; match: string } | undefined, why: string): void {
    if (this.ctx.quiet || place === undefined) return;
    const { file, from } = this.ctx;
    const id = `${file}:${String(place.at.line)}:${String(place.at.column)}`;
    if (!this.unknowns.has(id)) {
      this.unknowns.set(id, { file, line: place.at.line, column: place.at.column, match: place.match, from, why });
    }
  }

  private call(cls: ClassInfo, method: string, args: number): MethodEntry[] {
    const matches: MethodEntry[] = [];
    for (const at of method === '<init>' ? [cls] : this.chain(cls)) {
      for (const entry of at.methods.get(method) ?? []) if (entry.params.length === args) matches.push(entry);
      if (matches.length > 0) break;
    }
    const owner = matches[0]?.owner;
    if (owner !== undefined && !this.ctx.quiet) {
      const to = `${owner.qualified}.${method}/${String(args)}`;
      this.calls.set(`${this.ctx.from}\n${to}`, { from: this.ctx.from, to });
    }
    return matches;
  }

  // -------------------------------------------------------------- types

  private resolveType(ref: TypeRef | undefined, cls: ClassInfo | undefined): Type {
    if (ref === undefined) return OTHER;
    if (ref.array > 0) return { k: 'list', of: this.resolveType({ ...ref, array: ref.array - 1 }, cls) };
    const name = ref.name.toLowerCase();
    const arg = (index: number): Type => this.resolveType(ref.args[index], cls);
    switch (name) {
      case 'list':
      case 'set':
      case 'iterable':
      case 'system.list':
      case 'system.set':
        return { k: 'list', of: arg(0) };
      case 'map':
      case 'system.map': {
        const value = arg(1);
        if (value.k === 'fieldToken') return { k: 'fieldMap', object: undefined };
        if (value.k === 'objectToken') return { k: 'objectMap' };
        return { k: 'map', key: arg(0), value };
      }
      case 'string':
      case 'system.string':
        return STRING;
      case 'sobject':
      case 'system.sobject':
        return { k: 'sobject', object: undefined };
      case 'sobjecttype':
      case 'schema.sobjecttype':
        return { k: 'objectToken', object: undefined };
      case 'sobjectfield':
      case 'schema.sobjectfield':
      case 'describefieldresult':
      case 'schema.describefieldresult':
        return { k: 'fieldToken', object: undefined, field: undefined };
      case 'describesobjectresult':
      case 'schema.describesobjectresult':
        return { k: 'describe', object: undefined };
      default:
    }
    const found = this.findClass(name, cls);
    if (found !== undefined) return { k: 'class', cls: found };
    const simple = name.startsWith('schema.') ? ref.name.slice('schema.'.length) : ref.name;
    if (!simple.includes('.') && isObjectName(this.schema, simple)) return { k: 'sobject', object: simple };
    return OTHER;
  }

  /** The more exact of the declared type of a variable and the type of the one value it ever holds. */
  private refine(declared: Type, actual: Type): Type {
    if (declared.k === 'sobject' && actual.k === 'sobject') return declared.object === undefined ? actual : declared;
    if (declared.k === 'list' && actual.k === 'list') return { k: 'list', of: this.refine(declared.of, actual.of) };
    if (declared.k === 'map' && actual.k === 'map') {
      return { k: 'map', key: declared.key, value: this.refine(declared.value, actual.value) };
    }
    if (
      (declared.k === 'objectToken' || declared.k === 'describe' || declared.k === 'fieldMap') &&
      actual.k === declared.k
    ) {
      return declared.object === undefined ? actual : declared;
    }
    if (declared.k === 'fieldToken' && actual.k === 'fieldToken')
      return declared.field === undefined ? actual : declared;
    return declared;
  }

  private static objectOf(type: Type): string | undefined {
    if (type.k === 'sobject') return type.object;
    if (type.k === 'list') return Resolver.objectOf(type.of);
    return undefined;
  }

  // -------------------------------------------------------------- scopes

  private lookup(name: string): Variable | undefined {
    for (let scope: Scope | undefined = this.ctx.scope; scope !== undefined; scope = scope.parent) {
      const found = scope.vars.get(name);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  /**
   * Declares a variable. A local without a value starts as the empty text. A parameter, the variable of a loop and
   * the like are `given`: their value comes from elsewhere, so their text is not known.
   */
  private bind(name: Name, declared: Type, init?: { value: Value; expr: Expr }, given = false): void {
    const lower = name.text.toLowerCase();
    const once = (this.ctx.assigned.get(lower) ?? 0) === 0;
    const type = init !== undefined && once ? this.refine(declared, init.value.type) : declared;
    const texts =
      declared.k !== 'string'
        ? undefined
        : init === undefined
          ? [given ? [hole(name)] : []]
          : [init.value.text ?? [hole(anchor(init.expr))]];
    this.ctx.scope.vars.set(lower, { type, texts, list: once ? init?.value.list : undefined });
  }

  private inScope(run: () => void): void {
    const outer = this.ctx.scope;
    this.ctx.scope = { vars: new Map(), parent: outer };
    try {
      run();
    } finally {
      this.ctx.scope = outer;
    }
  }

  // -------------------------------------------------------------- statements

  private stmt(stmt: Stmt | undefined): void {
    if (stmt === undefined) return;
    switch (stmt.kind) {
      case 'block':
        this.inScope(() => {
          for (const inner of stmt.stmts) this.stmt(inner);
        });
        return;
      case 'local': {
        const declared = this.resolveType(stmt.type, this.ctx.cls);
        for (const one of stmt.vars) {
          const init = one.init === undefined ? undefined : { value: this.ev(one.init), expr: one.init };
          this.bind(one.name, declared, init);
        }
        return;
      }
      case 'expr':
        this.ev(stmt.expr);
        return;
      case 'if':
        this.ev(stmt.cond);
        this.stmt(stmt.then);
        this.stmt(stmt.else);
        return;
      case 'for':
        this.inScope(() => {
          for (const init of stmt.init) this.stmt(init);
          if (stmt.cond !== undefined) this.ev(stmt.cond);
          for (const update of stmt.update) this.ev(update);
          this.stmt(stmt.body);
        });
        return;
      case 'foreach': {
        const items = this.ev(stmt.iterable).type;
        const declared = this.resolveType(stmt.type, this.ctx.cls);
        this.inScope(() => {
          this.bind(stmt.name, items.k === 'list' ? this.refine(declared, items.of) : declared, undefined, true);
          this.stmt(stmt.body);
        });
        return;
      }
      case 'while':
        this.ev(stmt.cond);
        this.stmt(stmt.body);
        return;
      case 'return':
        if (stmt.expr !== undefined) this.ev(stmt.expr);
        return;
      case 'throw':
        this.ev(stmt.expr);
        return;
      case 'try':
        this.stmt(stmt.block);
        for (const clause of stmt.catches) {
          this.inScope(() => {
            this.bind(clause.name, OTHER);
            this.stmt(clause.block);
          });
        }
        this.stmt(stmt.finally);
        return;
      case 'switch':
        this.ev(stmt.on);
        for (const when of stmt.whens) {
          this.inScope(() => {
            if (when.binding !== undefined) {
              this.bind(when.binding.name, this.resolveType(when.binding.type, this.ctx.cls), undefined, true);
            }
            for (const value of when.values) this.ev(value);
            this.stmt(when.block);
          });
        }
        return;
      case 'dml': {
        const values = stmt.targets.map((target) => this.ev(target));
        const object = values.map((value) => Resolver.objectOf(value.type)).find((name) => name !== undefined);
        if (object === undefined) return;
        this.add({ at: stmt.at, match: stmt.op }, 'writes', { object }, 'dml', 'confirmed', stmt.op);
        const field = stmt.key.at(-1);
        if (field !== undefined) {
          this.add(
            { at: field.at, match: field.text },
            'references',
            { object, field: field.text },
            'dml',
            'confirmed',
          );
        }
        return;
      }
      case 'runas':
        for (const arg of stmt.args) this.ev(arg);
        this.stmt(stmt.block);
        return;
      case 'other':
        return;
    }
  }

  // -------------------------------------------------------------- expressions

  /**
   * Works out what an expression is, and reports the references it holds.
   *
   * `access` says what happens to a field that the expression ends in: an assignment writes it. `step` says
   * that another name follows, so that a standard name is a relationship and not a field.
   */
  private ev(expr: Expr, access: 'read' | 'write' | 'both' = 'read', step = false): Value {
    switch (expr.kind) {
      case 'name':
        return this.name(expr.name);
      case 'string': {
        const { value, map } = unescape(expr.raw);
        return { type: STRING, text: [{ hole: false, value, origin: { kind: 'literal', at: expr.at, map } }] };
      }
      case 'literal':
      case 'class':
        return VALUE;
      case 'this':
        return this.ctx.cls === undefined ? VALUE : { type: { k: 'class', cls: this.ctx.cls } };
      case 'super': {
        const base = this.ctx.cls === undefined ? undefined : this.superOf(this.ctx.cls);
        return base === undefined ? VALUE : { type: { k: 'class', cls: base } };
      }
      case 'dot': {
        const target = this.ev(expr.target, 'read', true);
        // `[SELECT Name FROM Account].Name` reads the field of the one record the query gives.
        const record = expr.target.kind === 'soql' && target.type.k === 'list' ? { type: target.type.of } : target;
        return this.dot(record, expr.name, access, step);
      }
      case 'call':
        return this.invoke(expr);
      case 'new': {
        const type = this.resolveType(expr.type, this.ctx.cls);
        if (type.k === 'sobject' && type.object !== undefined) {
          const object = type.object;
          for (const arg of expr.args) {
            if (arg.kind === 'assign' && arg.left.kind === 'name') {
              // `new Invoice__c(Amount__c = 1)` writes the field.
              this.field(object, arg.left.name, 'write', false);
              this.ev(arg.right);
            } else {
              this.ev(arg);
            }
          }
          return { type };
        }
        for (const arg of expr.args) this.ev(arg);
        if (type.k === 'class') this.call(type.cls, '<init>', expr.args.length);
        return { type };
      }
      case 'collection': {
        const type = this.resolveType(expr.type, this.ctx.cls);
        const list = expr.elements.map((element) => this.ev(element));
        for (const pair of expr.pairs) {
          this.ev(pair.key);
          this.ev(pair.value);
        }
        return { type, list: type.k === 'list' && type.of.k === 'string' ? list : undefined };
      }
      case 'cast': {
        const value = this.ev(expr.expr);
        const type = this.resolveType(expr.type, this.ctx.cls);
        return type.k === 'string' ? { type, text: value.text } : { type: this.refine(type, value.type) };
      }
      case 'assign': {
        const right = this.ev(expr.right);
        this.ev(expr.left, expr.op === '=' ? 'write' : 'both');
        if (expr.left.kind === 'name') this.assign(expr.left.name, expr.op, expr.right, right);
        return right;
      }
      case 'binary': {
        const left = this.ev(expr.left);
        const right = this.ev(expr.right);
        const textual = (value: Value): boolean => value.text !== undefined || value.type.k === 'string';
        if (expr.op !== '+' || !(textual(left) || textual(right))) return VALUE;
        return {
          type: STRING,
          text: [...(left.text ?? [hole(anchor(expr.left))]), ...(right.text ?? [hole(anchor(expr.right))])],
        };
      }
      case 'unary':
        return this.ev(expr.operand, expr.op.includes('++') || expr.op.includes('--') ? 'both' : 'read');
      case 'ternary': {
        this.ev(expr.cond);
        const then = this.ev(expr.then);
        const otherwise = this.ev(expr.else);
        return { type: then.type.k === 'other' ? otherwise.type : then.type };
      }
      case 'index': {
        const target = this.ev(expr.target).type;
        this.ev(expr.index);
        return target.k === 'list' ? { type: target.of } : VALUE;
      }
      case 'instanceof':
        this.ev(expr.expr);
        return VALUE;
      case 'soql': {
        const object = this.query(expr.query, undefined, false, STATIC_SOQL);
        return { type: { k: 'list', of: { k: 'sobject', object } } };
      }
      case 'sosl':
        this.search(expr.search);
        return { type: { k: 'list', of: { k: 'list', of: { k: 'sobject', object: undefined } } } };
      case 'unknown':
        for (const part of expr.parts) this.ev(part);
        return VALUE;
    }
  }

  private name(name: Name): Value {
    const lower = name.text.toLowerCase();
    const variable = this.lookup(lower);
    if (variable !== undefined) {
      const text =
        variable.texts === undefined
          ? undefined
          : variable.texts.length === 1 && variable.texts[0] !== undefined
            ? relocate(variable.texts[0], name)
            : [hole(name)];
      return { type: variable.type, text, list: this.listAt(variable.list, name) };
    }
    if (this.ctx.cls !== undefined) {
      const entry = this.findField(this.ctx.cls, lower);
      if (entry !== undefined) return this.member(entry, name);
    }
    if (
      lower === 'schema' ||
      lower === 'sobjecttype' ||
      lower === 'trigger' ||
      lower === 'database' ||
      lower === 'string'
    ) {
      return { type: { k: 'namespace', name: lower } };
    }
    const cls = this.findClass(lower, this.ctx.cls);
    if (cls !== undefined) return { type: { k: 'classRef', cls } };
    if (isObjectName(this.schema, name.text)) return { type: { k: 'objectRef', object: name } };
    return VALUE;
  }

  private listAt(list: readonly Value[] | undefined, name: Name): Value[] | undefined {
    return list?.map((item) => ({
      ...item,
      made: undefined,
      text: item.text === undefined ? undefined : relocate(item.text, name),
    }));
  }

  /** The value of a field of a class, read at the word `name`. A constant has the value it is set to. */
  private member(entry: FieldEntry, name: Name): Value {
    const declared = this.resolveType(entry.type, entry.owner);
    if (!entry.constant || entry.init === undefined) {
      return { type: declared, text: declared.k === 'string' ? [hole(name)] : undefined };
    }
    if (entry.value === undefined) {
      entry.value = 'working';
      const outer = this.ctx;
      this.ctx = this.context(outer.file, outer.from, entry.owner, undefined, undefined, true);
      try {
        const value = this.ev(entry.init);
        entry.value = { type: this.refine(declared, value.type), text: value.text, list: value.list };
      } finally {
        this.ctx = outer;
      }
    }
    // A constant that is set from itself has no value that can be followed.
    if (entry.value === 'working') return { type: declared };
    const { type, text, list } = entry.value;
    return {
      type,
      text: text === undefined ? (type.k === 'string' ? [hole(name)] : undefined) : relocate(text, name),
      list: this.listAt(list, name),
    };
  }

  private assign(name: Name, op: string, expr: Expr, value: Value): void {
    const variable = this.lookup(name.text.toLowerCase());
    if (variable?.texts === undefined) return;
    const first = leftmost(expr);
    const self = first.kind === 'name' && first.name.text.toLowerCase() === name.text.toLowerCase();
    const text = value.text ?? [hole(anchor(expr))];
    if (op === '+=' || (op === '=' && self && first !== expr)) {
      // `q += x` and `q = q + x` go on with the text. What `q` held keeps its places.
      const added =
        op === '+='
          ? text
          : text.filter(
              (piece) =>
                (piece.hole ? piece.origin : piece.origin.kind === 'word' ? piece.origin.name : undefined) !==
                (first.kind === 'name' ? first.name : undefined),
            );
      variable.texts = variable.texts.map((one) => [...one, ...added]);
    } else if (op === '=') {
      const empty = variable.texts.length === 1 && known(variable.texts[0]) === '';
      variable.texts = empty ? [text] : [...variable.texts, text];
    }
  }

  private dot(target: Value, name: Name, access: 'read' | 'write' | 'both', step: boolean): Value {
    const lower = name.text.toLowerCase();
    const type = target.type;
    switch (type.k) {
      case 'sobject':
        if (type.object !== undefined) return this.field(type.object, name, access, step);
        // The record is of an object the trial cannot name: behind a lookup whose target the project does not
        // describe, or a plain `SObject`. The field is real, its object is not known.
        if (lower !== 'id')
          this.unknown({ at: name.at, match: name.text }, 'A field of a record whose object is not known.');
        return VALUE;
      case 'class':
      case 'classRef': {
        const inner = type.k === 'classRef' ? type.cls.inner.get(lower) : undefined;
        if (inner !== undefined) return { type: { k: 'classRef', cls: inner } };
        const entry = this.findField(type.cls, lower);
        return entry === undefined ? VALUE : this.member(entry, name);
      }
      case 'objectRef': {
        const object = type.object.text;
        if (lower === 'sobjecttype') {
          const made = this.add({ at: type.object.at, match: object }, 'references', { object }, 'token', 'confirmed');
          return { type: { k: 'objectToken', object }, made };
        }
        if (lower === 'fields') return { type: { k: 'fieldsOf', object } };
        if (lower === 'fieldsets' || lower.endsWith('__r')) return VALUE;
        const made =
          lower === 'id'
            ? undefined
            : this.add(
                { at: name.at, match: name.text },
                'references',
                { object, field: name.text },
                'token',
                'confirmed',
              );
        return { type: { k: 'fieldToken', object, field: name.text }, made };
      }
      case 'namespace':
        if (type.name === 'schema') {
          if (lower === 'sobjecttype') return { type: { k: 'namespace', name: 'sobjecttype' } };
          return isObjectName(this.schema, name.text) ? { type: { k: 'objectRef', object: name } } : VALUE;
        }
        if (type.name === 'sobjecttype') {
          // `Schema.SObjectType.Invoice__c` names the object, unless a field follows.
          const made = this.add(
            { at: name.at, match: name.text },
            'references',
            { object: name.text },
            'token',
            'confirmed',
          );
          return { type: { k: 'describe', object: name.text }, made };
        }
        if (type.name === 'trigger') {
          const record: Type = { k: 'sobject', object: this.ctx.triggerObject };
          if (lower === 'new' || lower === 'old') return { type: { k: 'list', of: record } };
          if (lower === 'newmap' || lower === 'oldmap') return { type: { k: 'map', key: OTHER, value: record } };
        }
        return VALUE;
      case 'describe':
      case 'objectToken':
        // `Invoice__c.SObjectType.fields.Amount__c` names the field as `Schema.SObjectType.Invoice__c.fields` does.
        return lower === 'fields' ? { type: { k: 'fieldsOf', object: type.object }, made: target.made } : VALUE;
      case 'fieldsOf': {
        if (type.object === undefined) return { type: { k: 'fieldToken', object: undefined, field: name.text } };
        // The object only says whose field it is.
        this.retract(target.made);
        const made = this.add(
          { at: name.at, match: name.text },
          'references',
          { object: type.object, field: name.text },
          'token',
          'confirmed',
        );
        return { type: { k: 'fieldToken', object: type.object, field: name.text }, made };
      }
      default:
        return VALUE;
    }
  }

  /** A name after a record: a field, a step through a relationship, or a child relationship. */
  private field(object: string, name: Name, access: 'read' | 'write' | 'both', step: boolean): Value {
    const lower = name.text.toLowerCase();
    const place = { at: name.at, match: name.text };
    const report = (field: string): void => {
      if (access !== 'write') this.add(place, 'reads', { object, field }, 'field', 'confirmed');
      if (access !== 'read') this.add(place, 'writes', { object, field }, 'field', 'confirmed');
    };
    if (lower === 'id') return VALUE;
    const info = this.schema.objects.get(object.toLowerCase());
    if (lower.endsWith('__r')) {
      const child = info?.children.get(lower);
      if (child !== undefined) {
        this.add(place, 'references', { object: child.object, field: child.field }, 'field', 'confirmed');
        return { type: { k: 'list', of: { k: 'sobject', object: child.object } } };
      }
      const lookup = `${name.text.slice(0, -1)}c`;
      report(lookup);
      return { type: { k: 'sobject', object: info?.fields.get(lookup.toLowerCase())?.referenceTo } };
    }
    if (!lower.includes('__') && (step || isStandardRelationship(name.text)) && !lower.endsWith('id')) {
      // A standard relationship is written without the `Id` its field ends in.
      report(`${name.text}Id`);
      return { type: { k: 'sobject', object: standardTarget(object, name.text) } };
    }
    report(name.text);
    return VALUE;
  }

  private invoke(expr: Extract<Expr, { kind: 'call' }>): Value {
    const method = expr.name.text.toLowerCase();
    const args = expr.args;
    const rest = (from: number): void => {
      for (const arg of args.slice(from)) this.ev(arg);
    };
    if (expr.target === undefined) {
      rest(0);
      const cls = this.ctx.cls;
      if (cls === undefined) return VALUE;
      if (method === 'this') this.call(cls, '<init>', args.length);
      const base = method === 'super' ? this.superOf(cls) : undefined;
      if (base !== undefined) this.call(base, '<init>', args.length);
      return this.returned(this.call(cls, method, args.length));
    }
    const target = this.ev(expr.target);
    const type = target.type;
    switch (type.k) {
      case 'sobject':
        if ((method === 'get' || method === 'put') && args[0] !== undefined) {
          this.byName(type.object, args[0], method === 'get' ? 'reads' : 'writes');
          rest(1);
          return VALUE;
        }
        rest(0);
        if (method === 'clone') return { type };
        if (method === 'getsobjecttype') return { type: { k: 'objectToken', object: type.object } };
        return VALUE;
      case 'list':
        rest(0);
        if (method === 'get' || method === 'remove') return { type: type.of };
        if (method === 'clone' || method === 'deepclone') return { type };
        return VALUE;
      case 'map':
        rest(0);
        if (method === 'get' || method === 'remove') return { type: type.value };
        if (method === 'values') return { type: { k: 'list', of: type.value } };
        if (method === 'keyset') return { type: { k: 'list', of: type.key } };
        if (method === 'clone' || method === 'deepclone') return { type };
        return VALUE;
      case 'class':
      case 'classRef':
        rest(0);
        return this.returned(this.call(type.cls, method, args.length));
      case 'objectMap': {
        if (method !== 'get' || args[0] === undefined) {
          rest(0);
          return VALUE;
        }
        // `Schema.getGlobalDescribe().get('Invoice__c')` names the object in text.
        const object = known(this.ev(args[0]).text);
        const place = this.placeOf(this.ev(args[0]), args[0]);
        if (object === undefined) this.unknown(place, 'The name of the object is not known.');
        else this.add(place, 'references', { object }, 'text', 'probable');
        return { type: { k: 'objectToken', object } };
      }
      case 'objectRef': {
        // The methods of a custom setting give its records: `Settings__c.getOrgDefaults().Limit__c`.
        rest(0);
        const record: Type = { k: 'sobject', object: type.object.text };
        if (method === 'getinstance' || method === 'getorgdefaults' || method === 'getvalues') return { type: record };
        if (method === 'getall') return { type: { k: 'map', key: STRING, value: record } };
        return VALUE;
      }
      case 'objectToken':
        rest(0);
        if (method === 'getdescribe') return { type: { k: 'describe', object: type.object } };
        if (method === 'newsobject') return { type: { k: 'sobject', object: type.object } };
        return VALUE;
      case 'describe':
        rest(0);
        return method === 'getsobjecttype' ? { type: { k: 'objectToken', object: type.object } } : VALUE;
      case 'fieldsOf':
        rest(0);
        return method === 'getmap' ? { type: { k: 'fieldMap', object: type.object } } : VALUE;
      case 'fieldMap': {
        if (method !== 'get' || args[0] === undefined) {
          rest(0);
          return VALUE;
        }
        const value = this.ev(args[0]);
        const field = known(value.text);
        const place = this.placeOf(value, args[0]);
        if (type.object === undefined) {
          this.unknown(place, 'A field token by name, of an object that is not known.');
        } else if (field === undefined) {
          this.add(place, 'references', { object: type.object }, 'text', 'possible');
        } else {
          this.add(place, 'references', { object: type.object, field }, 'text', 'probable');
        }
        return { type: { k: 'fieldToken', object: type.object, field } };
      }
      case 'fieldToken':
        rest(0);
        return method === 'getdescribe' ? { type } : VALUE;
      case 'namespace':
        return this.system(type.name, expr);
      default:
        rest(0);
        return VALUE;
    }
  }

  private returned(methods: readonly MethodEntry[]): Value {
    const types = methods.map((entry) => this.resolveType(entry.returns, entry.owner));
    const first = types[0];
    if (first === undefined) return VALUE;
    // Overloads that return different types cannot be told apart without the types of the arguments.
    return types.every(
      (type) =>
        JSON.stringify(type, (key, value: unknown) => (key === 'cls' ? undefined : value)) ===
        JSON.stringify(first, (key, value: unknown) => (key === 'cls' ? undefined : value)),
    )
      ? { type: first }
      : VALUE;
  }

  /** A method of `Schema`, `Database` or `String`. */
  private system(namespace: string, expr: Extract<Expr, { kind: 'call' }>): Value {
    const method = expr.name.text.toLowerCase();
    const args = expr.args;
    const first = args[0];
    if (namespace === 'database' && first !== undefined) {
      if (DATABASE_QUERIES.has(method)) {
        this.dynamic(first);
        for (const arg of args.slice(1)) this.ev(arg);
        return { type: { k: 'list', of: { k: 'sobject', object: undefined } } };
      }
      const op = DATABASE_DML.get(method);
      if (op !== undefined) {
        const records = this.ev(first);
        const object = Resolver.objectOf(records.type);
        if (object !== undefined) {
          this.add({ at: expr.name.at, match: expr.name.text }, 'writes', { object }, 'dml', 'confirmed', op);
        }
        const second = args[1];
        if (op === 'upsert' && second !== undefined) {
          // The field that says which record is which: a field token, here or in a constant.
          const token = this.ev(second);
          if (token.type.k === 'fieldToken' && token.type.object !== undefined && token.type.field !== undefined) {
            const word = anchor(second);
            this.add(
              word === undefined ? undefined : { at: word.at, match: word.text },
              'references',
              { object: token.type.object, field: token.type.field },
              'token',
              'confirmed',
            );
          }
          for (const arg of args.slice(2)) this.ev(arg);
        } else {
          for (const arg of args.slice(1)) this.ev(arg);
        }
        return VALUE;
      }
    }
    if (namespace === 'string' && method === 'join' && first !== undefined) {
      const list = this.ev(first).list;
      const between = args[1] === undefined ? undefined : this.ev(args[1]).text;
      if (list === undefined || between === undefined || list.some((item) => item.text === undefined)) {
        return { type: STRING, text: [hole(anchor(first))] };
      }
      const text: Piece[] = [];
      list.forEach((item, index) => {
        if (index > 0) text.push(...between);
        text.push(...(item.text ?? []));
      });
      return { type: STRING, text };
    }
    for (const arg of args) this.ev(arg);
    if (namespace === 'schema' && method === 'getglobaldescribe') return { type: { k: 'objectMap' } };
    if (namespace === 'string' && (method === 'valueof' || method === 'escapesinglequotes' || method === 'format')) {
      return { type: STRING, text: [hole(anchor(first))] };
    }
    return VALUE;
  }

  /** Where a name that an expression gives as text stands: inside its literal, or at the word that holds it. */
  private placeOf(value: Value, expr: Expr): { at: Pos; match: string } | undefined {
    const piece = value.text?.length === 1 ? value.text[0] : undefined;
    if (piece !== undefined && !piece.hole && piece.origin.kind === 'literal') {
      const { at, map } = piece.origin;
      return { at: { line: at.line, column: at.column + 1 + (map[0] ?? 0) }, match: piece.value };
    }
    const word = anchor(expr);
    return word === undefined ? undefined : { at: word.at, match: word.text };
  }

  /** `record.get(x)` and `record.put(x, value)`: the field is named by a text or by a token. */
  private byName(object: string | undefined, arg: Expr, kind: 'reads' | 'writes'): void {
    const value = this.ev(arg);
    const place = this.placeOf(value, arg);
    if (value.type.k === 'fieldToken') {
      // The token names its own object, so the type of the record does not matter.
      this.retract(value.made);
      const { object: owner, field } = value.type;
      if (owner === undefined || field === undefined) this.unknown(place, 'A field token whose field is not known.');
      else this.add(place, kind, { object: owner, field }, 'token', 'confirmed');
      return;
    }
    if (object === undefined) {
      this.unknown(place, 'A field by name, on a record whose object is not known.');
      return;
    }
    const field = known(value.text);
    if (field === undefined) this.add(place, kind, { object }, 'text', 'possible');
    else this.add(place, kind, { object, field }, 'text', 'probable');
  }

  // -------------------------------------------------------------- queries

  /** A query built as text: `Database.query(...)` and the methods like it. */
  private dynamic(arg: Expr): void {
    let texts: Text[];
    const variable = arg.kind === 'name' ? this.lookup(arg.name.text.toLowerCase()) : undefined;
    if (variable?.texts !== undefined) {
      // The variable is the whole query. Its names stand where the method built it.
      texts = variable.texts;
    } else {
      const value = this.ev(arg);
      if (value.text === undefined) {
        // An inline query, as in `Database.getQueryLocator([SELECT ...])`, was read as it was evaluated.
        if (value.type.k !== 'string') return;
        texts = [[hole(anchor(arg))]];
      } else {
        texts = [value.text];
      }
    }
    for (const text of texts) this.readText(text);
  }

  private readText(text: Text): void {
    if (this.ctx.quiet) return;
    this.dynamicFound += 1;
    let source = '';
    const segments: { start: number; end: number; piece: Piece }[] = [];
    text.forEach((piece, index) => {
      const part = piece.hole ? `zqh${String(index)}qz` : piece.value.replace(/[\r\n\t]/g, ' ');
      segments.push({ start: source.length, end: source.length + part.length, piece });
      source += part;
    });
    if (text.every((piece) => piece.hole)) {
      const word = text[0]?.origin;
      this.unknown(
        word === undefined ? undefined : { at: word.at, match: word.text },
        'A query whose text is not known here.',
      );
      return;
    }
    const locate = (name: Name): Place | undefined => {
      const marked = HOLE_MARK.exec(name.text);
      if (marked !== null) {
        const origin = text[Number(marked[1])]?.origin;
        return origin === undefined || !('text' in origin)
          ? undefined
          : { at: origin.at, match: origin.text, hole: true };
      }
      const offset = name.at.column - 1;
      const segment = segments.find((one) => offset >= one.start && offset < one.end);
      if (segment === undefined || segment.piece.hole || offset + name.text.length > segment.end) return undefined;
      const origin = segment.piece.origin;
      if (origin.kind === 'word') return { at: origin.name.at, match: origin.name.text, hole: false };
      const inLiteral = origin.map[offset - segment.start] ?? 0;
      return { at: { line: origin.at.line, column: origin.at.column + 1 + inLiteral }, match: name.text, hole: false };
    };
    const mode: QueryMode = { via: 'text', tier: 'probable', dynamic: true, locate };
    const query = this.adapter.parseQuery(source);
    if (query !== undefined) {
      this.query(query, undefined, false, mode);
      return;
    }
    // The parser cannot read the text. The object after FROM is still looked for.
    this.dynamicUnread += 1;
    const from = /\bfrom\s+([a-z0-9_]+)/i.exec(source);
    if (from?.[1] === undefined) return;
    const place = locate({ text: from[1], at: { line: 1, column: from.index + from[0].length - from[1].length + 1 } });
    if (place !== undefined && !place.hole) this.add(place, 'reads', { object: from[1] }, 'text', 'probable');
  }

  /** Reads a query. Returns the object it selects from, if that is known. */
  private query(query: Query, parent: string | undefined, child: boolean, mode: QueryMode): string | undefined {
    const name = child ? query.from.at(-1) : query.from[0];
    const place = name === undefined ? undefined : mode.locate(name);
    let object: string | undefined;
    if (name !== undefined && place !== undefined) {
      if (place.hole) {
        this.unknown(place, 'The object of the query is not known.');
      } else if (!child) {
        object = name.text;
        this.add(place, 'reads', { object }, mode.via, mode.tier);
      } else if (parent !== undefined) {
        // A sub-query selects from a child relationship: the lookup field that defines it, and its object.
        const relationship = this.schema.objects.get(parent.toLowerCase())?.children.get(name.text.toLowerCase());
        if (relationship === undefined) {
          this.unknown(place, 'A child relationship that no field of the project defines.');
        } else {
          object = relationship.object;
          this.add(place, 'references', { object, field: relationship.field }, mode.via, mode.tier);
          this.add(place, 'reads', { object }, mode.via, mode.tier);
        }
      }
    }
    const unknownObject = name !== undefined && place?.hole === true;
    for (const path of query.fields) this.path(object, path, query.alias, mode, unknownObject);
    for (const sub of query.children) this.query(sub, object, true, mode);
    for (const sub of query.nested) this.query(sub, undefined, false, mode);
    for (const typeOf of query.typeOfs) {
      const relationship = typeOf.relationship.at(-1);
      const at = relationship === undefined ? undefined : mode.locate(relationship);
      if (object !== undefined && relationship !== undefined && at !== undefined && !at.hole) {
        const field = relationship.text.toLowerCase().endsWith('__r')
          ? `${relationship.text.slice(0, -1)}c`
          : `${relationship.text}Id`;
        this.add(at, 'reads', { object, field }, mode.via, mode.tier);
      }
      for (const when of typeOf.whens) {
        const whenAt = mode.locate(when.object);
        if (whenAt === undefined || whenAt.hole) continue;
        this.add(whenAt, 'reads', { object: when.object.text }, mode.via, mode.tier);
        for (const path of when.fields) this.path(when.object.text, path, undefined, mode, false);
      }
    }
    if (!mode.dynamic) for (const bind of query.binds) this.ev(bind);
    return object;
  }

  /** A path of names in a query, from an object: steps through relationships, then a field. */
  private path(
    object: string | undefined,
    path: FieldPath,
    alias: string | undefined,
    mode: QueryMode,
    unknownObject: boolean,
  ): void {
    const names = [...path];
    const first = names[0]?.text.toLowerCase();
    if (names.length > 1 && first !== undefined && (first === alias || first === object?.toLowerCase())) names.shift();
    let current = object;
    for (const [index, name] of names.entries()) {
      const place = mode.locate(name);
      if (place === undefined) return;
      if (current === undefined) {
        // In a query built as text, a name whose object is not known is said to be unknown. So is a name behind
        // a relationship whose target the project does not describe.
        if (unknownObject && index === 0) this.unknown(place, 'A field of a query whose object is not known.');
        else if (index > 0 && !place.hole)
          this.unknown(place, 'A field behind a relationship whose target is not known.');
        return;
      }
      if (place.hole) {
        this.add(place, 'reads', { object: current }, mode.via, 'possible');
        return;
      }
      const lower = name.text.toLowerCase();
      if (index < names.length - 1) {
        if (lower.endsWith('__r')) {
          const lookup = `${name.text.slice(0, -1)}c`;
          this.add(place, 'reads', { object: current, field: lookup }, mode.via, mode.tier);
          current = this.schema.objects.get(current.toLowerCase())?.fields.get(lookup.toLowerCase())?.referenceTo;
        } else {
          this.add(place, 'reads', { object: current, field: `${name.text}Id` }, mode.via, mode.tier);
          current = standardTarget(current, name.text);
        }
      } else if (lower !== 'id' && !lower.endsWith('__r')) {
        this.add(place, 'reads', { object: current, field: name.text }, mode.via, mode.tier);
      }
    }
  }

  private search(search: Search): void {
    const mode: QueryMode = { ...STATIC_SOQL, via: 'sosl' };
    for (const returned of search.returning) {
      const object = returned.object.text;
      this.add({ at: returned.object.at, match: object }, 'reads', { object }, 'sosl', 'confirmed');
      for (const path of returned.fields) this.path(object, path, undefined, mode, false);
    }
    for (const bind of search.binds) this.ev(bind);
  }

  // -------------------------------------------------------------- the members of a file

  private members(
    file: string,
    cls: ClassInfo | undefined,
    members: readonly Member[],
    keyOf: (sub?: SubComponent) => ComponentKey,
    triggerObject?: string,
  ): void {
    for (const member of members) {
      if (member.kind === 'type') {
        const inner = cls?.inner.get(member.decl.name.text.toLowerCase());
        if (inner !== undefined) this.type(file, inner, member.decl);
      } else if (member.kind === 'method') {
        const signature = apexSignature(member.params.map((param) => typeText(param.type)));
        const sub: SubComponent = member.ctor
          ? { kind: 'ctor', name: signature }
          : { kind: 'method', name: `${member.name.text}${signature}` };
        this.ctx = this.context(file, keyOf(sub), cls, triggerObject, member.body);
        for (const param of member.params) this.bind(param.name, this.resolveType(param.type, cls), undefined, true);
        this.stmt(member.body);
      } else if (member.kind === 'field') {
        for (const declared of member.vars) {
          if (declared.init === undefined) continue;
          this.ctx = this.context(
            file,
            keyOf({ kind: 'var', name: declared.name.text }),
            cls,
            triggerObject,
            undefined,
          );
          this.ev(declared.init);
        }
      } else if (member.kind === 'property') {
        this.ctx = this.context(
          file,
          keyOf({ kind: 'prop', name: member.name.text }),
          cls,
          triggerObject,
          member.accessors,
        );
        // The setter of a property receives the new value under this name.
        this.bind({ text: 'value', at: member.name.at }, this.resolveType(member.type, cls), undefined, true);
        for (const accessor of member.accessors) this.stmt(accessor);
      } else {
        this.ctx = this.context(file, keyOf(), cls, triggerObject, member.body);
        this.stmt(member.body);
      }
    }
  }

  private type(file: string, cls: ClassInfo, decl: TypeDecl): void {
    const keyOf = (sub?: SubComponent): ComponentKey => this.key(cls, sub);
    if (decl.extends !== undefined) {
      const base = this.superOf(cls);
      if (base !== undefined) {
        this.ctx = this.context(file, keyOf(), cls, undefined, undefined);
        const word = decl.extends.name.split('.').at(0) ?? decl.extends.name;
        this.add({ at: decl.extends.at, match: word }, 'extends', this.key(base), 'declaration', 'confirmed');
      }
    }
    this.members(file, cls, decl.members, keyOf);
  }

  analyse(files: readonly SourceFile[]): Analysis {
    const indexed = new Map<TypeDecl, ClassInfo>();
    for (const file of files) for (const decl of file.unit.types) indexed.set(decl, this.index(decl, undefined));
    for (const file of files) {
      for (const decl of file.unit.types) {
        const cls = indexed.get(decl);
        if (cls !== undefined) this.type(file.path, cls, decl);
      }
      const trigger = file.unit.trigger;
      if (trigger === undefined || trigger.name.text === '') continue;
      const keyOf = (sub?: SubComponent): ComponentKey =>
        buildKey({ type: 'ApexTrigger', fullName: trigger.name.text, subs: sub === undefined ? [] : [sub] });
      const object = trigger.object.text;
      this.ctx = this.context(file.path, keyOf(), undefined, object, trigger.body);
      this.add({ at: trigger.object.at, match: object }, 'triggers-on', { object }, 'declaration', 'confirmed');
      for (const stmt of trigger.body) this.stmt(stmt);
      this.members(file.path, undefined, trigger.members, keyOf, object);
    }
    const order = (a: { file: string; line: number; column: number }, b: typeof a): number =>
      a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.column - b.column;
    return {
      references: [...this.found.values()].sort(order),
      unknowns: [...this.unknowns.values()].sort(order),
      calls: [...this.calls.values()],
      dynamicQueries: { found: this.dynamicFound, unread: this.dynamicUnread },
    };
  }
}

const STATIC_SOQL: QueryMode = {
  via: 'soql',
  tier: 'confirmed',
  dynamic: false,
  locate: (name) => ({ at: name.at, match: name.text, hole: false }),
};

/** Calls `visit` for every expression of a statement, also the ones inside other expressions and inside queries. */
function eachExpr(stmt: Stmt | undefined, visit: (expr: Expr) => void): void {
  if (stmt === undefined) return;
  const expr = (one: Expr | undefined): void => {
    if (one === undefined) return;
    visit(one);
    switch (one.kind) {
      case 'dot':
        expr(one.target);
        break;
      case 'call':
        expr(one.target);
        one.args.forEach(expr);
        break;
      case 'new':
        one.args.forEach(expr);
        break;
      case 'collection':
        one.elements.forEach(expr);
        for (const pair of one.pairs) {
          expr(pair.key);
          expr(pair.value);
        }
        break;
      case 'cast':
      case 'instanceof':
        expr(one.expr);
        break;
      case 'assign':
      case 'binary':
        expr(one.left);
        expr(one.right);
        break;
      case 'unary':
        expr(one.operand);
        break;
      case 'ternary':
        expr(one.cond);
        expr(one.then);
        expr(one.else);
        break;
      case 'index':
        expr(one.target);
        expr(one.index);
        break;
      case 'soql':
        one.query.binds.forEach(expr);
        break;
      case 'sosl':
        one.search.binds.forEach(expr);
        break;
      case 'unknown':
        one.parts.forEach(expr);
        break;
      default:
    }
  };
  const each = (one: Stmt | undefined): void => {
    eachExpr(one, visit);
  };
  switch (stmt.kind) {
    case 'block':
      stmt.stmts.forEach(each);
      break;
    case 'local':
      for (const one of stmt.vars) expr(one.init);
      break;
    case 'expr':
    case 'throw':
    case 'return':
      expr(stmt.expr);
      break;
    case 'if':
      expr(stmt.cond);
      each(stmt.then);
      each(stmt.else);
      break;
    case 'for':
      stmt.init.forEach(each);
      expr(stmt.cond);
      stmt.update.forEach(expr);
      each(stmt.body);
      break;
    case 'foreach':
      expr(stmt.iterable);
      each(stmt.body);
      break;
    case 'while':
      expr(stmt.cond);
      each(stmt.body);
      break;
    case 'try':
      each(stmt.block);
      for (const clause of stmt.catches) each(clause.block);
      each(stmt.finally);
      break;
    case 'switch':
      expr(stmt.on);
      for (const when of stmt.whens) each(when.block);
      break;
    case 'dml':
      stmt.targets.forEach(expr);
      break;
    case 'runas':
      stmt.args.forEach(expr);
      each(stmt.block);
      break;
    case 'other':
      break;
  }
}

/** Finds the references of the Apex files of a project. */
export function analyse(files: readonly SourceFile[], schema: Schema, adapter: SyntaxAdapter): Analysis {
  return new Resolver(schema, adapter).analyse(files);
}
