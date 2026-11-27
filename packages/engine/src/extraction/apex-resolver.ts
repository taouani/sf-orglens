/**
 * What the code of Apex refers to (decision records 0087, 0088 and 0089): the fields of records it reads and writes,
 * also through relationships, the variables and properties of classes, the tokens of objects and fields, the objects
 * that DML writes, the objects and fields that queries and searches read, the methods and constructors it calls and
 * the enums whose values it names.
 *
 * It runs once every class and trigger was read (`apex.ts`), on the declarations the reader kept: an index of the
 * classes of the snapshot with the declared types of their variables, properties and methods, the classes they
 * extend and implement and the classes around them. A member is read with its scopes: a name is a local variable or
 * a parameter, then a variable or a property of its class, of a class it extends or of a class around it, then a
 * class, then an object, then a namespace of Salesforce. The type of each expression is worked out as far as the
 * declarations say, and nothing is guessed beyond them.
 *
 * A name of an object or a field is checked against the files and the descriptions of the snapshot
 * (`apex-schema.ts`). One that nothing checks is `probable`. What cannot be resolved has a warning, and nothing is
 * dropped without one where the code shows that it refers to something: a relationship whose end is not known, a
 * name of a relationship that is guessed, a name the org did not describe, DML on records of no known object, a
 * subquery through a child relationship of no known object, the fields after `ELSE` of a `TYPEOF`, and `FIELDS()`
 * of a query, which reads fields it does not name.
 *
 * A query in brackets reads the object after `FROM` and every field it names, in any clause, from a record of that
 * object, also in a subquery through a child relationship, which refers to the lookup field behind the relationship.
 * What it binds is read as code. A search reads each object it returns and the fields named there. Each is named as
 * the query or the search names it (`via`).
 *
 * A call of a method of the snapshot refers to the method that the type of what it is made on, its name, and the
 * number and the types of its arguments choose, as Apex chooses it, and to each method that a class that extends the
 * class of the value runs in its place. A `new` of a class calls the constructor its arguments choose, or the class
 * where it declares none or where they choose one that every exception has. A call into a class whose code is not
 * read refers to the class, with the name of the method. Where the types do not tell the methods apart, each is
 * `probable`. Names in texts, such as a query in a string, are read by work package 5.
 */
import { foldName, type ComponentKey } from '../core/keys.ts';
import { validateReference, type ConfidenceTier, type Reference } from '../core/references.ts';
import { cut, type AnalysisIssue } from './analysed.ts';
import { MOST_NAMES_SHOWN } from './raw-references.ts';
import type { ApexPart, ApexTypes } from './apex.ts';
import type { ApexSchema, Checked } from './apex-schema.ts';
import type { Expr, FieldPath, Name, Param, Pos, Query, Search, Stmt, TypeOf, TypeRef } from './apex-syntax.ts';
import type { Target } from './model.ts';

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
  /** The class a class extends and the interfaces it implements, or the interfaces an interface extends. */
  readonly supertypes: readonly TypeRef[];
  /** The values of an enum, folded. */
  readonly values: ReadonlySet<string>;
  /** The variables and properties, by folded name. */
  readonly vars: Map<string, VarInfo>;
  /** The methods by folded name, and the constructors under the name `<init>`. */
  readonly methods: Map<string, MethodInfo[]>;
  /** The classes, interfaces and enums it declares, by folded name. */
  readonly inner: Map<string, ClassInfo>;
}

/** A class of the snapshot whose code is not read, as `findClass` gives it: its key. */
interface Opaque {
  readonly opaque: Target;
}

const isOpaque = (found: ClassInfo | Opaque | undefined): found is Opaque => found !== undefined && 'opaque' in found;

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

/** A method or a constructor of a class or a trigger. */
interface MethodInfo {
  readonly key: ComponentKey;
  readonly owner: ClassInfo;
  /** Its name, folded, and `<init>` for a constructor. */
  readonly name: string;
  /** The name and the signature its key ends in, which a method that overrides it has too: `price(invoice__c)`. */
  readonly sub: string;
  readonly params: readonly Param[];
  readonly returns: TypeRef | undefined;
  readonly static: boolean;
  /** A class that extends its class can override it: it is virtual, abstract, an override or of an interface. */
  readonly open: boolean;
  /** A constructor that every exception has, which a call of refers to the class (`constructorsOf`). */
  readonly builtin?: boolean;
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
  /** A list, a set or an iterable. `coll` says which of a list and a set it is, where the code says so. */
  | { readonly k: 'list'; readonly of: Type; readonly coll?: 'list' | 'set' }
  | { readonly k: 'map'; readonly key: Type; readonly value: Type }
  /** A value of a primitive type of Apex, by its folded name: `integer`, `string`, `object`. */
  | { readonly k: 'prim'; readonly name: string }
  /** A value of a class of the snapshot. */
  | { readonly k: 'instance'; readonly cls: ClassInfo }
  /** The class itself, as in `InvoiceConstants.AMOUNT`. */
  | { readonly k: 'static'; readonly cls: ClassInfo }
  /**
   * A class of the snapshot whose code is not read, such as a class of a managed package whose code is hidden, or a
   * value of one. A call refers to the class, and names the method it calls.
   */
  | { readonly k: 'opaque'; readonly target: Target }
  /** The name of an object in an expression, as in `Invoice__c.Amount__c` and `Billing_Settings__c.getInstance()`. */
  | { readonly k: 'object'; readonly name: Name }
  | { readonly k: 'ns'; readonly name: Namespace }
  | { readonly k: 'objectToken'; readonly object: string | undefined }
  /**
   * The token of a field (`described` false), or its describe (`described` true), which a method of Apex can take
   * apart from the token. `fields.Amount__c` of a describe of an object is either, as the code uses it, and says
   * neither.
   */
  | {
      readonly k: 'fieldToken';
      readonly object: string | undefined;
      readonly field: string | undefined;
      readonly described?: boolean;
    }
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

type Namespace = 'schema' | 'sobjecttype' | 'trigger' | 'database' | 'eventbus' | 'label' | 'system';
const NAMESPACES: ReadonlySet<string> = new Set<Namespace>([
  'schema',
  'trigger',
  'database',
  'eventbus',
  'label',
  'system',
]);

interface Value {
  readonly type: Type;
  /**
   * The type the code declares, where `type` is the more exact type of the value it was given (`SObject one = new
   * Account()`, or a cast): an overload is chosen by it, as Apex chooses one.
   */
  readonly declared?: Type;
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
const prim = (name: string): Type => ({ k: 'prim', name });
const BOOLEAN = prim('boolean');

/** `null`, which fits every type. */
const NULL = prim('null');
const isNull = (type: Type): boolean => type.k === 'prim' && type.name === 'null';
/** A type that says something of a value: neither `null` nor what is not known. */
const says = (type: Type): boolean => type.k !== 'other' && !isNull(type);

/** The type of a literal: a number, `true` and `false`, `null`, and a text of several lines. */
function literalType(text: string): Type {
  const folded = foldName(text);
  if (folded === 'null') return NULL;
  if (folded === 'true' || folded === 'false') return BOOLEAN;
  if (/^\d+$/.test(folded)) return prim('integer');
  if (/^\d+l$/.test(folded)) return prim('long');
  if (/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?d$/.test(folded)) return prim('double');
  if (/^(?:\d+\.\d*|\.\d+)(?:e[+-]?\d+)?$/.test(folded)) return prim('decimal');
  return text.startsWith("'") ? prim('string') : OTHER;
}

/** The numbers of Apex, from the narrowest: an operation on two numbers gives the wider of them. */
const NUMBERS: readonly string[] = ['integer', 'long', 'double', 'decimal'];

/**
 * The primitive types a value of one is given to without a cast, as an argument. An `Id` is a text. A text is
 * turned into an `Id` where it is one, which only the run can tell, so whether it fits is not known.
 */
const WIDER: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['integer', new Set(['long', 'double', 'decimal'])],
  ['long', new Set(['double', 'decimal'])],
  ['double', new Set(['decimal'])],
  ['decimal', new Set(['double'])],
  ['id', new Set(['string'])],
  ['date', new Set(['datetime'])],
]);

/** The constructors every exception has, by the types of their parameters. */
const EXCEPTION_CONSTRUCTORS: readonly (readonly string[])[] = [[], ['String'], ['Exception'], ['String', 'Exception']];

/** The methods of `String` that give a text, beside `valueOf`, which every primitive type has. */
const TEXT_METHODS: ReadonlySet<string> = new Set(['escapesinglequotes', 'format', 'join']);

/** Whether a type is `Object`, which every value is of. */
function isObjectType(type: Type): boolean {
  return type.k === 'prim' && type.name === 'object';
}

/** The operators that give a Boolean. */
const COMPARISONS: ReadonlySet<string> = new Set(['==', '!=', '===', '!==', '<', '>', '<=', '>=', '&&', '||']);

/**
 * How the value of an argument fits a parameter: as it is, as a wider type, not at all, or not known, where the type
 * of either is not known here.
 */
type Fit = 'exact' | 'wider' | 'unknown' | 'no';
const FITS: readonly Fit[] = ['exact', 'wider', 'unknown', 'no'];
const worst = (fits: readonly Fit[]): Fit =>
  fits.reduce<Fit>((one, other) => (FITS.indexOf(other) > FITS.indexOf(one) ? other : one), 'exact');

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

/** A dotted name without the namespace `System` in front. */
function unsystem(name: string): string {
  const words = wordsOf(name);
  return (foldName(words[0] ?? '') === 'system' && words.length > 1 ? words.slice(1) : words).join('.');
}

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
  readonly declared?: Type;
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
  /** Every class, interface, enum and trigger, also an inner one. */
  private readonly all: ClassInfo[] = [];
  /** The classes and interfaces that extend or implement each, worked out at the first call that needs them. */
  private subtypes: Map<ClassInfo, ClassInfo[]> | undefined;
  private readonly schema: ApexSchema;
  private readonly types: ApexTypes;
  private ctx: Context | undefined;
  private found = new Map<string, Reference>();
  private issues: AnalysisIssue[] = [];
  private issueIds = new Set<string>();
  /**
   * How the code names the fields and the variables it reads and writes: `field` in code, `soql` in a query and
   * `sosl` in a search, also in an expression that one binds.
   */
  private named: 'field' | 'soql' | 'sosl' = 'field';

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
        const decl = syntax.kind === 'type' ? syntax.decl : undefined;
        const info: ClassInfo = {
          key,
          kind: decl === undefined ? 'trigger' : decl.kind,
          unit,
          outer,
          extends: decl?.kind === 'class' ? decl.extends[0] : undefined,
          supertypes: decl === undefined ? [] : [...decl.extends, ...decl.implements],
          values: new Set(decl?.values.map((value) => foldName(value.text))),
          vars: new Map(),
          methods: new Map(),
          inner: new Map(),
        };
        byPath.set(pathOf(part.subs), info);
        this.all.push(info);
        if (syntax.kind === 'type') {
          if (outer === undefined) {
            // A class is named as its code declares it, and as the snapshot holds it: `ns__Name` of a package.
            const names = [syntax.decl.name.text, nameOfKey(input.key)].map((one) => foldName(one));
            for (const name of input.type === 'ApexClass' ? names : []) {
              if (!this.classes.has(name)) this.classes.set(name, info);
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
        const open =
          holder.kind === 'interface' ||
          member.modifiers.some((one) => one === 'virtual' || one === 'abstract' || one === 'override');
        holder.methods.set(name, [
          ...(holder.methods.get(name) ?? []),
          {
            key,
            owner: holder,
            name,
            sub: nameOfKey(key),
            params: member.params,
            returns: member.returns,
            static: member.static,
            open: open && !member.static && !member.ctor,
          },
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

  /**
   * The class a dotted name stands for, seen from `from`: an inner class, a class around it, or a class. A class of the
   * snapshot whose code is not read is a class of which nothing is known but its key: by its name, or as code names
   * a class of a managed package, by the prefix of its namespace and its name, `ns.Name` for the class `ns__Name`.
   */
  private findClass(words: readonly string[], from: ClassInfo | undefined): ClassInfo | Opaque | undefined {
    const [first, ...rest] = words.map(foldName);
    if (first === undefined) return undefined;
    let start: ClassInfo | undefined;
    for (let at = from; at !== undefined && start === undefined; at = at.outer) {
      start = at.inner.get(first) ?? (at.kind !== 'trigger' && foldName(nameOfKey(at.key)) === first ? at : undefined);
    }
    start ??= this.classes.get(first);
    if (start === undefined) {
      const [second] = rest;
      const prefixed = rest.length === 1 && second !== undefined ? `${first}__${second}` : undefined;
      const named = prefixed === undefined ? undefined : this.classes.get(prefixed);
      if (named !== undefined) return named;
      const unit = from?.unit.key;
      const name = words.length === 1 ? first : prefixed;
      const target = unit === undefined || name === undefined ? undefined : this.types.find(name, unit);
      return target === undefined ? undefined : { opaque: target };
    }
    for (const part of rest) {
      start = start.inner.get(part);
      if (start === undefined) return undefined;
    }
    return start;
  }

  /** The class or interface of the snapshot that `cls` names as a supertype, as `extends` and `implements` do. */
  private supertypeOf(ref: TypeRef, cls: ClassInfo): ClassInfo | undefined {
    const found = this.findClass(wordsOf(ref.name), cls.outer ?? cls);
    return found === undefined || isOpaque(found) || found === cls ? undefined : found;
  }

  private superOf(cls: ClassInfo): ClassInfo | undefined {
    return cls.extends === undefined ? undefined : this.supertypeOf(cls.extends, cls);
  }

  /**
   * A class or an interface, then the classes it extends, then the interfaces any of them implements or extends:
   * the types whose methods a value of it has.
   */
  private *ancestors(cls: ClassInfo): Generator<ClassInfo> {
    const queue: ClassInfo[] = [...this.supers(cls)];
    const seen = new Set<ClassInfo>();
    for (const at of queue) {
      if (seen.has(at)) continue;
      seen.add(at);
      yield at;
      for (const ref of at.supertypes) {
        const found = this.supertypeOf(ref, at);
        if (found !== undefined && !seen.has(found)) queue.push(found);
      }
    }
  }

  /** The classes and interfaces that extend or implement `cls` themselves. */
  private subtypesOf(cls: ClassInfo): readonly ClassInfo[] {
    if (this.subtypes === undefined) {
      const subtypes = new Map<ClassInfo, ClassInfo[]>();
      for (const one of this.all) {
        for (const ref of one.supertypes) {
          const base = this.supertypeOf(ref, one);
          if (base !== undefined) subtypes.set(base, [...(subtypes.get(base) ?? []), one]);
        }
      }
      this.subtypes = subtypes;
    }
    return this.subtypes.get(cls) ?? [];
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
    if (ref.array > 0) return { k: 'list', of: this.resolveType({ ...ref, array: ref.array - 1 }, cls), coll: 'list' };
    let words = wordsOf(ref.name);
    if (words.length > 1 && foldName(words[0] ?? '') === 'system') words = words.slice(1);
    const arg = (index: number): Type => this.resolveType(ref.args[index], cls);
    switch (words.map(foldName).join('.')) {
      case 'list':
        return { k: 'list', of: arg(0), coll: 'list' };
      case 'set':
        return { k: 'list', of: arg(0), coll: 'set' };
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
        return { k: 'fieldToken', object: undefined, field: undefined, described: false };
      case 'describefieldresult':
      case 'schema.describefieldresult':
        return { k: 'fieldToken', object: undefined, field: undefined, described: true };
      case 'describesobjectresult':
      case 'schema.describesobjectresult':
        return { k: 'describe', object: undefined };
      default:
    }
    const [only = ''] = words;
    if (words.length === 1 && PRIMITIVES.has(foldName(only))) return prim(foldName(only));
    const found = this.findClass(words, cls);
    if (isOpaque(found)) return { k: 'opaque', target: found.opaque };
    if (found !== undefined) return { k: 'instance', cls: found };
    const [first = '', second = ''] = words;
    // A name of two words that is no class, and does not start with one, is a type of a namespace of Salesforce, such
    // as `Database.SaveResult`, or of a package, and never an object.
    if (words.length === 2 && foldName(first) !== 'schema') {
      return this.findClass([first], cls) === undefined ? { k: 'named', name: `${first}.${second}` } : OTHER;
    }
    const object = words.length === 1 ? first : words.length === 2 ? second : undefined;
    if (object === undefined) return OTHER;
    return this.schema.isObject(object) ? { k: 'record', object } : { k: 'named', name: object };
  }

  /** The more exact of the declared type of a variable and the type of the value it is given. */
  private refine(declared: Type, actual: Type): Type {
    if (declared.k === 'record' && actual.k === 'record') return declared.object === undefined ? actual : declared;
    // Only a query gives a list where one record is declared (`SObject one = [SELECT ...]`), and only the loop over
    // a query gives one record where a list is declared, a list for each batch (`for (List<SObject> batch : ...)`).
    if (declared.k === 'record' && actual.k === 'list' && actual.of.k === 'record') {
      return this.refine(declared, actual.of);
    }
    if (declared.k === 'list' && actual.k === 'record') return { ...declared, of: this.refine(declared.of, actual) };
    if (declared.k === 'list' && actual.k === 'list') return { ...declared, of: this.refine(declared.of, actual.of) };
    if (declared.k === 'map' && actual.k === 'map') {
      return { k: 'map', key: declared.key, value: this.refine(declared.value, actual.value) };
    }
    if ((declared.k === 'objectToken' || declared.k === 'describe') && actual.k === declared.k) {
      return declared.object === undefined ? actual : declared;
    }
    // An object of a class is of that class at run time, or of one that extends it, whatever the variable declares:
    // its methods are those of the class, and of a class that extends it.
    if (actual.k === 'instance' && declared.k === 'instance') {
      return declared.cls !== actual.cls && [...this.ancestors(actual.cls)].includes(declared.cls) ? actual : declared;
    }
    if (actual.k === 'instance' && (declared.k === 'named' || declared.k === 'other' || isObjectType(declared))) {
      return actual;
    }
    if (declared.k === 'fieldToken' && actual.k === 'fieldToken') {
      if (declared.field !== undefined) return declared;
      return declared.described === undefined ? actual : { ...actual, described: declared.described };
    }
    return declared;
  }

  /**
   * The primitive type an operator gives, as far as the types of its operands say: a comparison a Boolean, `+` with a
   * text a text, a number with a number the wider of them, and a date or a time with a number a date or a time.
   */
  private static operation(op: string, left: Type, right: Type): Type {
    const operator = op.replace(/\s+/g, '');
    if (COMPARISONS.has(operator)) return BOOLEAN;
    const a = left.k === 'prim' ? left.name : undefined;
    const b = right.k === 'prim' ? right.name : undefined;
    if (operator === '+' && (a === 'string' || b === 'string')) return prim('string');
    if (a === undefined || b === undefined) return OTHER;
    if (a === 'boolean' && b === 'boolean' && ['&', '|', '^'].includes(operator)) return BOOLEAN;
    const rank = Math.max(NUMBERS.indexOf(a), NUMBERS.indexOf(b));
    if (NUMBERS.includes(a) && NUMBERS.includes(b)) return prim(NUMBERS[rank] ?? a);
    if (['date', 'datetime', 'time'].includes(a) && NUMBERS.includes(b) && ['+', '-'].includes(operator)) return left;
    return OTHER;
  }

  /** What the methods every enum has give: `name()`, `ordinal()`, `values()` and `valueOf(text)`. */
  private static ofEnum(type: Extract<Type, { k: 'instance' | 'static' }>, method: string): Value {
    const value: Type = { k: 'instance', cls: type.cls };
    if (type.k === 'instance')
      return method === 'name' ? { type: prim('string') } : method === 'ordinal' ? { type: prim('integer') } : VALUE;
    return method === 'values'
      ? { type: { k: 'list', of: value, coll: 'list' } }
      : method === 'valueof'
        ? { type: value }
        : VALUE;
  }

  /** The object of the records that DML writes: of a record, or of a list of them. */
  private static objectOf(type: Type): string | undefined {
    if (type.k === 'record') return type.object;
    if (type.k === 'named') return type.name.includes('.') ? undefined : type.name;
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

  /**
   * Declares a local variable. One that is never assigned again keeps the type of the value it starts with, and the
   * variable of a loop (`loop`) that its body does not assign that of the items it goes through.
   */
  private bind(name: Name, declared: Type, init?: Value, loop = false): void {
    const folded = foldName(name.text);
    const once = loop || (this.context.assigned.get(folded) ?? 0) === 0;
    this.context.scope.vars.set(
      folded,
      init !== undefined && once ? { type: this.refine(declared, init.type), declared } : { type: declared },
    );
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
      /** The method a call names in a class whose code is not read. */
      readonly method?: string;
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
          ...(more.method === undefined ? {} : { method: more.method }),
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
    if (access !== 'write') this.add(at, 'reads', target, this.named);
    if (access !== 'read') this.add(at, 'writes', target, this.named);
  }

  /**
   * Reports a call of a method or a constructor, of a class that declares no constructor, or of a class whose code is
   * not read, with the method it names. A member that calls itself has no reference to itself.
   */
  private addCall(
    at: Name,
    to: { readonly to: ComponentKey | null; readonly toType: string },
    tier: ConfidenceTier,
    via: 'call' | 'new',
    method?: string,
  ): void {
    if (to.to === null || to.to === this.context.from) return;
    const target: Checked = {
      target: { to: to.to, toType: to.toType, resolution: 'resolved' },
      checked: true,
      known: true,
      notDescribed: false,
    };
    this.add(at, 'calls', target, via, { tier, ...(method === undefined ? {} : { method }) });
  }

  /** Reports a value of an enum of the snapshot, which reads the enum: a value is no component. */
  private addEnum(at: Name, cls: ClassInfo): void {
    const target: Checked = {
      target: { to: cls.key, toType: cls.unit.type, resolution: 'resolved' },
      checked: true,
      known: true,
      notDescribed: false,
    };
    this.add(at, 'reads', target, this.named);
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

  /**
   * A part of a value, as an item of a list or a value of a map, with the part of the type the code declares:
   * `recs[0]` of `List<SObject> recs = [SELECT Id FROM Account]` is an `Account`, which Apex takes for an `SObject`.
   */
  private static part(value: Value, of: (type: Type) => Type | undefined): Value {
    const type = of(value.type);
    if (type === undefined) return VALUE;
    const declared = value.declared === undefined ? undefined : of(value.declared);
    return declared === undefined ? { type } : { type, declared };
  }

  /** The value of a conditional or of `??`, which is one of two values, with the type the code declares of it. */
  private either(a: Value, b: Value): Value {
    const type = this.eitherType(a.type, b.type);
    if (a.declared === undefined && b.declared === undefined) return { type };
    return { type, declared: this.eitherType(a.declared ?? a.type, b.declared ?? b.type) };
  }

  /**
   * The type of a value of one of two types: where one is `null`, the other. Of two objects of classes, the closest
   * class or interface both are of, as `Shape` of `flag ? new Square() : new Circle()`. Of an object of a class and
   * a value of another type, or of no known type, the class is not known. Otherwise the first type that says
   * something.
   */
  private eitherType(a: Type, b: Type): Type {
    if (isNull(a)) return b;
    if (isNull(b)) return a;
    if (a.k === 'instance' && b.k === 'instance') {
      const of = new Set(this.ancestors(b.cls));
      for (const at of this.ancestors(a.cls)) if (of.has(at)) return at === a.cls ? a : { k: 'instance', cls: at };
      return OTHER;
    }
    if (a.k === 'instance' || b.k === 'instance') return OTHER;
    return says(a) ? a : b;
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
          // The variable of a loop is given each item, and keeps the type of the items where the loop does not
          // assign it.
          const again = assignments([stmt.body]).has(foldName(stmt.name.text));
          this.bind(stmt.name, declared, items.k === 'list' ? { type: items.of } : undefined, !again);
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
            this.bind(clause.name, this.resolveType(clause.type, this.context.cls));
            this.stmt(clause.block);
          });
        }
        this.stmt(stmt.finally);
        return;
      case 'switch': {
        // A value of a `when` is a literal, which names nothing, also where it is a value of a picklist, or a value
        // of the enum that the switch is on, which is written alone.
        const on = this.ev(stmt.on).type;
        const enumeration = on.k === 'instance' && on.cls.kind === 'enum' ? on.cls : undefined;
        for (const when of stmt.whens) {
          for (const value of when.values) {
            if (value.kind !== 'name') this.ev(value);
            else if (enumeration?.values.has(foldName(value.name.text)) === true) this.addEnum(value.name, enumeration);
          }
          this.inScope(() => {
            if (when.binding !== undefined) {
              this.bind(when.binding.name, this.resolveType(when.binding.type, this.context.cls));
            }
            this.stmt(when.block);
          });
        }
        return;
      }
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
        return { type: prim('string') };
      case 'literal':
        return { type: literalType(expr.text) };
      case 'class':
        // `Invoice__c.class` is a `Type`.
        return { type: { k: 'named', name: 'Type' } };
      case 'this':
        return this.context.cls.kind === 'trigger' ? VALUE : { type: { k: 'instance', cls: this.context.cls } };
      case 'super': {
        const base = this.superOf(this.context.cls);
        if (base !== undefined) return { type: { k: 'instance', cls: base } };
        // `super.run()` of a class whose code is not read refers to the class.
        const hidden = this.hiddenSuperOf(this.context.cls);
        return hidden === undefined ? VALUE : { type: { k: 'opaque', target: hidden } };
      }
      case 'dot': {
        const named = this.namespaced(expr);
        if (named !== undefined) return named;
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
        const declared = this.resolveType(expr.type, this.context.cls);
        return { type: this.refine(declared, this.ev(expr.expr).type), declared };
      }
      case 'assign': {
        const right = this.ev(expr.right);
        const left = this.ev(expr.left, expr.op === '=' ? 'write' : 'both');
        return expr.op === '=' ? this.given(right, left.type) : right;
      }
      case 'binary': {
        const left = this.ev(expr.left);
        const right = this.ev(expr.right);
        return expr.op === '??'
          ? this.either(left, right)
          : { type: Resolver.operation(expr.op, left.type, right.type) };
      }
      case 'unary': {
        const operand = this.ev(expr.operand, expr.op.includes('++') || expr.op.includes('--') ? 'both' : 'read');
        return expr.op.trim() === '!' ? { type: BOOLEAN } : operand;
      }
      case 'ternary': {
        this.ev(expr.cond);
        const then = this.ev(expr.then);
        return this.either(then, this.ev(expr.else));
      }
      case 'index': {
        const target = this.asList(this.ev(expr.target));
        this.ev(expr.index);
        return Resolver.part(target, (type) => (type.k === 'list' ? type.of : undefined));
      }
      case 'instanceof':
        this.ev(expr.expr);
        return VALUE;
      case 'soql':
        return { type: this.naming('soql', () => this.soql(expr.query)) };
      case 'sosl':
        return { type: this.naming('sosl', () => this.sosl(expr.search)) };
      case 'unknown':
        for (const part of expr.parts) this.ev(part);
        return VALUE;
    }
  }

  private name(name: Name, access: Access): Value {
    const folded = foldName(name.text);
    const local = this.lookup(folded);
    if (local !== undefined) return local;
    const { cls } = this.context;
    const member = this.findVar(cls, folded);
    if (member !== undefined) return this.member(member, name, access);
    const found = this.findClass([name.text], cls);
    if (isOpaque(found)) return { type: { k: 'opaque', target: found.opaque } };
    if (found !== undefined) return { type: { k: 'static', cls: found } };
    if (this.schema.isObject(name.text)) return { type: { k: 'object', name } };
    if (NAMESPACES.has(folded)) return { type: { k: 'ns', name: folded as Namespace } };
    return VALUE;
  }

  /**
   * `ns.Name`, as code names a class of a managed package: `ns` stands for nothing in the code, and the snapshot has
   * the class `ns__Name`.
   */
  private namespaced(expr: Extract<Expr, { kind: 'dot' }>): Value | undefined {
    if (expr.target.kind !== 'name') return undefined;
    const first = expr.target.name.text;
    const folded = foldName(first);
    const { cls } = this.context;
    const standsFor =
      this.lookup(folded) !== undefined ||
      this.findVar(cls, folded) !== undefined ||
      this.findClass([first], cls) !== undefined ||
      this.schema.isObject(first) ||
      NAMESPACES.has(folded);
    const found = standsFor ? undefined : this.findClass([first, expr.name.text], cls);
    if (found === undefined) return undefined;
    return isOpaque(found) ? { type: { k: 'opaque', target: found.opaque } } : { type: { k: 'static', cls: found } };
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
    return member.value === 'working' ? { type: declared } : { type: member.value, declared };
  }

  private dot(target: Value, name: Name, access: Access, step: boolean): Value {
    const folded = foldName(name.text);
    const { type } = target;
    switch (type.k) {
      case 'record':
        if (type.object !== undefined) return this.field(type.object, name, access, step);
        // `task.What.Name`: the relationship can lead to records of several objects, or to one not known here.
        if (type.through !== undefined && folded !== 'id') return { type: this.notFollowed(type.through, [name.text]) };
        return folded === 'id' ? { type: prim('id') } : VALUE;
      case 'beyond':
        // `task.What.Owner.Name`: every name after the relationship is one that was not followed.
        if (type.names.length >= MOST_NAMES_SHOWN) return { type };
        return { type: this.notFollowed(type.through, [...type.names, name.text]) };
      case 'instance':
      case 'static': {
        const inner = type.k === 'static' ? type.cls.inner.get(folded) : undefined;
        if (inner !== undefined) return { type: { k: 'static', cls: inner } };
        // `Mode.FAST`: a value of an enum.
        if (type.k === 'static' && type.cls.kind === 'enum' && type.cls.values.has(folded)) {
          this.addEnum(name, type.cls);
          return { type: { k: 'instance', cls: type.cls } };
        }
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
        return this.fieldToken(object, name, false);
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

  /** The token of a field, or its describe where `described` says which, which refers to the field. */
  private fieldToken(object: string, name: Name, described?: boolean): Value {
    const checked = this.schema.field(object, name.text);
    const made = this.add(name, 'references', checked, 'token', { object });
    this.notDescribed(name, checked, object);
    const type: Type = { k: 'fieldToken', object, field: name.text, ...(described === undefined ? {} : { described }) };
    return { type, made: made === undefined ? [] : [made] };
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
    // A custom label is a text. It is no reference here.
    if (namespace === 'label') return { type: prim('string') };
    // `System.Label.Name` and `System.Database.insert(...)`.
    if (namespace === 'system')
      return NAMESPACES.has(folded) ? { type: { k: 'ns', name: folded as Namespace } } : VALUE;
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
    if (folded === 'id') return { type: prim('id') };
    const child = this.schema.child(object, name.text);
    if (child !== null) {
      this.add(name, 'references', child.field, this.named, { object: child.object });
      this.notDescribed(name, child.field, child.object);
      return { type: { k: 'list', of: { k: 'record', object: child.object } } };
    }
    const report = (checked: Checked, tier?: ConfidenceTier): string[] => {
      const made: string[] = [];
      const more = { object, ...(tier === undefined ? {} : { tier }) };
      if (access !== 'write') made.push(this.add(name, 'reads', checked, this.named, more) ?? '');
      if (access !== 'read') made.push(this.add(name, 'writes', checked, this.named, more) ?? '');
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
        : type.k === 'named' && !type.name.includes('.') && expr.args.some((arg) => arg.kind === 'assign')
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
    const values = expr.args.map((arg) => {
      const value = this.ev(arg);
      return ofList ? this.asList(value) : value;
    });
    const at: Name = { text: expr.type.name.replace(/\s+/g, ''), at: expr.type.at };
    if (type.k === 'opaque') this.addCall(at, type.target, 'confirmed', 'new');
    if (type.k !== 'instance') return { type };
    // A `new` of a class calls the constructor its arguments choose, or the class where it declares none.
    const constructors = this.constructorsOf(type.cls);
    if (constructors.length === 0) this.addCall(at, Resolver.targetOf(type.cls), 'confirmed', 'new');
    else this.choose(at, constructors, values, undefined, 'new');
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
      (found !== undefined && !isOpaque(found));
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
    if (expr.target === undefined) return this.implicit(expr);
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
          // `get` gives an `Object`, whichever field it reads.
          return method === 'get' ? { type: prim('object') } : VALUE;
        }
        rest(0);
        if (method === 'getsobjecttype') return { type: { k: 'objectToken', object: type.object } };
        return method === 'clone' ? { type } : VALUE;
      case 'list':
        // `lists.add(account.Contacts)`, on a list of lists: what is added is of the type of the items.
        if (method === 'add' && args.length === 1 && args[0] !== undefined) this.given(this.ev(args[0]), type.of);
        else rest(0);
        if (method === 'get' || method === 'remove') {
          return Resolver.part(target, (one) => (one.k === 'list' ? one.of : undefined));
        }
        return method === 'clone' || method === 'deepclone' ? { type } : VALUE;
      case 'map':
        if (method === 'put' && args.length === 2 && args[1] !== undefined) {
          this.ev(args[0] ?? args[1]);
          this.given(this.ev(args[1]), type.value);
        } else rest(0);
        if (method === 'get' || method === 'remove') {
          return Resolver.part(target, (one) => (one.k === 'map' ? one.value : undefined));
        }
        if (method === 'values') {
          return Resolver.part(target, (one) =>
            one.k === 'map' ? { k: 'list', of: one.value, coll: 'list' } : undefined,
          );
        }
        if (method === 'keyset') return { type: { k: 'list', of: type.key, coll: 'set' } };
        return method === 'clone' || method === 'deepclone' ? { type } : VALUE;
      case 'instance':
      case 'static': {
        // A method of a value can be overridden in a class that extends its class, unless `super` calls it.
        // Apex chooses the method among those of the class the code declares, and the object runs it as its class
        // has it, which can be the class of the value the variable was given, or one that extends it.
        const values = args.map((arg) => this.ev(arg));
        const declared = target.declared?.k === 'instance' ? target.declared.cls : type.cls;
        const methods = this.methodsOf(declared, method);
        if (methods.length === 0 && type.cls.kind === 'enum') return Resolver.ofEnum(type, method);
        const on = type.k === 'instance' && expr.target.kind !== 'super' ? type.cls : undefined;
        return this.choose(expr.name, methods, values, on, 'call');
      }
      case 'opaque':
        // A class whose code is not read: the call refers to the class, and names the method.
        rest(0);
        this.addCall(expr.name, type.target, 'confirmed', 'call', expr.name.text);
        return VALUE;
      case 'object': {
        // A method of a custom setting or of a custom metadata type: `Billing_Settings__c.getInstance()`.
        rest(0);
        const object = type.name.text;
        this.add(type.name, 'references', this.schema.object(object), 'token');
        const record: Type = { k: 'record', object };
        if (RECORD_METHODS.has(method)) return { type: record };
        if (method === 'getsobjecttype') return { type: { k: 'objectToken', object } };
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
        return method === 'getdescribe' ? { type: { ...type, described: true } } : VALUE;
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
        // `String.valueOf(flag)`, `Decimal.valueOf(text)`: a value of the primitive type named in front.
        if (type.k === 'other' && expr.target.kind === 'name') {
          const named = foldName(expr.target.name.text);
          if (method === 'valueof' && PRIMITIVES.has(named) && named !== 'object') return { type: prim(named) };
          if (named === 'string' && TEXT_METHODS.has(method)) return { type: prim('string') };
        }
        return VALUE;
    }
  }

  // -------------------------------------------------------------- calls

  /**
   * A call without anything in front: a method of the class or of a class it extends, of the closest class around it
   * that has one of the name. `this(...)` calls a constructor of the class, and `super(...)` one of the class it
   * extends, or that class where it declares none.
   */
  private implicit(expr: Extract<Expr, { kind: 'call' }>): Value {
    const method = foldName(expr.name.text);
    const values = expr.args.map((arg) => this.ev(arg));
    const { cls } = this.context;
    if (method === 'this' || method === 'super') {
      const of = method === 'this' ? cls : this.superOf(cls);
      if (of === undefined) {
        // `super(...)` of a class whose code is not read refers to the class.
        const hidden = method === 'super' ? this.hiddenSuperOf(cls) : undefined;
        if (hidden !== undefined) this.addCall(expr.name, hidden, 'confirmed', 'call');
        return VALUE;
      }
      const constructors = this.constructorsOf(of);
      if (constructors.length === 0 && of !== cls) this.addCall(expr.name, Resolver.targetOf(of), 'confirmed', 'call');
      else this.choose(expr.name, constructors, values, undefined, 'call');
      return VALUE;
    }
    for (let at: ClassInfo | undefined = cls; at !== undefined; at = at.outer) {
      const methods = this.methodsOf(at, method).filter((one) => one.params.length === values.length);
      if (methods.length > 0) return this.choose(expr.name, methods, values, at, 'call');
    }
    return VALUE;
  }

  /**
   * The methods of a name that a value of `cls` has: its own, and those of the classes and interfaces it extends or
   * implements that it does not override.
   */
  private methodsOf(cls: ClassInfo, name: string): MethodInfo[] {
    const bySub = new Map<string, MethodInfo>();
    for (const at of this.ancestors(cls)) {
      for (const one of at.methods.get(name) ?? []) if (!bySub.has(one.sub)) bySub.set(one.sub, one);
    }
    return [...bySub.values()];
  }

  /**
   * The constructors of a class. An exception that declares one has those that every exception has too, without
   * arguments, with a message, a cause, or both, which Apex calls where the arguments choose them, and which call the
   * class. One that declares none is called as a class that declares none.
   */
  private constructorsOf(cls: ClassInfo): readonly MethodInfo[] {
    const declared = cls.methods.get('<init>') ?? [];
    if (declared.length === 0 || !this.isException(cls)) return declared;
    const spelled = (types: readonly string[]): string => types.map((one) => foldName(one)).join(',');
    const has = new Set(declared.map((one) => spelled(one.params.map((param) => unsystem(param.type.name)))));
    const at: Pos = { line: 0, column: 0 };
    const builtins = EXCEPTION_CONSTRUCTORS.filter((types) => !has.has(spelled(types))).map((types): MethodInfo => ({
      key: cls.key,
      owner: cls,
      name: '<init>',
      sub: `(${spelled(types)})`,
      params: types.map((name) => ({ type: { name, args: [], array: 0, at }, name: { text: '', at } })),
      returns: undefined,
      static: false,
      open: false,
      builtin: true,
    }));
    return [...declared, ...builtins];
  }

  /** Whether a class is an exception: the class at the top of the classes it extends extends `Exception`. */
  private isException(cls: ClassInfo): boolean {
    let top = cls;
    for (const at of this.supers(cls)) top = at;
    return top.extends !== undefined && foldName(unsystem(top.extends.name)) === 'exception';
  }

  /** The class whose code is not read that a class extends. */
  private hiddenSuperOf(cls: ClassInfo): Target | undefined {
    if (cls.extends === undefined) return undefined;
    const found = this.findClass(wordsOf(cls.extends.name), cls.outer ?? cls);
    return isOpaque(found) ? found.opaque : undefined;
  }

  /**
   * The methods other than `method` that a value of a class that extends or implements `on`, at any depth, runs for
   * it: the method of the same signature the class declares, or has from a class it extends, as a class that
   * implements an interface through a method of the class it extends.
   */
  private overrides(on: ClassInfo, method: MethodInfo): MethodInfo[] {
    const found = new Set<MethodInfo>();
    const seen = new Set<ClassInfo>([on]);
    const queue = [...this.subtypesOf(on)];
    for (const at of queue) {
      if (seen.has(at)) continue;
      seen.add(at);
      const runs = this.methodsOf(at, method.name).find((one) => one.sub === method.sub);
      if (runs !== undefined && runs !== method && !runs.static) found.add(runs);
      queue.push(...this.subtypesOf(at));
    }
    return [...found];
  }

  /**
   * Reports the call of one of `methods`, the methods and constructors of the name that the call can reach. They are
   * told apart by the number of arguments, then by their types (`overload`). The method chosen is `confirmed`, and
   * each of several that the types do not tell apart `probable`. Where the call is on a value of the class `on`,
   * which can extend the class the code declares, the method of the same signature `on` has, where it is another,
   * and each method that a class that extends or implements `on` runs for it (`overrides`) are `probable` too. Gives
   * what the method gives back, where every method chosen gives back the same type, and makes an argument that every
   * method chosen takes as a list a list.
   */
  private choose(
    at: Name,
    methods: readonly MethodInfo[],
    values: readonly Value[],
    on: ClassInfo | undefined,
    via: 'call' | 'new',
  ): Value {
    const { chosen, sure } = this.overload(
      methods.filter((one) => one.params.length === values.length),
      values,
    );
    // The constructors every exception has are of the class, which each of them calls.
    const builtin = chosen.every((one) => one.builtin === true);
    for (const one of chosen) {
      // `this(message)` of an exception calls a constructor of Salesforce.
      if (one.builtin === true && via === 'call' && one.owner === this.context.cls) continue;
      this.addCall(at, Resolver.targetOf(one), sure || builtin ? 'confirmed' : 'probable', via);
      if (on === undefined || !one.open) continue;
      const runs = this.methodsOf(on, one.name).find((each) => each.sub === one.sub);
      if (runs !== undefined && runs !== one) this.addCall(at, Resolver.targetOf(runs), 'probable', via);
      for (const override of this.overrides(on, runs ?? one)) {
        this.addCall(at, Resolver.targetOf(override), 'probable', via);
      }
    }
    values.forEach((value, index) => {
      if (chosen.length === 0) return;
      const lists = chosen.every((one) => {
        const type = this.paramType(one, index);
        return type.k === 'list' || type.k === 'map';
      });
      if (lists) this.asList(value);
    });
    const [first] = chosen;
    if (first === undefined) return VALUE;
    const spelled = (one: MethodInfo): string => (one.returns === undefined ? '' : typeText(one.returns));
    return chosen.every((one) => spelled(one) === spelled(first))
      ? { type: this.resolveType(first.returns, first.owner) }
      : VALUE;
  }

  /**
   * The methods of one name and number of parameters that the types of the arguments choose: the one they fit, or
   * of several, the one they fit as they are, or the one whose parameters each fit the parameters of the others, as
   * Apex chooses. `sure` is false where the types do not tell them apart, also where the type of an argument is not
   * known here: then every method they can fit is chosen.
   */
  private overload(
    methods: readonly MethodInfo[],
    values: readonly Value[],
  ): { chosen: readonly MethodInfo[]; sure: boolean } {
    if (methods.length <= 1) return { chosen: methods, sure: true };
    // A parameter of the same type in every method does not tell them apart.
    const spelled = (one: MethodInfo, index: number): string => {
      const type = one.params[index]?.type;
      return type === undefined ? '' : typeText(type);
    };
    const differ = values.map((_, index) =>
      methods.some((one) => spelled(one, index) !== spelled(methods[0] ?? one, index)),
    );
    const fitOf = (one: MethodInfo): Fit =>
      worst(
        values.map((value, index) =>
          differ[index] === true ? this.fits(value.declared ?? value.type, this.paramType(one, index)) : 'exact',
        ),
      );
    const scored = methods.map((one) => ({ one, fit: fitOf(one) }));
    const fitting = scored.filter((each) => each.fit !== 'no');
    const [only] = fitting;
    if (fitting.length === 1 && only !== undefined) return { chosen: [only.one], sure: true };
    if (fitting.length === 0) return { chosen: methods, sure: false };
    // A method that takes each argument as the type it is of is more specific than any other that takes them, also
    // where it is not known whether another takes them.
    const exact = fitting.filter((each) => each.fit === 'exact');
    const [one] = exact;
    if (exact.length === 1 && one !== undefined) return { chosen: [one.one], sure: true };
    const all = fitting.map((each) => each.one);
    if (fitting.some((each) => each.fit === 'unknown')) return { chosen: all, sure: false };
    // `null` fits every parameter alike, so the parameters it is given to do not make a method more specific.
    const narrower = (a: MethodInfo, b: MethodInfo): boolean =>
      a.params.every((_, index) => {
        if (isNull(values[index]?.type ?? OTHER)) return true;
        const fit = this.fits(this.paramType(a, index), this.paramType(b, index));
        return fit === 'exact' || fit === 'wider';
      });
    const specific = all.filter((a) => all.every((b) => a === b || narrower(a, b)));
    return specific.length === 1 ? { chosen: specific, sure: true } : { chosen: all, sure: false };
  }

  private paramType(method: MethodInfo, index: number): Type {
    return this.resolveType(method.params[index]?.type, method.owner);
  }

  /**
   * How a value of the type `from` fits a parameter of the type `to`. `null` fits every type, and every value fits
   * `Object`. Where the type of either is not known here, such as a field of a record or a class whose code is not
   * read, it is not known, as between two types of Salesforce, which can extend one another. A primitive value fits
   * only a primitive type, and a value of a type of Salesforce no primitive type and no class of the snapshot.
   */
  private fits(from: Type, to: Type): Fit {
    if (isNull(from)) return 'wider';
    if (isObjectType(to)) return isObjectType(from) ? 'exact' : 'wider';
    const vague = to.k === 'other' || to.k === 'named' || to.k === 'opaque';
    switch (from.k) {
      case 'prim':
        if (to.k !== 'prim') return 'no';
        if (from.name === to.name) return 'exact';
        if (from.name === 'string' && to.name === 'id') return 'unknown';
        return WIDER.get(from.name)?.has(to.name) === true ? 'wider' : 'no';
      case 'named':
        if (to.k === 'named') return foldName(from.name) === foldName(to.name) ? 'exact' : 'unknown';
        // A type of Salesforce that is no object the analysis knows can be an object all the same.
        return to.k === 'other' || to.k === 'opaque' || to.k === 'record' ? 'unknown' : 'no';
      case 'record':
        // A record is of no type of Salesforce but its object, `SObject` and `Object`, which an object the analysis
        // does not know is not (`named`).
        if (to.k !== 'record') return to.k === 'other' ? 'unknown' : 'no';
        if (to.object === undefined) return from.object === undefined ? 'exact' : 'wider';
        if (from.object === undefined) return 'unknown';
        return foldName(from.object) === foldName(to.object) ? 'exact' : 'no';
      case 'list': {
        if (to.k !== 'list') return to.k === 'other' ? 'unknown' : 'no';
        if (from.coll !== undefined && to.coll !== undefined && from.coll !== to.coll) return 'no';
        const items = this.fits(from.of, to.of);
        // An `Iterable` takes a list and a set.
        return items === 'exact' && to.coll === undefined && from.coll !== undefined ? 'wider' : items;
      }
      case 'map':
        if (to.k !== 'map') return to.k === 'other' ? 'unknown' : 'no';
        return worst([this.fits(from.key, to.key), this.fits(from.value, to.value)]);
      case 'instance':
        if (to.k !== 'instance') return vague ? 'unknown' : 'no';
        if (from.cls === to.cls) return 'exact';
        return [...this.ancestors(from.cls)].includes(to.cls) ? 'wider' : 'no';
      case 'fieldToken':
        if (to.k !== 'fieldToken') return to.k === 'other' || to.k === 'opaque' ? 'unknown' : 'no';
        if (from.described === undefined || to.described === undefined) return 'unknown';
        return from.described === to.described ? 'exact' : 'no';
      case 'objectToken':
      case 'describe':
        if (to.k === from.k) return 'exact';
        return to.k === 'other' || to.k === 'opaque' ? 'unknown' : 'no';
      default:
        return 'unknown';
    }
  }

  /** What a call of a method or a constructor, or of a class that declares none, refers to. */
  private static targetOf(of: MethodInfo | ClassInfo): { to: ComponentKey; toType: string } {
    return { to: of.key, toType: ('owner' in of ? of.owner : of).unit.type };
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

  // -------------------------------------------------------------- queries and searches

  /** Runs `run` with the fields and variables it names named as `via`. */
  private naming<T>(via: 'soql' | 'sosl', run: () => T): T {
    const outer = this.named;
    this.named = via;
    try {
      return run();
    } finally {
      this.named = outer;
    }
  }

  /**
   * A query reads the object after `FROM`, also one nothing knows of, since what stands there is always an object.
   * Gives the type of what it gives: a list of records of its object, a list of `AggregateResult`, or a number.
   */
  private soql(query: Query): Type {
    const [from, ...more] = query.from;
    const object = more.length === 0 ? from : undefined;
    if (object !== undefined) this.add(object, 'reads', this.schema.object(object.text), this.named);
    this.queried(query, object?.text);
    if (query.gives === 'count') return OTHER;
    if (query.gives === 'aggregates') return { k: 'list', of: { k: 'named', name: 'AggregateResult' } };
    if (object === undefined) return { k: 'list', of: { k: 'record', object: undefined } };
    const records: Type = this.schema.isObject(object.text)
      ? { k: 'record', object: object.text }
      : { k: 'named', name: object.text };
    return { k: 'list', of: records };
  }

  /**
   * What a query names beside its object, which is `object`: the fields of every clause, the subqueries of the
   * select list through child relationships, `TYPEOF`, the subqueries of the filter and the expressions it binds,
   * which are read as code. Of a subquery whose object is not known, only what it binds and its subqueries of the
   * filter are read: the warning about its child relationship stands for the rest.
   */
  private queried(query: Query, object: string | undefined): void {
    for (const bind of query.binds) this.ev(bind);
    for (const nested of query.nested) this.soql(nested);
    if (object === undefined) {
      for (const child of query.children) this.queried(child, undefined);
      return;
    }
    const prefixes = [query.alias, foldName(object)];
    for (const path of query.fields) this.fieldPath(object, Resolver.unprefixed(path, prefixes));
    for (const every of query.everyField) this.everyField(object, every);
    for (const child of query.children) this.childQuery(object, child, prefixes);
    for (const typeOf of query.typeOfs) this.typeOf(object, typeOf, prefixes);
  }

  /**
   * A path without the alias of its object or the name of its object in front: `a.Name` of `FROM Account a`, and
   * `Contact.Account.Name` of `FROM Contact`.
   */
  private static unprefixed(path: FieldPath, prefixes: readonly (string | undefined)[]): FieldPath {
    const [first] = path;
    return path.length > 1 && first !== undefined && prefixes.includes(foldName(first.text)) ? path.slice(1) : path;
  }

  /** A path from a record of `object`, as `Account__r.Tier__c`: each name but the last is a relationship. */
  private fieldPath(object: string, path: FieldPath): Value {
    let value: Value = { type: { k: 'record', object } };
    path.forEach((name, index) => {
      value = this.dot(value, name, 'read', index < path.length - 1);
    });
    return value;
  }

  /**
   * A subquery of the select list, through a child relationship of `parent`: the relationship refers to the lookup
   * field of the child object that defines it, and the subquery reads that object. Of a relationship that nothing
   * defines the lookup field can have any name, so a warning stands for the subquery.
   */
  private childQuery(parent: string, child: Query, prefixes: readonly (string | undefined)[]): void {
    const from = Resolver.unprefixed(child.from, prefixes);
    const name = from.at(-1);
    const found = name === undefined || from.length > 1 ? null : this.schema.child(parent, name.text);
    if (name !== undefined && found !== null) {
      this.add(name, 'references', found.field, this.named, { object: found.object });
      this.notDescribed(name, found.field, found.object);
      this.add(name, 'reads', this.schema.object(found.object), this.named);
      this.queried(child, found.object);
      return;
    }
    if (name !== undefined) {
      this.warn(
        name,
        'PATH_NOT_FOLLOWED',
        `it is not known which object the child relationship "${cut(name.text, 80)}" of "${cut(parent, 80)}" leads to, so the subquery through it was not followed.`,
        { relationship: name.text, notFollowed: namesOf(child.fields), origin: 'parser:apex' },
      );
    }
    this.queried(child, undefined);
  }

  /**
   * `FIELDS(ALL)`, `FIELDS(CUSTOM)` and `FIELDS(STANDARD)` read fields of `object` that the query does not name. Which
   * they are is not read, so a warning that bears on every answer stands for them.
   */
  private everyField(object: string, every: Name): void {
    this.warn(
      every,
      'PATH_NOT_FOLLOWED',
      `"FIELDS(${cut(every.text, 20)})" reads fields of "${cut(object, 80)}" that the query does not name, so they were not followed.`,
      { object, notFollowed: [], origin: 'parser:apex' },
    );
  }

  /**
   * `TYPEOF` of a relationship of `object` that leads to several objects: the relationship refers to its lookup
   * field, and each object after `WHEN` is read with its fields. The fields after `ELSE` are of the other objects
   * the relationship leads to, which are not known, unless it leads to one object that no `WHEN` names. Where a
   * `WHEN` names the one object the analysis knows, the code says that the relationship leads to others too.
   */
  private typeOf(object: string, typeOf: TypeOf, prefixes: readonly (string | undefined)[]): void {
    const path = Resolver.unprefixed(typeOf.relationship, prefixes);
    let value: Value = { type: { k: 'record', object } };
    for (const name of path) value = this.dot(value, name, 'read', true);
    for (const when of typeOf.whens) {
      this.add(when.object, 'reads', this.schema.object(when.object.text), this.named);
      for (const field of when.fields) this.fieldPath(when.object.text, field);
    }
    const { type } = value;
    const one = type.k === 'record' ? type.object : undefined;
    if (one !== undefined && !typeOf.whens.some((when) => foldName(when.object.text) === foldName(one))) {
      for (const field of typeOf.otherwise) this.fieldPath(one, field);
      return;
    }
    const relationship = path.at(-1);
    const names = namesOf(typeOf.otherwise);
    if (relationship === undefined || names.length === 0) return;
    this.warn(
      relationship,
      'PATH_NOT_FOLLOWED',
      `the fields after ELSE are of the objects that "${cut(relationship.text, 80)}" of "${cut(object, 80)}" leads to beside those after WHEN, which are not known, so "${cut(names.join(', '), 200)}" was not followed.`,
      { relationship: relationship.text, notFollowed: names, endsAt: 'field', origin: 'parser:apex' },
    );
  }

  /** A search reads each object it returns, with its fields. Gives lists of records of objects not known here. */
  private sosl(search: Search): Type {
    for (const bind of search.binds) this.ev(bind);
    for (const { object, fields } of search.returning) {
      this.add(object, 'reads', this.schema.object(object.text), this.named);
      for (const path of fields) this.fieldPath(object.text, Resolver.unprefixed(path, [foldName(object.text)]));
    }
    return { k: 'list', of: { k: 'list', of: { k: 'record', object: undefined } } };
  }
}

/**
 * The names of paths that were not followed, each once and at most `MOST_NAMES_SHOWN` of them, without `Id`, which
 * gives no reference where its object is known (decision record 0082).
 */
function namesOf(paths: readonly FieldPath[]): string[] {
  const names = new Map<string, string>();
  for (const name of paths.flat()) {
    const folded = foldName(name.text);
    if (folded !== 'id' && !names.has(folded)) names.set(folded, name.text);
  }
  return [...names.values()].slice(0, MOST_NAMES_SHOWN);
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
