/**
 * The declarations of Apex and the types they use (decision record 0084).
 *
 * A class or a trigger is a component, and each of its members is a component below it: a method, a constructor, a
 * property, a member variable, the initialisers and an inner class, interface or enum with its own members. A class
 * a trigger declares is a member of the trigger. A member refers to the classes and the objects it uses as a type,
 * a class to what it extends and implements, and a trigger to its object.
 *
 * Reading and resolving are two steps, as for the other readers (`raw-references.ts`). `readApexUnit` takes the
 * members of one file, their places and the names of the types they use, and keeps nothing of the text. `resolveApex`
 * resolves those names once every file was read: a name is a class of the snapshot, a class, interface or enum one
 * declares inside it, or an object. A name of Salesforce that is no object, such as `Database.SaveResult`, gives no
 * reference. A `new` of a class is a call of its constructor, which the resolver of Apex reads (`apex-resolver.ts`).
 */
import type { JsonValue } from '../core/errors.ts';
import { apexSignature, buildKey, foldName, type ComponentKey, type SubComponent } from '../core/keys.ts';
import { validateReference, type Reference } from '../core/references.ts';
import type {
  Declarator,
  Declared,
  Expr,
  Member,
  Pos,
  Query,
  Span,
  Stmt,
  TriggerDecl,
  TypeDecl,
  TypeRef,
  Unit,
} from './apex-syntax.ts';
import type { ObjectModel, Target } from './model.ts';

/** How a file names a type that it uses. It is kept on the reference, as `via`. */
type ApexVia = 'declaration' | 'type' | 'new' | 'text';

/** A name of a type as a file writes it, before it is resolved. */
export interface TypeUse {
  /** The dotted name, as written, without white space: `InvoiceBatch.Result`, `Invoice__c`. */
  readonly name: string;
  readonly at: Pos;
  /** `triggers-on`: the object of a trigger. */
  readonly kind: 'extends' | 'implements' | 'uses-type' | 'triggers-on';
  readonly via: ApexVia;
  /**
   * `object`: a reference only where the name is an object. A `new` of a class calls its constructor, and a
   * `new` of an object makes a record of it. `class`: only where it is a type of the snapshot, as a class that is
   * extended, an interface that is implemented, and the text that `Type.forName` is given.
   */
  readonly only?: 'object' | 'class';
  readonly tier?: 'probable';
}

/**
 * The declaration a part is read from. The resolver of what the code refers to reads it again once every file was
 * read (`apex-resolver.ts`, decision record 0087).
 */
type PartSyntax =
  | { readonly kind: 'type'; readonly decl: TypeDecl }
  | { readonly kind: 'trigger'; readonly trigger: TriggerDecl }
  | { readonly kind: 'method'; readonly member: Extract<Member, { kind: 'method' }> }
  | { readonly kind: 'property'; readonly member: Extract<Member, { kind: 'property' }> }
  | { readonly kind: 'var'; readonly member: Extract<Member, { kind: 'field' }>; readonly declarator: Declarator }
  | { readonly kind: 'init'; readonly bodies: readonly Stmt[] };

/** A class or a trigger, or a member of one, as its file declares it. */
export interface ApexPart {
  /** Its place below the class or the trigger. Empty for the class or the trigger itself. */
  readonly subs: readonly SubComponent[];
  /** Its name as Apex writes it: `InvoiceBatch.Result.add(Invoice__c)`. */
  readonly name: string;
  /** Where it stands in the file. Empty for the class or the trigger itself, which its files define. */
  readonly spans: readonly Span[];
  readonly attrs: Readonly<Record<string, JsonValue>>;
  readonly uses: readonly TypeUse[];
  readonly syntax: PartSyntax;
}

/** What a file of Apex declares. */
export interface ApexUnitReading {
  /** The class or the trigger first, then its members, each after the type it stands in. */
  readonly parts: readonly ApexPart[];
  /** The classes, interfaces and enums it declares inside the class or the trigger, by their place below it. */
  readonly inner: readonly { readonly subs: readonly SubComponent[]; readonly name: string }[];
}

/** The text of a type as written, with its arguments and its brackets, and without white space. */
function written(type: TypeRef): string {
  const args = type.args.length === 0 ? '' : `<${type.args.map(written).join(',')}>`;
  return `${type.name.replace(/\s+/g, '')}${args}${'[]'.repeat(type.array)}`;
}

/** The words of a dotted name, without white space. */
const wordsOf = (name: string): string[] => name.replace(/\s+/g, '').split('.');

/**
 * A type as the signature of a method holds it: as written, without the namespace `System`, and an inner type of
 * the class with the name of the class in front of it. `apexSignature` folds it and writes `T[]` as `List<T>`.
 */
function spelled(type: TypeRef, outer: string | undefined, inner: ReadonlySet<string>): string {
  let words = wordsOf(type.name);
  if (words.length > 1 && foldName(words[0] ?? '') === 'system') words = words.slice(1);
  const [only] = words;
  const name =
    outer !== undefined && words.length === 1 && only !== undefined && inner.has(foldName(only))
      ? `${outer}.${only}`
      : words.join('.');
  const args = type.args.length === 0 ? '' : `<${type.args.map((arg) => spelled(arg, outer, inner)).join(',')}>`;
  return `${name}${args}${'[]'.repeat(type.array)}`;
}

/**
 * The names of a type and of its arguments, at their places. `head` says what the name of the type itself is, where
 * it is more than a use as a type.
 */
function typeUses(type: TypeRef, via: ApexVia, into: TypeUse[], head?: Pick<TypeUse, 'kind' | 'only'>): void {
  if (type.name !== '') {
    into.push({ name: type.name.replace(/\s+/g, ''), at: type.at, kind: 'uses-type', via, ...head });
  }
  // An argument of a generic type is a type: `List<Invoice__c>`, also after `new` and `implements`.
  for (const arg of type.args) typeUses(arg, 'type', into);
}

/** The text of a literal that `Type.forName` is given, at the place of its first character. */
export function forName(expr: Extract<Expr, { kind: 'call' }>): { name: string; at: Pos } | undefined {
  const target = expr.target;
  const onType =
    (target?.kind === 'name' && foldName(target.name.text) === 'type') ||
    (target?.kind === 'dot' &&
      foldName(target.name.text) === 'type' &&
      target.target.kind === 'name' &&
      foldName(target.target.name.text) === 'system');
  if (!onType || foldName(expr.name.text) !== 'forname') return undefined;
  // `Type.forName(name)`, or `Type.forName(namespace, name)` with no namespace: an empty text or `null`.
  const [first, second] = expr.args;
  const noNamespace =
    (first?.kind === 'string' && first.raw === '') || (first?.kind === 'literal' && foldName(first.text) === 'null');
  const text = expr.args.length === 1 ? first : expr.args.length === 2 && noNamespace ? second : undefined;
  if (text?.kind !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/.test(text.raw)) {
    return undefined;
  }
  return { name: text.raw, at: { line: text.at.line, column: text.at.column + 1 } };
}

/** The types that the expressions and statements of a member use. */
class Uses {
  readonly found: TypeUse[] = [];

  type(type: TypeRef | undefined, via: ApexVia = 'type'): void {
    if (type !== undefined) typeUses(type, via, this.found);
  }

  query(query: Query): void {
    for (const bind of query.binds) this.expr(bind);
    for (const sub of [...query.children, ...query.nested]) this.query(sub);
  }

  expr(expr: Expr | undefined): void {
    if (expr === undefined) return;
    switch (expr.kind) {
      case 'dot':
        this.expr(expr.target);
        return;
      case 'call': {
        const named = forName(expr);
        if (named !== undefined) {
          this.found.push({ ...named, kind: 'uses-type', via: 'text', only: 'class', tier: 'probable' });
        }
        this.expr(expr.target);
        for (const arg of expr.args) this.expr(arg);
        return;
      }
      case 'new':
        // `new Invoice__c()` makes a record of the object. A `new` of a class calls its constructor.
        typeUses(expr.type, 'new', this.found, { kind: 'uses-type', only: 'object' });
        for (const arg of expr.args) this.expr(arg);
        return;
      case 'collection':
        // `new Invoice__c[3]` makes no record: the object is the type of the elements. `new List<Invoice__c>()`
        // names it as an argument.
        if (expr.type.array > 0) this.type(expr.type);
        else for (const arg of expr.type.args) this.type(arg);
        for (const element of expr.elements) this.expr(element);
        for (const { key, value } of expr.pairs) {
          this.expr(key);
          this.expr(value);
        }
        return;
      case 'cast':
        this.type(expr.type);
        this.expr(expr.expr);
        return;
      case 'instanceof':
        this.expr(expr.expr);
        this.type(expr.type);
        return;
      case 'assign':
      case 'binary':
        this.expr(expr.left);
        this.expr(expr.right);
        return;
      case 'unary':
        this.expr(expr.operand);
        return;
      case 'ternary':
        this.expr(expr.cond);
        this.expr(expr.then);
        this.expr(expr.else);
        return;
      case 'index':
        this.expr(expr.target);
        this.expr(expr.index);
        return;
      case 'soql':
        this.query(expr.query);
        return;
      case 'sosl':
        for (const bind of expr.search.binds) this.expr(bind);
        return;
      case 'unknown':
        for (const part of expr.parts) this.expr(part);
        return;
      case 'class':
        // `InvoiceBatch.class` names the class as a type, as `Test.createStub` and `JSON.deserialize` take it.
        this.type(expr.type);
        return;
      default:
        // A name, a literal, `this` and `super` name no type that is used: a class in front of a dot is read with
        // what stands after it.
        return;
    }
  }

  stmt(stmt: Stmt | undefined): void {
    if (stmt === undefined) return;
    switch (stmt.kind) {
      case 'block':
        for (const one of stmt.stmts) this.stmt(one);
        return;
      case 'local':
        this.type(stmt.type);
        for (const one of stmt.vars) this.expr(one.init);
        return;
      case 'expr':
        this.expr(stmt.expr);
        return;
      case 'if':
        this.expr(stmt.cond);
        this.stmt(stmt.then);
        this.stmt(stmt.else);
        return;
      case 'for':
        for (const one of stmt.init) this.stmt(one);
        this.expr(stmt.cond);
        for (const one of stmt.update) this.expr(one);
        this.stmt(stmt.body);
        return;
      case 'foreach':
        this.type(stmt.type);
        this.expr(stmt.iterable);
        this.stmt(stmt.body);
        return;
      case 'while':
        this.expr(stmt.cond);
        this.stmt(stmt.body);
        return;
      case 'return':
        this.expr(stmt.expr);
        return;
      case 'throw':
        this.expr(stmt.expr);
        return;
      case 'try':
        this.stmt(stmt.block);
        for (const one of stmt.catches) {
          this.type(one.type);
          this.stmt(one.block);
        }
        this.stmt(stmt.finally);
        return;
      case 'switch':
        this.expr(stmt.on);
        for (const when of stmt.whens) {
          this.type(when.binding?.type);
          for (const value of when.values) this.expr(value);
          this.stmt(when.block);
        }
        return;
      case 'dml':
        for (const target of stmt.targets) this.expr(target);
        return;
      case 'runas':
        for (const arg of stmt.args) this.expr(arg);
        this.stmt(stmt.block);
        return;
      default:
        return;
    }
  }
}

/** Whether a declaration is a test: `@isTest`, or the older keyword `testMethod` of a method. */
const isTest = (declared: Declared): boolean =>
  declared.annotations.includes('istest') || declared.modifiers.includes('testmethod');

/**
 * Reads the members of a file that parsed: one class, interface or enum, or one trigger. `name` is the name of the
 * component, which a class has from its file.
 */
export function readApexUnit(unit: Unit, name: string): ApexUnitReading {
  const parts: ApexPart[] = [];
  const inner: { subs: readonly SubComponent[]; name: string }[] = [];
  const top = unit.types[0];
  // The inner types of the class, which a signature names with the class in front of them. A trigger has no name
  // that would stand in front: its classes are written as they are.
  const innerNames = new Set<string>();
  const declaredIn = (members: readonly Member[]): void => {
    for (const member of members) if (member.kind === 'type') innerNames.add(foldName(member.decl.name.text));
  };
  if (top !== undefined) declaredIn(top.members);
  if (unit.trigger !== undefined) declaredIn(unit.trigger.members);
  const outer = top === undefined ? undefined : name;
  const signature = (params: readonly { type: TypeRef }[]): string =>
    apexSignature(params.map((param) => spelled(param.type, outer, innerNames)));

  /** The members of a type or of a trigger, below `subs`. `shown` is the name of what holds them. */
  const membersOf = (members: readonly Member[], subs: readonly SubComponent[], shown: string, test: boolean): void => {
    const initialisers = new Map<'static' | 'instance', { spans: Span[]; uses: Uses; bodies: Stmt[] }>();
    for (const member of members) {
      if (member.kind === 'type') {
        const { text } = member.decl.name;
        typeOf(member.decl, [...subs, { kind: 'inner', name: text }], `${shown}.${text}`, test);
        continue;
      }
      if (member.kind === 'initializer') {
        // The initialisers of one kind run one after the other, and are one component.
        const kind = member.static ? 'static' : 'instance';
        const one = initialisers.get(kind) ?? { spans: [], uses: new Uses(), bodies: [] };
        one.spans.push(member.span);
        one.bodies.push(member.body);
        one.uses.stmt(member.body);
        initialisers.set(kind, one);
        continue;
      }
      const marked = test || (member.kind === 'method' && isTest(member)) ? { test: true } : {};
      if (member.kind === 'method') {
        const uses = new Uses();
        uses.type(member.returns);
        for (const param of member.params) uses.type(param.type);
        uses.stmt(member.body);
        const params = member.params.map((param) => written(param.type)).join(', ');
        const sub: SubComponent = member.ctor
          ? { kind: 'ctor', name: signature(member.params) }
          : { kind: 'method', name: `${member.name.text}${signature(member.params)}` };
        parts.push({
          subs: [...subs, sub],
          name: `${shown}.${member.name.text}(${params})`,
          spans: [member.span],
          attrs: marked,
          uses: uses.found,
          syntax: { kind: 'method', member },
        });
      } else if (member.kind === 'property') {
        const uses = new Uses();
        uses.type(member.type);
        for (const accessor of member.accessors) uses.stmt(accessor);
        parts.push({
          subs: [...subs, { kind: 'prop', name: member.name.text }],
          name: `${shown}.${member.name.text}`,
          spans: [member.span],
          attrs: marked,
          uses: uses.found,
          syntax: { kind: 'property', member },
        });
      } else {
        // Each variable of a declaration is a component, of the type the declaration names.
        for (const variable of member.vars) {
          const uses = new Uses();
          uses.type(member.type);
          uses.expr(variable.init);
          parts.push({
            subs: [...subs, { kind: 'var', name: variable.name.text }],
            name: `${shown}.${variable.name.text}`,
            spans: [member.span],
            attrs: marked,
            uses: uses.found,
            syntax: { kind: 'var', member, declarator: variable },
          });
        }
      }
    }
    for (const [kind, { spans, uses, bodies }] of initialisers) {
      parts.push({
        subs: [...subs, { kind: 'init', name: kind }],
        name: `${shown}.${kind === 'static' ? 'static ' : ''}{}`,
        spans,
        attrs: test ? { test: true } : {},
        uses: uses.found,
        syntax: { kind: 'init', bodies },
      });
    }
  };

  /** A class, an interface or an enum, and its members. A member of a test class is a test. */
  const typeOf = (decl: TypeDecl, subs: readonly SubComponent[], shown: string, within: boolean): void => {
    const test = within || isTest(decl);
    const uses: TypeUse[] = [];
    // A class extends a class, and an interface the interfaces it extends.
    for (const type of decl.extends) typeUses(type, 'declaration', uses, { kind: 'extends', only: 'class' });
    for (const type of decl.implements) typeUses(type, 'declaration', uses, { kind: 'implements', only: 'class' });
    if (subs.length > 0) inner.push({ subs, name: decl.name.text });
    parts.push({
      subs,
      name: shown,
      spans: subs.length === 0 ? [] : [decl.span],
      attrs: { kind: decl.kind, ...(test ? { test: true } : {}) },
      uses,
      syntax: { kind: 'type', decl },
    });
    membersOf(decl.members, subs, shown, test);
  };

  if (top !== undefined) typeOf(top, [], name, false);
  const { trigger } = unit;
  if (trigger !== undefined) {
    const uses = new Uses();
    uses.found.push({ name: trigger.object.text, at: trigger.object.at, kind: 'triggers-on', via: 'declaration' });
    for (const stmt of trigger.body) uses.stmt(stmt);
    parts.push({
      subs: [],
      name,
      spans: [],
      attrs: { object: trigger.object.text, events: [...trigger.events] },
      uses: uses.found,
      syntax: { kind: 'trigger', trigger },
    });
    membersOf(trigger.members, [], name, false);
  }
  return { parts, inner };
}

/** The classes of a snapshot and what each declares inside it, to resolve the names of types against. */
export interface ApexTypes {
  /**
   * The type that a name stands for in the class or trigger `unit`: an inner type of it, a class of the snapshot,
   * or an inner type of one, written after the name of its class. `ns.Name` is also the class `ns__Name`, as code
   * names a class of a managed package. `undefined` for any other name.
   */
  find(name: string, unit: ComponentKey): Target | undefined;
}

export interface ApexTypesInput {
  /** Every class and trigger of the snapshot, by its name, also one that did not parse. */
  readonly units: readonly {
    readonly key: ComponentKey;
    readonly type: 'ApexClass' | 'ApexTrigger';
    readonly name: string;
  }[];
  /** The inner types of each class or trigger that parsed. */
  readonly inner: ReadonlyMap<ComponentKey, ApexUnitReading['inner']>;
}

export function buildApexTypes(input: ApexTypesInput): ApexTypes {
  const classes = new Map<string, ComponentKey>();
  const innerOf = new Map<ComponentKey, Map<string, Target>>();
  for (const { key, type, name } of input.units) {
    if (type === 'ApexClass' && !classes.has(foldName(name))) classes.set(foldName(name), key);
    const byName = new Map<string, Target>();
    for (const one of input.inner.get(key) ?? []) {
      byName.set(foldName(one.name), {
        to: buildKey({ type, fullName: name, subs: one.subs }),
        toType: type,
        resolution: 'resolved',
      });
    }
    innerOf.set(key, byName);
  }
  const ofClass = (key: ComponentKey): Target => ({ to: key, toType: 'ApexClass', resolution: 'resolved' });
  return {
    find(name, unit) {
      const words = wordsOf(name).map(foldName);
      const [first = '', second] = words;
      if (words.length === 1) {
        const own = innerOf.get(unit)?.get(first);
        if (own !== undefined) return own;
        const top = classes.get(first);
        return top === undefined ? undefined : ofClass(top);
      }
      if (words.length !== 2 || second === undefined) return undefined;
      const top = classes.get(first);
      if (top !== undefined) return innerOf.get(top)?.get(second);
      // `ns.Name`, as code names a class of a managed package, which the snapshot holds as `ns__Name`.
      const prefixed = classes.get(`${first}__${second}`);
      return prefixed === undefined ? undefined : ofClass(prefixed);
    },
  };
}

/** The member the names of a file are resolved for, in the class or trigger it belongs to. */
interface ApexOwner {
  readonly key: ComponentKey;
  readonly unit: ComponentKey;
  readonly file: string;
}

/** The object a name of a type stands for, where it is one: `Invoice__c`, and `Account` of `Schema.Account`. */
function objectOf(model: ObjectModel, name: string): string | undefined {
  const words = wordsOf(name);
  const [first = '', second] = words;
  const object = words.length === 1 ? first : words.length === 2 && foldName(first) === 'schema' ? second : undefined;
  return object !== undefined && model.isObject(object) ? object : undefined;
}

/**
 * Resolves the names of types a member uses. A name is first a type of the snapshot, then an object: a custom one
 * by its suffix, or one the model knows (`ObjectModel.isObject`). Any other name gives nothing. A member that names
 * itself has no reference to itself. `events` are those of a trigger, which its reference to its object carries.
 */
export function resolveApex(
  model: ObjectModel,
  types: ApexTypes,
  owner: ApexOwner,
  uses: readonly TypeUse[],
  events?: readonly string[],
): Reference[] {
  /** What a name stands for, and the object it names. `undefined`: it gives no reference. */
  const targetOf = (use: TypeUse): { target: Target; object?: string } | undefined => {
    if (use.kind === 'triggers-on') return { target: model.object(use.name), object: use.name };
    const type = types.find(use.name, owner.unit);
    if (type !== undefined) return use.only === 'object' ? undefined : { target: type };
    const object = use.only === 'class' ? undefined : objectOf(model, use.name);
    return object === undefined ? undefined : { target: model.object(object), object };
  };
  /**
   * The tier of a use: that of its syntax, but `probable` for an object that no file defines and that is not one
   * every org has, which nothing checks (decision record 0087).
   */
  const tierOf = (use: TypeUse, target: Target, object: string | undefined): Reference['confidence'] => {
    const tier = use.tier ?? 'confirmed';
    const unchecked = object !== undefined && target.resolution !== 'resolved' && !model.knowsObject(object);
    return unchecked && tier === 'confirmed' ? 'probable' : tier;
  };
  const references: Reference[] = [];
  const seen = new Set<string>();
  for (const use of uses) {
    const named = targetOf(use);
    if (named === undefined || named.target.to === owner.key) continue;
    const { target, object } = named;
    // A use is kept once for its kind, its target and its place, whatever hands it twice.
    const id = `${use.kind}\n${String(target.to)}\n${String(use.at.line)}:${String(use.at.column)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const ofTrigger = use.kind === 'triggers-on' && events !== undefined ? { events: [...events] } : {};
    references.push(
      validateReference({
        from: owner.key,
        to: target.to,
        toType: target.toType,
        toNameRaw: use.name,
        kind: use.kind,
        origin: 'parser:apex',
        confidence: tierOf(use, target, object),
        resolution: target.resolution,
        location: { file: owner.file, line: use.at.line, column: use.at.column },
        // A class that `Type.forName` is given as a literal is a name of a text as the code writes it (decision record
        // 0093).
        attrs: { via: use.via, ...(use.via === 'text' ? { step: 'written' } : {}), ...ofTrigger },
      }),
    );
  }
  return references;
}
