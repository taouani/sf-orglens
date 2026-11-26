/**
 * What the code of Apex refers to (decision record 0087): the fields of records it reads and writes, also through
 * relationships, the variables and properties of classes, the tokens of objects and fields, and the objects that DML
 * writes.
 *
 * It runs once every class and trigger was read (`apex.ts`), on the declarations the reader kept: an index of the
 * classes of the snapshot with the declared types of their variables, properties and methods, the classes they
 * extend and the classes around them. A member is read with its scopes: a name is a local variable or a parameter,
 * then a variable or a property of its class, of a class it extends or of a class around it, then a class, then an
 * object, then a namespace of Salesforce. The type of each expression is worked out as far as the declarations say,
 * and nothing is guessed beyond them.
 *
 * A name of an object or a field is checked against the files and the descriptions of the snapshot
 * (`apex-schema.ts`). One that nothing checks is `probable`. What cannot be resolved has a warning, and nothing is
 * dropped without one where the code shows that it refers to something: a relationship whose end is not known, a
 * name of a relationship that is guessed, a name the org did not describe, and DML on records of no known object.
 *
 * Queries and searches, calls and names in texts are read by later parts of work package 4 and by work package 5.
 * The type of the records a query gives is known here.
 */
import { foldName, type ComponentKey } from '../core/keys.ts';
import { validateReference, type ConfidenceTier, type Reference } from '../core/references.ts';
import { cut, type AnalysisIssue } from './analysed.ts';
import { MOST_NAMES_SHOWN } from './raw-references.ts';
import type { ApexPart, ApexTypes } from './apex.ts';
import type { ApexSchema, Checked } from './apex-schema.ts';
import type { Expr, Name, Param, Stmt, TypeRef } from './apex-syntax.ts';

/** A class or a trigger of the snapshot, with the parts of it that are components. */
export interface ApexUnitInput {
  readonly key: ComponentKey;
  readonly type: 'ApexClass' | 'ApexTrigger';
  readonly file: string;
  /** The class or the trigger first, then each member after the type it stands in, as `readApexUnit` gives them. */
  readonly parts: readonly { readonly key: ComponentKey; readonly part: ApexPart }[];
}

export interface ApexResolver {
  /**
   * What the member of this key refers to beyond the types it uses, and the warnings about it. Empty for a class,
   * an interface and an enum themselves, and for a key the resolver was not given.
   */
  resolve(key: ComponentKey): { readonly references: Reference[]; readonly issues: AnalysisIssue[] };
}

// ---------------------------------------------------------------- the classes of the snapshot

interface UnitInfo {
  readonly key: ComponentKey;
  readonly type: 'ApexClass' | 'ApexTrigger';
  readonly file: string;
  /** The object of a trigger. */
  readonly object: string | undefined;
}

interface ClassInfo {
  readonly key: ComponentKey;
  readonly kind: 'class' | 'interface' | 'enum' | 'trigger';
  readonly unit: UnitInfo;
  readonly outer: ClassInfo | undefined;
  readonly extends: TypeRef | undefined;
  /** The variables and properties, by folded name. */
  readonly vars: Map<string, VarInfo>;
  /** The methods by folded name, and the constructors under the name `<init>`. */
  readonly methods: Map<string, MethodInfo[]>;
  /** The classes, interfaces and enums it declares, by folded name. */
  readonly inner: Map<string, ClassInfo>;
}

interface VarInfo {
  readonly key: ComponentKey;
  readonly owner: ClassInfo;
  readonly type: TypeRef;
  /** `static final`: a constant, whose value is followed where it is used. */
  readonly constant: boolean;
  readonly init: Expr | undefined;
  /** The type of the value of a constant, once it was worked out. */
  value: Type | 'working' | undefined;
}

interface MethodInfo {
  readonly params: readonly Param[];
  readonly returns: TypeRef | undefined;
}

/** A member of a class or a trigger that has a body to read, with what holds it. */
interface MemberInfo {
  readonly part: ApexPart;
  /** The class or the trigger it stands in, or the class itself for a type. */
  readonly holder: ClassInfo;
}

// ---------------------------------------------------------------- types and values

type Type =
  /** A record. `object` is `undefined` for `SObject` and where it is not known which object a record is of. */
  | {
      readonly k: 'record';
      readonly object: string | undefined;
      /** The relationship the record was reached through, where it leads to no known object. */
      readonly through?: Through;
    }
  | { readonly k: 'list'; readonly of: Type }
  | { readonly k: 'map'; readonly key: Type; readonly value: Type }
  /** A value of a class of the snapshot. */
  | { readonly k: 'instance'; readonly cls: ClassInfo }
  /** The class itself, as in `InvoiceConstants.AMOUNT`. */
  | { readonly k: 'static'; readonly cls: ClassInfo }
  /** The name of an object in an expression, as in `Invoice__c.Amount__c` and `Billing_Settings__c.getInstance()`. */
  | { readonly k: 'object'; readonly name: Name }
  | { readonly k: 'ns'; readonly name: Namespace }
  | { readonly k: 'objectToken'; readonly object: string | undefined }
  | { readonly k: 'fieldToken'; readonly object: string | undefined; readonly field: string | undefined }
  | { readonly k: 'describe'; readonly object: string | undefined }
  /** `fields` of a describe: the next name is a field of the object. */
  | { readonly k: 'fields'; readonly object: string | undefined }
  /**
   * A type of Salesforce or of a package that is no class of the snapshot, no object the analysis knows and no
   * primitive type (`Id`, `String`). Only an object can be written by DML or made with the values of its fields, so
   * what DML writes or such a `new` makes is an object of this name, as `PermissionSet`. Anything else of it gives
   * nothing, as any type of Salesforce.
   */
  | { readonly k: 'named'; readonly name: string }
  /**
   * What stands after a relationship that leads to no known object, as `Owner.Name` of `task.What.Owner.Name`: each
   * name joins the warning that the path was not followed, at the place of the relationship.
   */
  | { readonly k: 'beyond'; readonly through: Through; readonly names: readonly string[] }
  | { readonly k: 'other' };

interface Through {
  readonly name: Name;
  readonly object: string;
}

type Namespace = 'schema' | 'sobjecttype' | 'trigger' | 'database' | 'eventbus';
const NAMESPACES: ReadonlySet<string> = new Set<Namespace>(['schema', 'trigger', 'database', 'eventbus']);

interface Value {
  readonly type: Type;
  /** The references a field token made, which `get` and `put` replace with a read and a write. */
  readonly made?: readonly string[];
  /**
   * A name of Salesforce that nothing checks, read as a field. Where the code uses it as a list, it is a child
   * relationship, whose object is not known.
   */
  readonly maybeChild?: { readonly object: string; readonly name: Name; readonly made: readonly string[] };
}

const OTHER: Type = { k: 'other' };
const VALUE: Value = { type: OTHER };

type Access = 'read' | 'write' | 'both';

/**
 * The methods of a list that show that a value is a list: the child relationship of a record is one. A value of a
 * field has none of them, also a text, which has `contains`, `indexOf` and `remove` and so is told by these alone.
 * A record has `clear` and `get` too: `get` with a text or a token is the method of a record (`Resolver.invoke`).
 */
const LIST_METHODS: ReadonlySet<string> = new Set([
  'add',
  'addall',
  'deepclone',
  'get',
  'isempty',
  'iterator',
  'set',
  'size',
  'sort',
]);

/**
 * The primitive types of Apex, which are never objects: `Database.delete(ids)` with a list of `Id` deletes records of
 * an object that nothing says.
 */
const PRIMITIVES: ReadonlySet<string> = new Set([
  'blob',
  'boolean',
  'date',
  'datetime',
  'decimal',
  'double',
  'id',
  'integer',
  'long',
  'object',
  'string',
  'time',
]);

/** The methods of a list, a set or a map whose first argument is a list, a set or a map as well. */
const OF_LISTS: ReadonlySet<string> = new Set(['addall', 'containsall', 'putall', 'removeall', 'retainall']);

/** The methods of `Database` that write records, with what they do. */
const DATABASE_DML: ReadonlyMap<string, string> = new Map(
  ['insert', 'update', 'upsert', 'delete', 'undelete', 'merge'].flatMap((op) => [
    [op, op],
    [`${op}immediate`, op],
    [`${op}async`, op],
  ]),
);

/** The methods of `Database` that run a query, whose records are of no object known here. */
const DATABASE_QUERIES: ReadonlySet<string> = new Set(['query', 'querywithbinds', 'getcursor', 'getcursorwithbinds']);

/** The methods of a custom setting and of a custom metadata type that give a record, and one that gives a map. */
const RECORD_METHODS: ReadonlySet<string> = new Set(['getinstance', 'getorgdefaults', 'getvalues']);

const wordsOf = (name: string): string[] => name.replace(/\s+/g, '').split('.');
const pathOf = (subs: ApexPart['subs']): string => subs.map((sub) => `${sub.kind}:${foldName(sub.name)}`).join('/');

/** The word that stands for an expression, if one does: the last name of `InvoiceConstants.EXTERNAL_ID`. */
function anchor(expr: Expr | undefined): Name | undefined {
  if (expr === undefined) return undefined;
  if (expr.kind === 'name') return expr.name;
  if (expr.kind === 'dot' || expr.kind === 'call') return expr.name;
  if (expr.kind === 'cast') return anchor(expr.expr);
  return undefined;
}

/** How often a body assigns to each name, by folded name. A local variable that is never assigned keeps its value. */
function assignments(bodies: readonly (Stmt | Expr | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (expr: Expr): void => {
    const target =
      expr.kind === 'assign'
        ? expr.left
        : expr.kind === 'unary' && (expr.op.includes('++') || expr.op.includes('--'))
          ? expr.operand
          : undefined;
    if (target?.kind === 'name') {
      const name = foldName(target.name.text);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  };
  for (const body of bodies) eachExpr(body, visit);
  return counts;
}

// ---------------------------------------------------------------- reading a member

interface Local {
  readonly type: Type;
}

interface Scope {
  readonly vars: Map<string, Local>;
  readonly parent: Scope | undefined;
}

interface Context {
  /** The member the references start from. */
  readonly from: ComponentKey;
  readonly unit: UnitInfo;
  readonly cls: ClassInfo;
  /** How often the body assigns to a name. */
  readonly assigned: ReadonlyMap<string, number>;
  /** Nothing is reported: the value of a constant is worked out for a use somewhere else. */
  readonly quiet: boolean;
  /** The type of what the body gives back: of a method, of the getter of a property, of a variable it sets. */
  readonly returns: Type;
  scope: Scope;
}

class Resolver implements ApexResolver {
  private readonly members = new Map<ComponentKey, MemberInfo>();
  private readonly classes = new Map<string, ClassInfo>();
  private readonly schema: ApexSchema;
  private readonly types: ApexTypes;
  private ctx: Context | undefined;
  private found = new Map<string, Reference>();
  private issues: AnalysisIssue[] = [];
  private issueIds = new Set<string>();

  constructor(units: readonly ApexUnitInput[], schema: ApexSchema, types: ApexTypes) {
    this.schema = schema;
    this.types = types;
    for (const unit of units) this.index(unit);
  }

  private index(input: ApexUnitInput): void {
    const [first] = input.parts;
    if (first === undefined) return;
    const object = first.part.syntax.kind === 'trigger' ? first.part.syntax.trigger.object.text : undefined;
    const unit: UnitInfo = { key: input.key, type: input.type, file: input.file, object };
    const byPath = new Map<string, ClassInfo>();
    for (const { key, part } of input.parts) {
      const { syntax } = part;
      if (syntax.kind === 'type' || syntax.kind === 'trigger') {
        const outer = part.subs.length === 0 ? undefined : byPath.get(pathOf(part.subs.slice(0, -1)));
        if (part.subs.length > 0 && outer === undefined) continue;
        const info: ClassInfo = {
          key,
          kind: syntax.kind === 'trigger' ? 'trigger' : syntax.decl.kind,
          unit,
          outer,
          extends: syntax.kind === 'type' && syntax.decl.kind === 'class' ? syntax.decl.extends[0] : undefined,
          vars: new Map(),
          methods: new Map(),
          inner: new Map(),
        };
        byPath.set(pathOf(part.subs), info);
        if (syntax.kind === 'type') {
          if (outer === undefined) {
            if (input.type === 'ApexClass' && !this.classes.has(foldName(syntax.decl.name.text))) {
              this.classes.set(foldName(syntax.decl.name.text), info);
            }
          } else outer.inner.set(foldName(syntax.decl.name.text), info);
        }
        this.members.set(key, { part, holder: info });
        continue;
      }
      const holder = byPath.get(pathOf(part.subs.slice(0, -1)));
      if (holder === undefined) continue;
      this.members.set(key, { part, holder });
      if (syntax.kind === 'var') {
        const { member, declarator } = syntax;
        holder.vars.set(foldName(declarator.name.text), {
          key,
          owner: holder,
          type: member.type,
          constant: member.static && member.final,
          init: declarator.init,
          value: undefined,
        });
      } else if (syntax.kind === 'property') {
        const { member } = syntax;
        holder.vars.set(foldName(member.name.text), {
          key,
          owner: holder,
          type: member.type,
          constant: false,
          init: undefined,
          value: undefined,
        });
      } else if (syntax.kind === 'method') {
        const { member } = syntax;
        const name = member.ctor ? '<init>' : foldName(member.name.text);
        holder.methods.set(name, [
          ...(holder.methods.get(name) ?? []),
          { params: member.params, returns: member.returns },
        ]);
      }
    }
  }

  resolve(key: ComponentKey): { references: Reference[]; issues: AnalysisIssue[] } {
    const member = this.members.get(key);
    if (member === undefined) return { references: [], issues: [] };
    this.found = new Map();
    this.issues = [];
    this.issueIds = new Set();
    const { part, holder } = member;
    const { syntax } = part;
    const enter = (bodies: readonly (Stmt | Expr | undefined)[], returns?: TypeRef): void => {
      this.ctx = {
        from: key,
        unit: holder.unit,
        cls: holder,
        assigned: assignments(bodies),
        quiet: false,
        returns: this.resolveType(returns, holder),
        scope: { vars: new Map(), parent: undefined },
      };
    };
    switch (syntax.kind) {
      case 'type':
        break;
      case 'trigger':
        enter(syntax.trigger.body);
        for (const stmt of syntax.trigger.body) this.stmt(stmt);
        break;
      case 'method': {
        const { member: method } = syntax;
        enter([method.body], method.returns);
        for (const param of method.params) this.bind(param.name, this.resolveType(param.type, holder));
        this.stmt(method.body);
        break;
      }
      case 'property': {
        const { member: property } = syntax;
        enter(property.accessors, property.type);
        // The setter of a property is given the new value under this name.
        this.bind({ text: 'value', at: property.name.at }, this.resolveType(property.type, holder));
        for (const accessor of property.accessors) this.stmt(accessor);
        break;
      }
      case 'var':
        enter([syntax.declarator.init], syntax.member.type);
        if (syntax.declarator.init !== undefined) this.given(this.ev(syntax.declarator.init), this.context.returns);
        break;
      case 'init':
        enter(syntax.bodies);
        for (const body of syntax.bodies) this.stmt(body);
        break;
    }
    this.ctx = undefined;
    const references = [...this.found.values()].sort(
      (a, b) =>
        (a.location?.line ?? 0) - (b.location?.line ?? 0) ||
        (a.location?.column ?? 0) - (b.location?.column ?? 0) ||
        (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
        (String(a.to) < String(b.to) ? -1 : String(a.to) > String(b.to) ? 1 : 0),
    );
    return { references, issues: this.issues };
  }

  private get context(): Context {
    if (this.ctx === undefined) throw new Error('A member of Apex is read outside of a context.');
    return this.ctx;
  }

  // -------------------------------------------------------------- classes and types

  /** The class a dotted name stands for, seen from `from`: an inner class, a class around it, or a class. */
  private findClass(words: readonly string[], from: ClassInfo | undefined): ClassInfo | 'opaque' | undefined {
    const [first, ...rest] = words.map(foldName);
    if (first === undefined) return undefined;
    let start: ClassInfo | undefined;
    for (let at = from; at !== undefined && start === undefined; at = at.outer) {
      start = at.inner.get(first) ?? (at.kind !== 'trigger' && foldName(nameOfKey(at.key)) === first ? at : undefined);
    }
    start ??= this.classes.get(first);
    if (start === undefined) {
      // A class of the snapshot whose code is not read: it is a class, and nothing is known of its members.
      const unit = from?.unit.key;
      return unit !== undefined && words.length === 1 && this.types.find(words[0] ?? '', unit) !== undefined
        ? 'opaque'
        : undefined;
    }
    for (const part of rest) {
      start = start.inner.get(part);
      if (start === undefined) return undefined;
    }
    return start;
  }

  private superOf(cls: ClassInfo): ClassInfo | undefined {
    if (cls.extends === undefined) return undefined;
    const found = this.findClass(wordsOf(cls.extends.name), cls.outer ?? cls);
    return found === 'opaque' || found === cls ? undefined : found;
  }

  /** A class, the classes it extends, then the classes around it and the classes they extend. */
  private *chain(cls: ClassInfo): Generator<ClassInfo> {
    const seen = new Set<ClassInfo>();
    for (let outer: ClassInfo | undefined = cls; outer !== undefined; outer = outer.outer) {
      for (let at: ClassInfo | undefined = outer; at !== undefined && !seen.has(at); at = this.superOf(at)) {
        seen.add(at);
        yield at;
      }
    }
  }

  /** A variable or a property of a class, of a class it extends, or of a class around it. */
  private findVar(cls: ClassInfo, name: string, around = true): VarInfo | undefined {
    for (const at of around ? this.chain(cls) : this.supers(cls)) {
      const found = at.vars.get(name);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  private *supers(cls: ClassInfo): Generator<ClassInfo> {
    const seen = new Set<ClassInfo>();
    for (let at: ClassInfo | undefined = cls; at !== undefined && !seen.has(at); at = this.superOf(at)) {
      seen.add(at);
      yield at;
    }
  }

  private resolveType(ref: TypeRef | undefined, cls: ClassInfo): Type {
    if (ref === undefined || ref.name === '') return OTHER;
    if (ref.array > 0) return { k: 'list', of: this.resolveType({ ...ref, array: ref.array - 1 }, cls) };
    let words = wordsOf(ref.name);
    if (words.length > 1 && foldName(words[0] ?? '') === 'system') words = words.slice(1);
    const arg = (index: number): Type => this.resolveType(ref.args[index], cls);
    switch (words.map(foldName).join('.')) {
      case 'list':
      case 'set':
      case 'iterable':
        return { k: 'list', of: arg(0) };
      case 'map':
        return { k: 'map', key: arg(0), value: arg(1) };
      case 'sobject':
        return { k: 'record', object: undefined };
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
    if (words.length === 1 && PRIMITIVES.has(foldName(words[0] ?? ''))) return OTHER;
    const found = this.findClass(words, cls);
    if (found === 'opaque') return OTHER;
    if (found !== undefined) return { k: 'instance', cls: found };
    const [first = '', second] = words;
    const object = words.length === 1 ? first : words.length === 2 && foldName(first) === 'schema' ? second : undefined;
    if (object === undefined) return OTHER;
    return this.schema.isObject(object) ? { k: 'record', object } : { k: 'named', name: object };
  }

  /** The more exact of the declared type of a variable and the type of the value it is given. */
  private refine(declared: Type, actual: Type): Type {
    if (declared.k === 'record' && actual.k === 'record') return declared.object === undefined ? actual : declared;
    if (declared.k === 'list' && actual.k === 'list') return { k: 'list', of: this.refine(declared.of, actual.of) };
    if (declared.k === 'map' && actual.k === 'map') {
      return { k: 'map', key: declared.key, value: this.refine(declared.value, actual.value) };
    }
    if ((declared.k === 'objectToken' || declared.k === 'describe') && actual.k === declared.k) {
      return declared.object === undefined ? actual : declared;
    }
    if (declared.k === 'fieldToken' && actual.k === 'fieldToken') {
      return declared.field === undefined ? actual : declared;
    }
    return declared;
  }

  /** The object of the records that DML writes: of a record, or of a list of them. */
  private static objectOf(type: Type): string | undefined {
    if (type.k === 'record') return type.object;
    if (type.k === 'named') return type.name;
    if (type.k === 'list') return Resolver.objectOf(type.of);
    return undefined;
  }

  // -------------------------------------------------------------- scopes

  private lookup(name: string): Local | undefined {
    for (let scope: Scope | undefined = this.context.scope; scope !== undefined; scope = scope.parent) {
      const found = scope.vars.get(name);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  /** Declares a local variable. One that is never assigned again keeps the type of the value it starts with. */
  private bind(name: Name, declared: Type, init?: Value): void {
    const folded = foldName(name.text);
    const once = (this.context.assigned.get(folded) ?? 0) === 0;
    const type = init !== undefined && once ? this.refine(declared, init.type) : declared;
    this.context.scope.vars.set(folded, { type });
  }

  private inScope(run: () => void): void {
    const ctx = this.context;
    const outer = ctx.scope;
    ctx.scope = { vars: new Map(), parent: outer };
    try {
      run();
    } finally {
      ctx.scope = outer;
    }
  }

  // -------------------------------------------------------------- reporting

  /** The tier of a name: that of its syntax where something checks it, and `probable` where nothing does. */
  private static tierOf(checked: Checked, tier: ConfidenceTier): ConfidenceTier {
    return !checked.checked && checked.target.resolution !== 'resolved' && tier === 'confirmed' ? 'probable' : tier;
  }

  /**
   * Reports a reference to an object or a field. Gives its id, to take it back. `more.object` is the object of a
   * field, or the object that DML writes, whose name stands nowhere else where the target has no key: a reference
   * that is not resolved keeps it in its attributes.
   */
  private add(
    at: Name,
    kind: Reference['kind'],
    checked: Checked,
    via: string,
    more: {
      readonly tier?: ConfidenceTier;
      readonly op?: string;
      readonly object?: string;
      readonly raw?: string;
    } = {},
  ): string | undefined {
    const ctx = this.context;
    if (ctx.quiet) return undefined;
    const { target } = checked;
    const id = `${kind}\n${target.to ?? `${more.object ?? ''}.${at.text}`}\n${String(at.at.line)}:${String(at.at.column)}`;
    if (this.found.has(id)) return id;
    this.found.set(
      id,
      validateReference({
        from: ctx.from,
        to: target.to,
        toType: target.toType,
        toNameRaw: more.raw ?? at.text,
        kind,
        origin: 'parser:apex',
        confidence: Resolver.tierOf(checked, more.tier ?? 'confirmed'),
        resolution: target.resolution,
        location: { file: ctx.unit.file, line: at.at.line, column: at.at.column },
        attrs: {
          via,
          ...(more.op === undefined ? {} : { op: more.op }),
          ...(target.to === null && more.object !== undefined ? { object: more.object } : {}),
        },
      }),
    );
    return id;
  }

  /** Reports a read or a write of a variable or a property of a class. A member that names itself has none. */
  private addMember(at: Name, member: VarInfo, access: Access): void {
    const ctx = this.context;
    if (ctx.quiet || member.key === ctx.from) return;
    const target: Checked = {
      target: { to: member.key, toType: member.owner.unit.type, resolution: 'resolved' },
      checked: true,
      known: true,
      notDescribed: false,
    };
    if (access !== 'write') this.add(at, 'reads', target, 'field');
    if (access !== 'read') this.add(at, 'writes', target, 'field');
  }

  private retract(ids: readonly (string | undefined)[] | undefined): void {
    for (const id of ids ?? []) if (id !== undefined) this.found.delete(id);
  }

  /** Gives a warning once for its code and its place. Says whether it gave it. */
  private warn(
    at: Name,
    code: string,
    message: string,
    details: Readonly<Record<string, string | readonly string[]>>,
  ): boolean {
    const ctx = this.context;
    if (ctx.quiet) return false;
    const id = `${code}\n${String(at.at.line)}:${String(at.at.column)}`;
    if (this.issueIds.has(id)) return false;
    this.issueIds.add(id);
    const { file } = ctx.unit;
    this.issues.push({
      severity: 'warning',
      code,
      message: `${file}, line ${String(at.at.line)}: ${message}`,
      componentKey: ctx.from,
      details: { path: file, line: at.at.line, column: at.at.column, ...details },
    });
    return true;
  }

  /**
   * The warning that the names after a relationship that leads to no known object were not followed, as for a flow
   * (decision record 0074): at most `MOST_NAMES_SHOWN` of them, and a warning with that many bears on every answer.
   * The first name gives the warning, and each name after it joins the warning at the place of the relationship.
   */
  private notFollowed(through: Through, names: readonly string[]): Type {
    const message = `it is not known which object "${cut(through.name.text, 80)}" of "${cut(through.object, 80)}" leads to, so "${cut(names.join('.'), 200)}" after it was not followed.`;
    const details = { relationship: through.name.text, notFollowed: names, endsAt: 'field', origin: 'parser:apex' };
    if (names.length === 1) {
      return this.warn(through.name, 'PATH_NOT_FOLLOWED', message, details) ? { k: 'beyond', through, names } : OTHER;
    }
    const { line, column } = through.name.at;
    const at = this.issues.findIndex(
      (one) => one.code === 'PATH_NOT_FOLLOWED' && one.details?.['line'] === line && one.details['column'] === column,
    );
    const before = this.issues[at];
    if (before === undefined || before.details === null) return OTHER;
    this.issues[at] = {
      ...before,
      message: `${this.context.unit.file}, line ${String(line)}: ${message}`,
      details: { ...before.details, notFollowed: names },
    };
    return { k: 'beyond', through, names };
  }

  /** A field or a relationship as the check found it, with the warning where the org did not describe it. */
  private notDescribed(at: Name, checked: Checked, object: string): void {
    if (!checked.notDescribed) return;
    // The name of the field: behind a relationship, the lookup field and not the relationship.
    const name = checked.lacks ?? at.text;
    this.warn(
      at,
      'FIELD_NOT_DESCRIBED',
      `the org described "${cut(object, 80)}" without "${cut(name, 80)}", and no file of the snapshot defines it. It is recorded as unresolved: the org does not know it, or the user who took the snapshot cannot see it.`,
      { object, name },
    );
  }

  /** A name of a relationship whose child object is not known: the code uses it as a list. */
  private childNotKnown(child: NonNullable<Value['maybeChild']>): void {
    this.retract(child.made);
    // It is no lookup, so it was not guessed as one.
    const guessed = `RELATIONSHIP_GUESSED\n${String(child.name.at.line)}:${String(child.name.at.column)}`;
    if (this.issueIds.delete(guessed)) {
      this.issues = this.issues.filter(
        (one) =>
          one.code !== 'RELATIONSHIP_GUESSED' ||
          one.details?.['line'] !== child.name.at.line ||
          one.details['column'] !== child.name.at.column,
      );
    }
    this.warn(
      child.name,
      'PATH_NOT_FOLLOWED',
      `it is not known which object the child relationship "${cut(child.name.text, 80)}" of "${cut(child.object, 80)}" leads to, so it was not followed.`,
      { relationship: child.name.text, notFollowed: [], origin: 'parser:apex' },
    );
  }

  /** A value that is given to something of a type: to a list, it is a list. */
  private given(value: Value, to: Type): Value {
    return to.k === 'list' || to.k === 'map' ? this.asList(value) : value;
  }

  /** A value that the code uses as a list. A name that may be a child relationship is one. */
  private asList(value: Value): Value {
    if (value.maybeChild === undefined) return value;
    this.childNotKnown(value.maybeChild);
    return { type: { k: 'list', of: { k: 'record', object: undefined } } };
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
        const declared = this.resolveType(stmt.type, this.context.cls);
        for (const one of stmt.vars)
          this.bind(one.name, declared, one.init === undefined ? undefined : this.given(this.ev(one.init), declared));
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
        const items = this.asList(this.ev(stmt.iterable)).type;
        const declared = this.resolveType(stmt.type, this.context.cls);
        this.inScope(() => {
          this.bind(stmt.name, items.k === 'list' ? this.refine(declared, items.of) : declared);
          this.stmt(stmt.body);
        });
        return;
      }
      case 'while':
        this.ev(stmt.cond);
        this.stmt(stmt.body);
        return;
      case 'return':
        if (stmt.expr !== undefined) this.given(this.ev(stmt.expr), this.context.returns);
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
        // The values of a `when` are read with the calls (part D): a value of a picklist is no reference.
        this.ev(stmt.on);
        for (const when of stmt.whens) {
          this.inScope(() => {
            if (when.binding !== undefined) {
              this.bind(when.binding.name, this.resolveType(when.binding.type, this.context.cls));
            }
            this.stmt(when.block);
          });
        }
        return;
      case 'dml': {
        const values = stmt.targets.map((target) => this.ev(target));
        const at: Name = { text: stmt.op, at: stmt.at };
        const object = values.map((value) => Resolver.objectOf(value.type)).find((name) => name !== undefined);
        if (object === undefined) {
          this.objectNotKnown(at, stmt.op);
          return;
        }
        this.add(at, 'writes', this.schema.object(object), 'dml', { op: stmt.op, object, raw: object });
        this.upsertKey(object, stmt.key);
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

  /**
   * DML on records of an object nothing says, such as a list of `SObject`. It is a path that ends at the object of
   * the records, as for an element of a flow that writes a record of an object nothing says (record 0074): no name
   * of it is followed, and it bears on an answer that holds an object.
   */
  private objectNotKnown(at: Name, op: string): void {
    this.warn(
      at,
      'PATH_NOT_FOLLOWED',
      `nothing says which object the records that "${op}" writes are of, so the write was not followed.`,
      { op, notFollowed: [], endsAt: 'object', origin: 'parser:apex' },
    );
  }

  // -------------------------------------------------------------- expressions

  /**
   * Works out what an expression is, and reports what it refers to. `access` says what happens to the field or the
   * variable the expression ends in: an assignment writes it. `step` says that a name follows, so that a name of
   * Salesforce is a relationship and not a field.
   */
  private ev(expr: Expr, access: Access = 'read', step = false): Value {
    switch (expr.kind) {
      case 'name':
        return this.name(expr.name, access);
      case 'string':
      case 'literal':
      case 'class':
        return VALUE;
      case 'this':
        return this.context.cls.kind === 'trigger' ? VALUE : { type: { k: 'instance', cls: this.context.cls } };
      case 'super': {
        const base = this.superOf(this.context.cls);
        return base === undefined ? VALUE : { type: { k: 'instance', cls: base } };
      }
      case 'dot': {
        const target = this.ev(expr.target, 'read', true);
        // `[SELECT Name FROM Account].Name` reads the field of the one record the query gives.
        const value = expr.target.kind === 'soql' && target.type.k === 'list' ? { type: target.type.of } : target;
        return this.dot(value, expr.name, access, step);
      }
      case 'call':
        return this.invoke(expr);
      case 'new':
        return this.construct(expr);
      case 'collection': {
        // `new List<List<SObject>>{ account.Things__r }`: a value given to a list of lists is a list.
        const type = this.resolveType(expr.type, this.context.cls);
        const item = type.k === 'list' ? type.of : OTHER;
        for (const element of expr.elements) this.given(this.ev(element), item);
        for (const pair of expr.pairs) {
          this.given(this.ev(pair.key), type.k === 'map' ? type.key : OTHER);
          this.given(this.ev(pair.value), type.k === 'map' ? type.value : OTHER);
        }
        return { type };
      }
      case 'cast': {
        const value = this.ev(expr.expr);
        return { type: this.refine(this.resolveType(expr.type, this.context.cls), value.type) };
      }
      case 'assign': {
        const right = this.ev(expr.right);
        const left = this.ev(expr.left, expr.op === '=' ? 'write' : 'both');
        return expr.op === '=' ? this.given(right, left.type) : right;
      }
      case 'binary': {
        const left = this.ev(expr.left);
        const right = this.ev(expr.right);
        if (expr.op !== '??') return VALUE;
        return { type: left.type.k === 'other' ? right.type : left.type };
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
        const target = this.asList(this.ev(expr.target)).type;
        this.ev(expr.index);
        return target.k === 'list' ? { type: target.of } : VALUE;
      }
      case 'instanceof':
        this.ev(expr.expr);
        return VALUE;
      case 'soql': {
        // What the query names is read with the queries (part C). The records it gives are of its object, and what
        // stands after `FROM` is always an object, also one nothing knows of.
        const [from] = expr.query.from;
        if (from === undefined) return { type: { k: 'list', of: { k: 'record', object: undefined } } };
        const of: Type = this.schema.isObject(from.text)
          ? { k: 'record', object: from.text }
          : { k: 'named', name: from.text };
        return { type: { k: 'list', of } };
      }
      case 'sosl':
        return { type: { k: 'list', of: { k: 'list', of: { k: 'record', object: undefined } } } };
      case 'unknown':
        for (const part of expr.parts) this.ev(part);
        return VALUE;
    }
  }

  private name(name: Name, access: Access): Value {
    const folded = foldName(name.text);
    const local = this.lookup(folded);
    if (local !== undefined) return { type: local.type };
    const { cls } = this.context;
    const member = this.findVar(cls, folded);
    if (member !== undefined) return this.member(member, name, access);
    const found = this.findClass([name.text], cls);
    if (found === 'opaque') return VALUE;
    if (found !== undefined) return { type: { k: 'static', cls: found } };
    if (this.schema.isObject(name.text)) return { type: { k: 'object', name } };
    if (NAMESPACES.has(folded)) return { type: { k: 'ns', name: folded as Namespace } };
    return VALUE;
  }

  /** A variable or a property of a class, read or written at `name`. A constant has the type of its value. */
  private member(member: VarInfo, name: Name, access: Access): Value {
    this.addMember(name, member, access);
    const declared = this.resolveType(member.type, member.owner);
    if (!member.constant || member.init === undefined) return { type: declared };
    if (member.value === undefined) {
      member.value = 'working';
      const outer = this.ctx;
      this.ctx = {
        from: member.key,
        unit: member.owner.unit,
        cls: member.owner,
        assigned: new Map(),
        quiet: true,
        returns: declared,
        scope: { vars: new Map(), parent: undefined },
      };
      try {
        member.value = this.refine(declared, this.ev(member.init).type);
      } finally {
        this.ctx = outer;
      }
    }
    // A constant that is set from itself has no value that can be followed.
    return { type: member.value === 'working' ? declared : member.value };
  }

  private dot(target: Value, name: Name, access: Access, step: boolean): Value {
    const folded = foldName(name.text);
    const { type } = target;
    switch (type.k) {
      case 'record':
        if (type.object !== undefined) return this.field(type.object, name, access, step);
        // `task.What.Name`: the relationship can lead to records of several objects, or to one not known here.
        if (type.through !== undefined && folded !== 'id') return { type: this.notFollowed(type.through, [name.text]) };
        return VALUE;
      case 'beyond':
        // `task.What.Owner.Name`: every name after the relationship is one that was not followed.
        if (type.names.length >= MOST_NAMES_SHOWN) return { type };
        return { type: this.notFollowed(type.through, [...type.names, name.text]) };
      case 'instance':
      case 'static': {
        const inner = type.k === 'static' ? type.cls.inner.get(folded) : undefined;
        if (inner !== undefined) return { type: { k: 'static', cls: inner } };
        const member = this.findVar(type.cls, folded, false);
        return member === undefined ? VALUE : this.member(member, name, access);
      }
      case 'object': {
        // A token: `Invoice__c.SObjectType` names the object, and `Invoice__c.Amount__c` the object and the field.
        // `Invoice__c.fields.Amount__c` names the field as `Schema.SObjectType.Invoice__c.fields.Amount__c` does.
        const object = type.name.text;
        this.add(type.name, 'references', this.schema.object(object), 'token');
        if (folded === 'sobjecttype') return { type: { k: 'objectToken', object } };
        if (folded === 'fields') return { type: { k: 'fields', object } };
        if (folded === 'id' || /__p?r$/i.test(name.text)) return VALUE;
        return this.fieldToken(object, name);
      }
      case 'ns':
        return this.inNamespace(type.name, name);
      case 'describe':
      case 'objectToken':
        // `Invoice__c.SObjectType.getDescribe().fields.Amount__c` names the field as `Schema.SObjectType.Invoice__c.fields` does.
        return folded === 'fields' ? { type: { k: 'fields', object: type.object } } : VALUE;
      case 'fields':
        if (type.object === undefined) return { type: { k: 'fieldToken', object: undefined, field: name.text } };
        if (folded === 'id') return { type: { k: 'fieldToken', object: type.object, field: name.text } };
        return this.fieldToken(type.object, name);
      default:
        return VALUE;
    }
  }

  /** The token of a field, which refers to the field. */
  private fieldToken(object: string, name: Name): Value {
    const checked = this.schema.field(object, name.text);
    const made = this.add(name, 'references', checked, 'token', { object });
    this.notDescribed(name, checked, object);
    return { type: { k: 'fieldToken', object, field: name.text }, made: made === undefined ? [] : [made] };
  }

  private inNamespace(namespace: Namespace, name: Name): Value {
    const folded = foldName(name.text);
    if (namespace === 'schema') {
      if (folded === 'sobjecttype') return { type: { k: 'ns', name: 'sobjecttype' } };
      return this.schema.isObject(name.text) ? { type: { k: 'object', name } } : VALUE;
    }
    if (namespace === 'sobjecttype') {
      // `Schema.SObjectType.Invoice__c` is the describe of the object.
      if (!this.schema.isObject(name.text)) return VALUE;
      this.add(name, 'references', this.schema.object(name.text), 'token');
      return { type: { k: 'describe', object: name.text } };
    }
    if (namespace === 'trigger') {
      const record: Type = { k: 'record', object: this.context.unit.object };
      if (folded === 'new' || folded === 'old') return { type: { k: 'list', of: record } };
      if (folded === 'newmap' || folded === 'oldmap') return { type: { k: 'map', key: OTHER, value: record } };
    }
    return VALUE;
  }

  /** A name after a record of a known object: a child relationship, a relationship or a field. */
  private field(object: string, name: Name, access: Access, step: boolean): Value {
    const folded = foldName(name.text);
    // The field `Id` cannot be changed or deleted: nothing refers to it in a way that matters.
    if (folded === 'id') return VALUE;
    const child = this.schema.child(object, name.text);
    if (child !== null) {
      this.add(name, 'references', child.field, 'field', { object: child.object });
      this.notDescribed(name, child.field, child.object);
      return { type: { k: 'list', of: { k: 'record', object: child.object } } };
    }
    const report = (checked: Checked, tier?: ConfidenceTier): string[] => {
      const made: string[] = [];
      const more = { object, ...(tier === undefined ? {} : { tier }) };
      if (access !== 'write') made.push(this.add(name, 'reads', checked, 'field', more) ?? '');
      if (access !== 'read') made.push(this.add(name, 'writes', checked, 'field', more) ?? '');
      this.notDescribed(name, checked, object);
      return made.filter((id) => id !== '');
    };
    const custom = /__p?r$/i.test(name.text);
    if (
      custom ||
      (!folded.includes('__') &&
        !/[a-z0-9]id$/i.test(name.text) &&
        (step || this.schema.isRelationship(object, name.text)))
    ) {
      const { field, leadsTo } = this.schema.relationship(object, name.text);
      // A name of a relationship that nothing defines is taken for the lookup it would be, as `probable`.
      const guessed = custom && !field.known && !field.notDescribed;
      const made = report(field, guessed ? 'probable' : undefined);
      if (guessed && !this.context.quiet) {
        const behind = `${name.text.slice(0, -1)}c`;
        this.warn(
          name,
          'RELATIONSHIP_GUESSED',
          `no file of the snapshot defines the relationship "${cut(name.text, 80)}" of "${cut(object, 80)}", so it is taken for the lookup field "${cut(behind, 80)}" and recorded as probable. It can be a child relationship.`,
          { relationship: name.text, object, field: behind },
        );
      }
      const record: Type =
        leadsTo === null
          ? { k: 'record', object: undefined, through: { name, object } }
          : { k: 'record', object: leadsTo };
      return guessed ? { type: record, maybeChild: { object, name, made } } : { type: record };
    }
    const checked = this.schema.field(object, name.text);
    const made = report(checked);
    // A name of Salesforce that nothing checks can be a child relationship, which the use of it shows.
    const unsure = !checked.known && !checked.notDescribed && !folded.includes('__');
    return unsure ? { type: OTHER, maybeChild: { object, name, made } } : VALUE;
  }

  private construct(expr: Extract<Expr, { kind: 'new' }>): Value {
    const type = this.resolveType(expr.type, this.context.cls);
    const object =
      type.k === 'record'
        ? type.object
        : type.k === 'named' && expr.args.some((arg) => arg.kind === 'assign')
          ? type.name
          : undefined;
    if (object !== undefined) {
      for (const arg of expr.args) {
        if (arg.kind === 'assign' && arg.left.kind === 'name') {
          // `new Invoice__c(Amount__c = 1)` writes the field.
          this.field(object, arg.left.name, 'write', false);
          this.ev(arg.right);
        } else this.ev(arg);
      }
      return { type };
    }
    // `new Map<Id, Contact>(account.Contacts)`: what a list, a set or a map is made of is a list.
    const ofList = type.k === 'list' || type.k === 'map';
    for (const arg of expr.args) {
      const value = this.ev(arg);
      if (ofList) this.asList(value);
    }
    return { type };
  }

  /**
   * The field an `upsert` statement tells records apart by: `upsert invoices External_Id__c` and
   * `upsert invoices Invoice__c.Fields.External_Id__c` name it, and `upsert invoices key` names a variable or a
   * constant that holds its token, as an argument of `Database.upsert` does. The field `Id` gives nothing.
   */
  private upsertKey(object: string, key: readonly Name[]): void {
    const [first] = key;
    const last = key.at(-1);
    if (first === undefined || last === undefined || foldName(last.text) === 'id') return;
    const folded = foldName(first.text);
    const { cls } = this.context;
    const found = key.length > 1 ? this.findClass([first.text], cls) : undefined;
    const holds =
      this.lookup(folded) !== undefined ||
      this.findVar(cls, folded) !== undefined ||
      (found !== undefined && found !== 'opaque');
    if (!holds) {
      const checked = this.schema.field(object, last.text);
      this.add(last, 'references', checked, 'dml', { object });
      this.notDescribed(last, checked, object);
      return;
    }
    let expr: Expr = { kind: 'name', name: first };
    for (const name of key.slice(1)) expr = { kind: 'dot', target: expr, name, safe: false };
    this.upsertToken(this.ev(expr), last);
  }

  /** The field whose token a value holds, as the field an `upsert` tells records apart by. */
  private upsertToken(token: Value, at: Name): void {
    const { type } = token;
    if (type.k !== 'fieldToken' || type.object === undefined || type.field === undefined) return;
    if (foldName(type.field) === 'id') return;
    this.add(at, 'references', this.schema.field(type.object, type.field), 'token', { object: type.object });
  }

  /**
   * Whether an argument is a text or the token of a field, which `get` of a record takes, and not a number, which
   * `get` of a list takes. Only what the syntax and the declarations show counts.
   */
  private textOrToken(arg: Expr): boolean {
    if (arg.kind === 'string') return true;
    let first: Expr = arg;
    while (first.kind === 'dot') first = first.target;
    if (first.kind !== 'name') return false;
    const folded = foldName(first.name.text);
    const local = this.lookup(folded);
    const member = local === undefined ? this.findVar(this.context.cls, folded) : undefined;
    if (arg.kind === 'name') {
      if (local !== undefined) return local.type.k === 'fieldToken';
      return member !== undefined && this.resolveType(member.type, member.owner).k === 'fieldToken';
    }
    // `Invoice__c.Status__c`, `Schema.Invoice__c.Status__c`: a token, unless a variable has that name.
    return (
      arg.kind === 'dot' &&
      local === undefined &&
      member === undefined &&
      (folded === 'schema' || this.schema.isObject(first.name.text))
    );
  }

  private invoke(expr: Extract<Expr, { kind: 'call' }>): Value {
    const method = foldName(expr.name.text);
    const { args } = expr;
    const rest = (from: number): void => {
      for (const arg of args.slice(from)) this.ev(arg);
    };
    if (expr.target === undefined) return this.returned(this.context.cls, method, args, true);
    let target = this.ev(expr.target);
    const ofRecord = method === 'get' && args.length === 1 && args[0] !== undefined && this.textOrToken(args[0]);
    if ((LIST_METHODS.has(method) && !ofRecord) || OF_LISTS.has(method)) target = this.asList(target);
    const { type } = target;
    if (OF_LISTS.has(method) && args[0] !== undefined && (type.k === 'list' || type.k === 'map')) {
      // `ids.addAll(account.Contacts)`: the argument is a list too.
      this.asList(this.ev(args[0]));
      rest(1);
      return VALUE;
    }
    switch (type.k) {
      case 'record':
        if ((method === 'get' || method === 'put') && args[0] !== undefined) {
          this.byToken(args[0], method === 'get' ? 'reads' : 'writes');
          rest(1);
          return VALUE;
        }
        rest(0);
        return method === 'clone' ? { type } : VALUE;
      case 'list':
        // `lists.add(account.Contacts)`, on a list of lists: what is added is of the type of the items.
        if (method === 'add' && args.length === 1 && args[0] !== undefined) this.given(this.ev(args[0]), type.of);
        else rest(0);
        if (method === 'get' || method === 'remove') return { type: type.of };
        return method === 'clone' || method === 'deepclone' ? { type } : VALUE;
      case 'map':
        if (method === 'put' && args.length === 2 && args[1] !== undefined) {
          this.ev(args[0] ?? args[1]);
          this.given(this.ev(args[1]), type.value);
        } else rest(0);
        if (method === 'get' || method === 'remove') return { type: type.value };
        if (method === 'values') return { type: { k: 'list', of: type.value } };
        if (method === 'keyset') return { type: { k: 'list', of: type.key } };
        return method === 'clone' || method === 'deepclone' ? { type } : VALUE;
      case 'instance':
      case 'static':
        return this.returned(type.cls, method, args, false);
      case 'object': {
        // A method of a custom setting or of a custom metadata type: `Billing_Settings__c.getInstance()`.
        rest(0);
        const object = type.name.text;
        this.add(type.name, 'references', this.schema.object(object), 'token');
        const record: Type = { k: 'record', object };
        if (RECORD_METHODS.has(method)) return { type: record };
        return method === 'getall' ? { type: { k: 'map', key: OTHER, value: record } } : VALUE;
      }
      case 'objectToken':
        rest(0);
        if (method === 'getdescribe') return { type: { k: 'describe', object: type.object } };
        return method === 'newsobject' ? { type: { k: 'record', object: type.object } } : VALUE;
      case 'describe':
        rest(0);
        return method === 'getsobjecttype' ? { type: { k: 'objectToken', object: type.object } } : VALUE;
      case 'fieldToken':
        rest(0);
        return method === 'getdescribe' ? { type } : VALUE;
      case 'ns':
        return this.system(type.name, expr);
      default:
        // Only a record has `get` and `put` with a field token, also one whose type is not known here.
        if (
          (method === 'get' || method === 'put') &&
          args[0] !== undefined &&
          (type.k === 'other' || type.k === 'named')
        ) {
          this.byToken(args[0], method === 'get' ? 'reads' : 'writes');
          rest(1);
          return VALUE;
        }
        rest(0);
        return VALUE;
    }
  }

  /**
   * What a method of a class of the snapshot gives back, where its name and the number of arguments decide it. An
   * argument that each such method takes as a list is a list.
   */
  private returned(cls: ClassInfo, method: string, args: readonly Expr[], around: boolean): Value {
    const values = args.map((arg) => this.ev(arg));
    for (const at of around ? this.chain(cls) : this.supers(cls)) {
      const matches = (at.methods.get(method) ?? []).filter((one) => one.params.length === args.length);
      const [first] = matches;
      if (first === undefined) continue;
      values.forEach((value, index) => {
        const lists = matches.every((one) => {
          const param = one.params[index];
          const type = param === undefined ? OTHER : this.resolveType(param.type, at);
          return type.k === 'list' || type.k === 'map';
        });
        if (lists) this.asList(value);
      });
      // Overloads that give back different types are told apart by the types of the arguments (part D).
      const spelled = (one: MethodInfo): string => (one.returns === undefined ? '' : typeText(one.returns));
      return matches.every((one) => spelled(one) === spelled(first))
        ? { type: this.resolveType(first.returns, at) }
        : VALUE;
    }
    return VALUE;
  }

  /** `record.get(token)` and `record.put(token, value)`: the token names the field it reads or writes. */
  private byToken(arg: Expr, kind: 'reads' | 'writes'): void {
    const value = this.ev(arg);
    const { type } = value;
    const at = anchor(arg);
    // A name in a text is read with the names in texts (work package 5).
    if (type.k !== 'fieldToken' || type.object === undefined || type.field === undefined || at === undefined) return;
    this.retract(value.made);
    const checked = this.schema.field(type.object, type.field);
    this.add(at, kind, checked, 'token', { object: type.object });
  }

  /** A method of `Database` or of `EventBus`. */
  private system(namespace: Namespace, expr: Extract<Expr, { kind: 'call' }>): Value {
    const method = foldName(expr.name.text);
    const { args } = expr;
    const [first, second] = args;
    const op =
      namespace === 'database'
        ? DATABASE_DML.get(method)
        : namespace === 'eventbus' && method === 'publish'
          ? 'publish'
          : undefined;
    if (op !== undefined && first !== undefined) {
      const records = this.ev(first);
      const object = Resolver.objectOf(records.type);
      if (object === undefined) this.objectNotKnown(expr.name, op);
      else this.add(expr.name, 'writes', this.schema.object(object), 'dml', { op, object, raw: object });
      if (op === 'upsert' && second !== undefined) {
        // The field that says which record is which: a field token, here or in a constant.
        const at = anchor(second);
        const token = this.ev(second);
        if (at !== undefined) this.upsertToken(token, at);
        for (const arg of args.slice(2)) this.ev(arg);
      } else for (const arg of args.slice(1)) this.ev(arg);
      return VALUE;
    }
    for (const arg of args) this.ev(arg);
    if (namespace === 'database' && DATABASE_QUERIES.has(method)) {
      return { type: { k: 'list', of: { k: 'record', object: undefined } } };
    }
    return VALUE;
  }
}

/** The name of the last part of a key: `Result` of `ApexClass:invoicebatch#inner:result`, folded. */
function nameOfKey(key: ComponentKey): string {
  const hash = key.indexOf('#');
  if (hash === -1) return key.slice(key.indexOf(':') + 1);
  const last =
    key
      .slice(hash + 1)
      .split('/')
      .at(-1) ?? '';
  return last.slice(last.indexOf(':') + 1);
}

const typeText = (type: TypeRef): string =>
  `${foldName(type.name.replace(/\s+/g, ''))}${type.args.length > 0 ? `<${type.args.map(typeText).join(',')}>` : ''}${'[]'.repeat(type.array)}`;

/** Calls `visit` for every expression of a statement, also the ones inside other expressions. */
function eachExpr(node: Stmt | Expr | undefined, visit: (expr: Expr) => void): void {
  if (node === undefined) return;
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
      case 'unknown':
        one.parts.forEach(expr);
        break;
      default:
    }
  };
  if (isExpr(node)) {
    expr(node);
    return;
  }
  const stmt = node;
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

const STATEMENTS: ReadonlySet<string> = new Set([
  'block',
  'local',
  'expr',
  'if',
  'for',
  'foreach',
  'while',
  'return',
  'throw',
  'try',
  'switch',
  'dml',
  'runas',
  'other',
]);
const isExpr = (node: Stmt | Expr): node is Expr => !STATEMENTS.has(node.kind);

/**
 * Builds the resolver of the members of the classes and triggers of a snapshot. `types` knows every class of the
 * snapshot by name, also one whose code is not read.
 */
export function buildApexResolver(units: readonly ApexUnitInput[], schema: ApexSchema, types: ApexTypes): ApexResolver {
  return new Resolver(units, schema, types);
}
