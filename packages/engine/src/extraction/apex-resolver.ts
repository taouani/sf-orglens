/**
 * What the code of Apex refers to (decision records 0087 to 0091): the fields of records it reads and writes, also
 * through relationships, the variables and properties of classes, the tokens of objects and fields, the objects that
 * DML writes, the objects and fields that queries and searches read, the methods and constructors it calls, the enums
 * whose values it names, and what the texts it builds or hands to a method name.
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
 * `probable`.
 *
 * A text that a query or a search of `Database` or `Search` runs, or that `get`, `put`, `getSObject`, a describe or
 * `Type.forName` is given, names what it holds, at `probable` at most (decision record 0090). How a member builds the
 * text is followed, with its constants and the texts that methods of the snapshot give back. What a method does with
 * a text it is handed as a `String` is read again at each call of it, with the text the call gives (decision record
 * 0091). The names that records of custom metadata and field sets hold are not read yet.
 */
import { foldName, type ComponentKey } from '../core/keys.ts';
import { CONFIDENCE_TIERS, validateReference, type ConfidenceTier, type Reference } from '../core/references.ts';
import { cut, type AnalysisIssue } from './analysed.ts';
import { MOST_NAMES_SHOWN } from './raw-references.ts';
import { forName, type ApexPart, type ApexTypes } from './apex.ts';
import type { ApexSchema, Checked } from './apex-schema.ts';
import type {
  ApexReader,
  Expr,
  FieldPath,
  Name,
  Param,
  Pos,
  Query,
  Search,
  Stmt,
  TypeOf,
  TypeRef,
} from './apex-syntax.ts';
import {
  composed,
  distinct,
  either as eitherText,
  escaped,
  formatted,
  argBesideOther,
  argText,
  charsBeside,
  holdsParam,
  holePlaces,
  holeText,
  joined,
  known,
  literalText,
  mapped,
  nameIn,
  placed,
  trimmed,
  usedAt,
  withoutEnd,
  withoutStart,
  wordText,
  type Composed,
  type HoleOf,
  type Text,
  type Texts,
} from './apex-texts.ts';
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
  /** `global`: code outside the snapshot can use it. */
  readonly global: boolean;
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
  /** The texts of the value of a constant, without places, once it was worked out. `null`: it is no text known. */
  texts: Texts | null | undefined;
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
  /** Its modifiers and annotations, folded, as the reader gives them. */
  readonly modifiers: readonly string[];
  readonly annotations: readonly string[];
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
      /** The name of the field in a text, where a text named it (`fields.getMap().get('Amount__c')`). */
      readonly text?: Name;
    }
  | { readonly k: 'describe'; readonly object: string | undefined }
  /** `fields` of a describe: the next name is a field of the object. */
  | { readonly k: 'fields'; readonly object: string | undefined }
  /** The map of the fields of an object, by their names, which `getMap()` of `fields` gives. */
  | { readonly k: 'fieldMap'; readonly object: string | undefined }
  /** The map of the objects of the org, by their names, which `Schema.getGlobalDescribe()` gives. */
  | { readonly k: 'describes' }
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

type Namespace =
  'schema' | 'sobjecttype' | 'trigger' | 'database' | 'eventbus' | 'label' | 'system' | 'search' | 'type';
const NAMESPACES: ReadonlySet<string> = new Set<Namespace>([
  'schema',
  'trigger',
  'database',
  'eventbus',
  'label',
  'system',
  'search',
  'type',
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
  /** The texts the value can be, where it is a text and the code shows what of it (decision record 0090). */
  readonly texts?: Texts;
  /** The texts of the items of a list that the code writes out, as `new List<String>{ 'Invoice__c' }`. */
  readonly items?: readonly (Texts | undefined)[];
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

/**
 * The methods of `Database` that are given the text of a query, with whether what the query binds is a variable of
 * the code (`true`), or a key of the map the method is given beside it.
 */
const TEXT_QUERIES: ReadonlyMap<string, boolean> = new Map(
  ['query', 'countquery', 'getquerylocator', 'getcursor', 'getpaginationcursor'].flatMap((method) => [
    [method, true],
    [`${method}withbinds`, false],
  ]),
);

/** The methods of a record that name a relationship in a text. */
const RELATIONSHIP_METHODS: ReadonlySet<string> = new Set(['getsobject', 'getsobjects', 'putsobject']);

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
  /**
   * The texts each local variable can be at the place that is read, where the code shows them. A branch reads its
   * statements with a copy, and the copies are put together after it.
   */
  texts: Map<Local, Texts | undefined>;
  /** Whether the statements that are read cannot go on after the place that is read: after `return` or `throw`. */
  ended?: boolean;
  /** What the body gives back is gathered here, where the texts a method gives back are worked out. */
  readonly gives?: { texts: Text[]; unknown: boolean };
  /** Where a member is worked out for its callers (`Resolver.work`): what it does with a text that holds a parameter. */
  readonly uses?: Use[];
  /** Where a member is worked out for its callers: the methods its calls can run, and its calls of no known class. */
  readonly calls?: Set<MethodInfo>;
  readonly unknownCalls?: Set<string>;
  /** Where a member is worked out for its callers: the uses it keeps, each once (`Resolver.keep`). */
  readonly kept?: Set<string>;
  /** The method that is read and reported, whose parameters of the type `String` its calls give. */
  readonly method?: MethodInfo;
  /** The places where such a parameter enters a text. */
  readonly args?: Set<string>;
  /**
   * The places where something else that is not known enters a text too, and those of a parameter in a name that
   * holds something else that is not known: what the method says there is its own (`Resolver.silent`).
   */
  readonly blocked?: Set<string>;
  /**
   * While a use of a text of a method that is called is read again at the call, at `at`: the names that stand there
   * are of the method, which reports them, unless `all` says that what the caller gives makes them its own.
   */
  replay?: { readonly at: Pos; all: boolean } | undefined;
}

/**
 * What a member does with a text, where the text holds a parameter of the member, so that each call can read it again
 * with what it gives the parameter (decision record 0091): a field, a relationship or an object it names, a class, or
 * a query or a search.
 */
type Sink =
  | { readonly k: 'field'; readonly kind: 'reads' | 'writes'; readonly record: RecordType }
  | { readonly k: 'relationship'; readonly method: string; readonly record: RecordType }
  | { readonly k: 'fieldMap'; readonly object: string | undefined }
  | { readonly k: 'object' }
  /** `Type.forName`, with the namespace in front of the name where `space` says so. */
  | { readonly k: 'class'; readonly space: boolean }
  | { readonly k: 'text'; readonly kind: 'soql' | 'sosl' };

type RecordType = Extract<Type, { k: 'record' }>;

interface Use {
  readonly sink: Sink;
  /** The name of the method that takes the text, as `get`, which stands for it where nothing else says where. */
  readonly name: Name;
  readonly slots: readonly (Texts | undefined)[];
}

/** What a member does, worked out once without reporting anything, as its callers need it (decision record 0091). */
interface Worked {
  /** The texts a method gives back, with a part for each parameter. `null`: no text known. */
  readonly gives: Texts | null;
  readonly uses: readonly Use[];
  /** The methods and constructors of the snapshot that its calls can run. */
  readonly calls: ReadonlySet<MethodInfo>;
  /** The name and the number of arguments of each call it makes on a value of no class known here. */
  readonly unknownCalls: ReadonlySet<string>;
}

/**
 * What makes a method callable from outside the snapshot: an annotation of Lightning, of a flow, of Visualforce
 * remoting, of REST or of a namespace, beside the modifiers `global` and `webservice`.
 */
const CALLED_FROM_OUTSIDE: ReadonlySet<string> = new Set([
  'auraenabled',
  'invocablemethod',
  'remoteaction',
  'httpget',
  'httppost',
  'httpput',
  'httppatch',
  'httpdelete',
  'namespaceaccessible',
]);

const samePlace = (a: Pos, b: Pos): boolean => a.line === b.line && a.column === b.column;

/** A text of a query or a search, put together to be read, and what was read of it. */
interface ParsedText {
  readonly text: Text;
  readonly put: Composed;
  /** Whether nothing of the text is known. */
  readonly whole: boolean;
  readonly read: Query | Search | undefined;
}

/** What the resolver needs of a reader of Apex: to read a query or a search that is a text. */
export type TextReader = Pick<ApexReader, 'parseQuery' | 'parseSearch'>;

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
  private named: 'field' | 'soql' | 'sosl' | 'text' = 'field';
  private readonly reader: TextReader | undefined;
  /**
   * While a text of a query or a search is read: the places of the names that stand for parts of the text that are
   * not known, and those of them that were met as names.
   */
  private holes: ReadonlySet<Pos> = new Set();
  private met = new Set<Pos>();
  /** While a text of a query is read: whether what it binds is read as code, which a map gives otherwise. */
  private textBinds = true;
  /** What each member does, as its callers need it, once it was worked out (`work`). */
  private readonly works = new Map<ComponentKey, Worked | 'working'>();
  /**
   * The members that call each other, or themselves, as `work` finds them (decision record 0091): what they do with a
   * text they are handed is not read at their calls, and they say what they do not know of it. Found by the algorithm
   * of Tarjan: the members being worked out, the order `work` met each in and the earliest one it reaches, and those
   * whose group is still open.
   */
  private readonly looping = new Set<ComponentKey>();
  private readonly workPath: ComponentKey[] = [];
  private readonly workOrder = new Map<ComponentKey, { readonly index: number; low: number }>();
  private readonly workOpen: ComponentKey[] = [];
  private readonly workOpenSet = new Set<ComponentKey>();
  private readonly callsItself = new Set<ComponentKey>();
  /** The members whose code makes a call of a name, by the folded name: `<init>` for a constructor. */
  private callers: Map<string, ComponentKey[]> | undefined;
  /** Whether the calls of the snapshot give each method all it is given (`covered`). */
  private readonly coverage = new Map<MethodInfo, boolean>();

  constructor(units: readonly ApexUnitInput[], schema: ApexSchema, types: ApexTypes, reader?: TextReader) {
    this.schema = schema;
    this.types = types;
    this.reader = reader;
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
          global: decl?.modifiers.includes('global') ?? false,
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
          texts: undefined,
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
          texts: undefined,
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
            modifiers: member.modifiers,
            annotations: member.annotations,
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
    this.read(key, member, undefined);
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

  /**
   * Reads a member: to report what it refers to, or, with `work`, to work out without reporting anything what its
   * callers need of it. A parameter of a method is a part of a text that is not known: one its calls give where the
   * member is worked out (`holeText` with the parameter), and one its calls may give where it is reported, for a
   * parameter of the type `String` (`argText`).
   */
  private read(
    key: ComponentKey,
    member: MemberInfo,
    work: Required<Pick<Context, 'gives' | 'uses' | 'calls' | 'unknownCalls' | 'kept'>> | undefined,
  ): void {
    const { part, holder } = member;
    const { syntax } = part;
    const method =
      syntax.kind === 'method' ? [...holder.methods.values()].flat().find((one) => one.key === key) : undefined;
    const enter = (bodies: readonly (Stmt | Expr | undefined)[], returns?: TypeRef): void => {
      this.ctx = {
        from: key,
        unit: holder.unit,
        cls: holder,
        assigned: assignments(bodies),
        quiet: work !== undefined,
        returns: this.resolveType(returns, holder),
        scope: { vars: new Map(), parent: undefined },
        texts: new Map(),
        ...(work ?? (method === undefined ? {} : { method, args: new Set<string>(), blocked: new Set<string>() })),
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
        const { member: declared } = syntax;
        enter([declared.body], declared.returns);
        declared.params.forEach((param, index) => {
          const type = this.resolveType(param.type, holder);
          const local = this.bind(param.name, type);
          if (work !== undefined) this.context.texts.set(local, [holeText(undefined, Resolver.holeOf(type), index)]);
          else if (type.k === 'prim' && type.name === 'string') this.context.texts.set(local, [argText('text', index)]);
        });
        this.stmt(declared.body);
        break;
      }
      case 'property': {
        const { member: property } = syntax;
        enter(property.accessors, property.type);
        // The setter of a property is given the new value under this name.
        this.bind({ text: 'value', at: property.name.at }, this.resolveType(property.type, holder));
        const start = new Map(this.context.texts);
        // Each accessor is a body of its own, which starts with nothing known of what the other did.
        for (const accessor of property.accessors) {
          this.context.texts = new Map(start);
          this.context.ended = false;
          this.stmt(accessor);
        }
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
  }

  /**
   * What a member does, as its callers need it: the texts it gives back, what it does with a text that holds a
   * parameter, and the methods it calls. Worked out once, without reporting anything. `undefined` while it is worked
   * out, for a member that calls itself on the way. Members that call each other are worked out again once `work`
   * found them all, each without what the others do (`looping`), so that what they do does not depend on which of them
   * was worked out first.
   */
  private work(key: ComponentKey): Worked | undefined {
    const known = this.works.get(key);
    const caller = this.workPath.at(-1);
    if (known !== undefined) {
      // A call of a member whose group is still open: the caller is in that group.
      const order = this.workOrder.get(key);
      if (caller !== undefined && order !== undefined && this.workOpenSet.has(key)) this.lower(caller, order.index);
      if (known === 'working' && caller === key) this.callsItself.add(key);
      return known === 'working' ? undefined : known;
    }
    const member = this.members.get(key);
    if (member === undefined) return undefined;
    this.works.set(key, 'working');
    const index = this.workOrder.size;
    this.workOrder.set(key, { index, low: index });
    this.workOpen.push(key);
    this.workOpenSet.add(key);
    this.workPath.push(key);
    let worked: Worked;
    try {
      worked = this.workOut(key, member);
    } catch (error) {
      // A fault of the resolver: the member and its open group are taken as calling each other.
      this.close(key, true);
      throw error;
    } finally {
      this.workPath.pop();
    }
    this.works.set(key, worked);
    const order = this.workOrder.get(key);
    if (caller !== undefined && order !== undefined) this.lower(caller, order.low);
    if (order !== undefined && order.low === order.index) {
      const group = this.close(key, this.callsItself.has(key));
      if (group.length > 1) {
        for (const one of group) {
          const again = this.members.get(one);
          if (again === undefined) continue;
          // Worked out again as the caller of what it calls, so that a call is put down to the member that makes it.
          this.workPath.push(one);
          try {
            this.works.set(one, this.workOut(one, again));
          } finally {
            this.workPath.pop();
          }
        }
      }
    }
    return this.works.get(key) as Worked;
  }

  /** Reads a member to work out what its callers need of it. */
  private workOut(key: ComponentKey, member: MemberInfo): Worked {
    const working = {
      gives: { texts: [] as Text[], unknown: false },
      uses: [] as Use[],
      calls: new Set<MethodInfo>(),
      unknownCalls: new Set<string>(),
      kept: new Set<string>(),
    };
    const outer = { ctx: this.ctx, named: this.named, holes: this.holes, met: this.met, binds: this.textBinds };
    this.named = 'field';
    this.holes = new Set();
    this.met = new Set();
    this.textBinds = true;
    try {
      this.read(key, member, working);
    } finally {
      this.ctx = outer.ctx;
      this.named = outer.named;
      this.holes = outer.holes;
      this.met = outer.met;
      this.textBinds = outer.binds;
    }
    const { gives } = working;
    return {
      gives: gives.unknown || gives.texts.length === 0 ? null : distinct(gives.texts),
      uses: working.uses,
      calls: working.calls,
      unknownCalls: working.unknownCalls,
    };
  }

  /** The earliest member of an open group that a member being worked out reaches. */
  private lower(key: ComponentKey, index: number): void {
    const order = this.workOrder.get(key);
    if (order !== undefined && index < order.low) order.low = index;
  }

  /**
   * Closes the group of members that `key` starts, and gives it: they call each other where there are several, or
   * `alone` says so.
   */
  private close(key: ComponentKey, alone: boolean): readonly ComponentKey[] {
    const at = this.workOpen.lastIndexOf(key);
    if (at < 0) return [];
    const group = this.workOpen.splice(at);
    for (const one of group) this.workOpenSet.delete(one);
    if (group.length > 1 || alone) for (const one of group) this.looping.add(one);
    return group;
  }

  /**
   * The texts a method gives back, with a part for each parameter that stands where the method puts the parameter.
   * `undefined` where the method gives back a text that is not known, or calls itself on the way.
   */
  private template(method: MethodInfo): Texts | undefined {
    const syntax = method.builtin === true ? undefined : this.members.get(method.key)?.part.syntax;
    if (syntax?.kind !== 'method' || syntax.member.body === undefined) return undefined;
    return this.work(method.key)?.gives ?? undefined;
  }

  /**
   * Whether every call of a method gives it what it is given where it uses a text: no code outside the snapshot can
   * call it, code of the snapshot does, and no call of its name and number of arguments is made on a value of no
   * class known here. Its calls then read what it does with a parameter of the type `String`, and it says nothing of
   * the parameter itself (decision record 0091).
   */
  private covered(method: MethodInfo): boolean {
    const known = this.coverage.get(method);
    if (known !== undefined) return known;
    this.work(method.key);
    const covered = !this.looping.has(method.key) && !this.outside(method) && this.called(method);
    this.coverage.set(method, covered);
    return covered;
  }

  /**
   * Whether code outside the snapshot can call a method: one that is `global` or `webservice`, that an annotation
   * offers to Lightning, a flow, Visualforce, REST or another namespace, or a public one of a class that is `global`.
   * Never a private or protected one. Of a public method of an object: one of a class that extends or implements a
   * type the snapshot does not hold, through which Salesforce or another class can call it, or of a class that a
   * class extends which does so and leaves the method as it is; one that a `global` class or interface it extends or
   * implements declares; and one that sets something (`setName(value)`), which a page of Visualforce calls.
   */
  private outside(method: MethodInfo): boolean {
    if (method.modifiers.some((one) => one === 'global' || one === 'webservice')) return true;
    if (method.annotations.some((one) => CALLED_FROM_OUTSIDE.has(one))) return true;
    // A method that is private, as one without a modifier of access is, or protected, only its class can call.
    if (method.owner.kind !== 'interface' && !method.modifiers.includes('public')) return false;
    for (let at: ClassInfo | undefined = method.owner; at !== undefined; at = at.outer) if (at.global) return true;
    if (method.static || method.name === '<init>') return false;
    if (/^set./.test(method.name) && method.params.length === 1 && method.modifiers.includes('public')) return true;
    for (const at of this.ancestors(method.owner)) {
      if (this.offers(at) || (at.global && Resolver.declares(at, method))) return true;
    }
    return this.offeredBelow(method, method.owner, new Set());
  }

  /** Whether a class extends or implements a type the snapshot does not hold, which code outside can hold it as. */
  private offers(cls: ClassInfo): boolean {
    return cls.supertypes.some((ref) => this.supertypeOf(ref, cls) === undefined);
  }

  /** Whether a class declares a method of an object of the name and the number of parameters of `method`. */
  private static declares(cls: ClassInfo, method: MethodInfo): boolean {
    return (cls.methods.get(method.name) ?? []).some(
      (one) => !one.static && one.params.length === method.params.length,
    );
  }

  /** Whether a class that extends `cls`, and does not declare the method again, offers it to code outside. */
  private offeredBelow(method: MethodInfo, cls: ClassInfo, seen: Set<ClassInfo>): boolean {
    for (const sub of this.subtypesOf(cls)) {
      if (seen.has(sub) || Resolver.declares(sub, method)) continue;
      seen.add(sub);
      if (this.offers(sub) || this.offeredBelow(method, sub, seen)) return true;
    }
    return false;
  }

  /**
   * Whether code of the snapshot other than the method calls it, and no code calls a method of its name and number of
   * arguments on a value whose class is not known here, which could be a call of it.
   */
  private called(method: MethodInfo): boolean {
    const call = `${method.name}/${String(method.params.length)}`;
    let called = false;
    for (const key of this.callersOf(method.name)) {
      const worked = this.work(key);
      if (worked === undefined || worked.unknownCalls.has(call)) return false;
      if (key !== method.key && worked.calls.has(method)) called = true;
    }
    return called;
  }

  /** The members whose code makes a call of a name, also in what a query binds. */
  private callersOf(name: string): readonly ComponentKey[] {
    if (this.callers === undefined) {
      const callers = new Map<string, ComponentKey[]>();
      for (const [key, member] of this.members) {
        const names = new Set<string>();
        const visit = (expr: Expr): void => {
          if (expr.kind === 'call') {
            const folded = foldName(expr.name.text);
            names.add(expr.target === undefined && (folded === 'this' || folded === 'super') ? '<init>' : folded);
          } else if (expr.kind === 'new') names.add('<init>');
          else if (expr.kind === 'soql') for (const bind of bindsOf(expr.query)) eachExpr(bind, visit);
          else if (expr.kind === 'sosl') for (const bind of expr.search.binds) eachExpr(bind, visit);
        };
        for (const body of bodiesOf(member.part.syntax)) eachExpr(body, visit);
        for (const one of names) {
          const list = callers.get(one);
          if (list === undefined) callers.set(one, [key]);
          else list.push(key);
        }
      }
      this.callers = callers;
    }
    return this.callers.get(name) ?? [];
  }

  /**
   * Whether a place is where a parameter of the method that is reported enters a text, and every call of the method
   * reads what it is given there: the calls report what the text names, and the method nothing.
   */
  private silent(at: Pos): boolean {
    const { args, blocked, method } = this.context;
    const place = placeKey(at);
    return (
      args !== undefined &&
      method !== undefined &&
      args.has(place) &&
      blocked?.has(place) !== true &&
      this.covered(method)
    );
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
    if (declared.k === 'map' && (actual.k === 'fieldMap' || actual.k === 'describes')) return actual;
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
  private bind(name: Name, declared: Type, init?: Value, loop = false): Local {
    const folded = foldName(name.text);
    const once = loop || (this.context.assigned.get(folded) ?? 0) === 0;
    const local: Local =
      init !== undefined && once ? { type: this.refine(declared, init.type), declared } : { type: declared };
    this.context.scope.vars.set(folded, local);
    this.context.texts.set(local, init?.texts);
    return local;
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
    // Read again at a call, a name of the method that is called stands at the call, and the method reports it.
    const { replay } = ctx;
    if (replay !== undefined && !replay.all && samePlace(at.at, replay.at)) return undefined;
    const { target } = checked;
    const id = `${kind}\n${target.to ?? `${more.object ?? ''}.${at.text}`}\n${String(at.at.line)}:${String(at.at.column)}`;
    // A name in a text is `probable` at most (decision record 0012).
    const confidence = Resolver.tierOf(
      checked,
      via === 'text' && (more.tier ?? 'confirmed') === 'confirmed' ? 'probable' : (more.tier ?? 'confirmed'),
    );
    // The same reference twice, as from two texts a query can be, keeps the higher tier.
    const before = this.found.get(id);
    if (before !== undefined && CONFIDENCE_TIERS.indexOf(before.confidence) <= CONFIDENCE_TIERS.indexOf(confidence))
      return id;
    this.found.set(
      id,
      validateReference({
        from: ctx.from,
        to: target.to,
        toType: target.toType,
        toNameRaw: more.raw ?? at.text,
        kind,
        origin: 'parser:apex',
        confidence,
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

  /**
   * Gives a warning once for its code and its place. Says whether it gave it. `by` is the place of the name it is
   * about, where that is not its place.
   */
  private warn(
    at: Name,
    code: string,
    message: string,
    details: Readonly<Record<string, string | readonly string[]>>,
    by?: Pos,
  ): boolean {
    const ctx = this.context;
    if (ctx.quiet) return false;
    // Read again at a call, a name of the method that is called stands at the call: the method warns about it. Where
    // a parameter enters a text, the calls of the method warn, about what they give it.
    const { replay } = ctx;
    if (replay !== undefined && !replay.all && samePlace(by ?? at.at, replay.at)) return false;
    if (this.silent(at.at)) return false;
    const id = `${code}\n${String(at.at.line)}:${String(at.at.column)}`;
    if (this.issueIds.has(id)) {
      if (code === 'PATH_NOT_FOLLOWED') this.widen(at, details);
      return false;
    }
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
   * Two paths that were not followed at one place, as the parts of a text that a method gives back, which all stand at
   * the call: the warning bears where either does, with the names of both, and an end only where both have it.
   */
  private widen(at: Name, details: Readonly<Record<string, string | readonly string[]>>): void {
    const { line, column } = at.at;
    const index = this.issues.findIndex(
      (one) => one.code === 'PATH_NOT_FOLLOWED' && one.details?.['line'] === line && one.details['column'] === column,
    );
    const before = this.issues[index];
    if (before?.details === undefined || before.details === null) return;
    const names = (value: unknown): readonly string[] =>
      Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
    const had = names(before.details['notFollowed']);
    const more = names(details['notFollowed']).filter((name) => !had.includes(name));
    const { endsAt, ...rest } = before.details;
    const ends = endsAt !== undefined && endsAt === details['endsAt'];
    if (more.length === 0 && (ends || endsAt === undefined)) return;
    const notFollowed = [...had, ...more].slice(0, MOST_NAMES_SHOWN);
    this.issues[index] = { ...before, details: ends ? { ...before.details, notFollowed } : { ...rest, notFollowed } };
  }

  /**
   * The warning that the names after a relationship that leads to no known object were not followed, as for a flow
   * (decision record 0074): at most `MOST_NAMES_SHOWN` of them, and a warning with that many bears on every answer.
   * The first name gives the warning, and each name after it joins the warning at the place of the relationship.
   */
  private notFollowed(through: Through, names: readonly string[], by: Pos): Type {
    const message = `it is not known which object "${cut(through.name.text, 80)}" of "${cut(through.object, 80)}" leads to, so "${cut(names.join('.'), 200)}" after it was not followed.`;
    const details = { relationship: through.name.text, notFollowed: names, endsAt: 'field', origin: 'parser:apex' };
    if (names.length === 1) {
      const warned = this.warn(through.name, 'PATH_NOT_FOLLOWED', message, details, by);
      return warned ? { k: 'beyond', through, names } : OTHER;
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
    // A value worked out for a use somewhere else takes back nothing of the member that is read.
    if (this.context.quiet) return;
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
  private either(a: Value, b: Value, at?: { readonly a: Expr; readonly b: Expr }): Value {
    const type = this.eitherType(a.type, b.type);
    // A text where either is one: what the other is not known of stands where it is.
    const texts =
      at === undefined || (a.texts === undefined && b.texts === undefined)
        ? undefined
        : eitherText([this.textsOf(a, at.a), this.textsOf(b, at.b)]);
    const withTexts = texts === undefined ? {} : { texts };
    if (a.declared === undefined && b.declared === undefined) return { type, ...withTexts };
    return { type, declared: this.eitherType(a.declared ?? a.type, b.declared ?? b.type), ...withTexts };
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

  // -------------------------------------------------------------- texts

  /** Whether a value can be a text: one the code shows, one of the type `String`, or one of a type not known. */
  private static isText(value: Value): boolean {
    const { type } = value;
    return value.texts !== undefined || type.k === 'other' || (type.k === 'prim' && type.name === 'string');
  }

  /** What a part of a text that is not known is, by the type of the value. */
  private static holeOf(type: Type): HoleOf {
    if (type.k !== 'prim') return 'text';
    if (NUMBERS.includes(type.name)) return 'number';
    if (type.name === 'boolean' || type.name === 'date' || type.name === 'datetime') return type.name;
    return 'text';
  }

  /**
   * The texts of a value of `expr`: those the code shows, or one that is not known, which stands where the value
   * enters the text: at a name, at what a call gives, at the list that `String.join` is given.
   */
  private textsOf(value: Value, expr: Expr): Texts {
    const at = Resolver.placeOf(expr);
    if (value.texts === undefined) return [holeText(at, Resolver.holeOf(value.type))];
    const texts = placed(value.texts, at);
    // Where a parameter that the calls may give enters a text, the method says nothing that its calls say, unless
    // something else that is not known enters there too.
    const { args, blocked } = this.context;
    if (args !== undefined && blocked !== undefined) {
      const places = holePlaces(texts);
      for (const place of places.args) args.add(placeKey(place));
      for (const place of places.others) blocked.add(placeKey(place));
    }
    return texts;
  }

  /** The texts of a value that `+` puts together with another: a value that is `null` adds nothing. */
  private joinable(value: Value, expr: Expr): Texts {
    const texts = this.textsOf(value, expr);
    return texts.length === 0 ? [[]] : texts;
  }

  /** Where an expression stands for what a text is made of. */
  private static placeOf(expr: Expr | undefined): Pos | undefined {
    if (expr === undefined) return undefined;
    switch (expr.kind) {
      case 'name':
        return expr.name.at;
      case 'dot':
        return expr.name.at;
      case 'call': {
        // `String.join(names, ', ')`: what is not known is the list.
        const method = foldName(expr.name.text);
        const onString = expr.target?.kind === 'name' && foldName(expr.target.name.text) === 'string';
        if (onString && ['join', 'escapesinglequotes', 'valueof'].includes(method) && expr.args[0] !== undefined) {
          return Resolver.placeOf(expr.args[0]);
        }
        return expr.name.at;
      }
      case 'string':
      case 'literal':
        return expr.at;
      case 'cast':
        return Resolver.placeOf(expr.expr);
      case 'new':
      case 'collection':
        return expr.type.at;
      case 'index':
        return Resolver.placeOf(expr.target);
      case 'ternary':
        return Resolver.placeOf(expr.then);
      case 'assign':
      case 'binary':
        return Resolver.placeOf(expr.left);
      case 'unary':
        return Resolver.placeOf(expr.operand);
      case 'instanceof':
        return Resolver.placeOf(expr.expr);
      case 'unknown':
        return Resolver.placeOf(expr.parts[0]);
      default:
        return undefined;
    }
  }

  /**
   * What an assignment to a local variable makes of its text: `=` gives it the text of the value, and `+=` adds the
   * text of the value to its own. Gives the new texts of `+=`.
   */
  private assignText(expr: Extract<Expr, { kind: 'assign' }>, left: Value, right: Value): Texts | undefined {
    if (expr.left.kind !== 'name') return undefined;
    const local = this.lookup(foldName(expr.left.name.text));
    if (local === undefined) return undefined;
    const op = expr.op.replace(/\s+/g, '');
    // `+=` puts texts together only on a text: on a number it adds.
    const onText = local.type.k === 'prim' ? local.type.name === 'string' : Resolver.isText(left);
    const texts =
      op === '='
        ? right.texts
        : op === '+=' && onText
          ? joined(this.joinable(left, expr.left), this.joinable(right, expr.right))
          : undefined;
    this.context.texts.set(local, texts);
    return texts;
  }

  /**
   * Reads statements that run one of several ways, as the branches of an `if`: each from the texts of the variables
   * before them. After them, a variable can be any text it is after one of them.
   */
  private branches(runs: readonly (() => void)[]): void {
    const ctx = this.context;
    const before = ctx.texts;
    const ended = ctx.ended === true;
    const after: Map<Local, Texts | undefined>[] = [];
    for (const run of runs) {
      ctx.texts = new Map(before);
      ctx.ended = ended;
      run();
      // A way that returns or throws does not go on after the statement.
      if (!ctx.ended) after.push(ctx.texts);
    }
    ctx.ended = ended || after.length === 0;
    ctx.texts = after.length === 0 ? before : Resolver.merged(after);
  }

  /**
   * The texts of the variables after one of several ways. A variable that a way does not know is a part that is not
   * known after that way, which stands where the variable is used, and a variable that no way knows is not known.
   */
  private static merged(ways: readonly Map<Local, Texts | undefined>[]): Map<Local, Texts | undefined> {
    const out = new Map<Local, Texts | undefined>();
    const locals = new Set(ways.flatMap((way) => [...way.keys()]));
    for (const local of locals) {
      const all = ways.filter((way) => way.has(local)).map((way) => way.get(local));
      const unknown = [holeText(undefined, Resolver.holeOf(local.type))];
      const texts = all.every((one) => one === undefined) ? undefined : eitherText(all.map((one) => one ?? unknown));
      out.set(local, texts);
    }
    return out;
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
        for (const one of stmt.vars) {
          const local = this.bind(
            one.name,
            declared,
            one.init === undefined ? undefined : this.given(this.ev(one.init), declared),
          );
          // A variable of a primitive type that is not given a value is `null`, which names nothing.
          if (one.init === undefined && declared.k === 'prim') this.context.texts.set(local, []);
        }
        return;
      }
      case 'expr':
        this.ev(stmt.expr);
        return;
      case 'if':
        this.ev(stmt.cond);
        this.branches([
          () => {
            this.stmt(stmt.then);
          },
          () => {
            this.stmt(stmt.else);
          },
        ]);
        return;
      case 'for':
        this.inScope(() => {
          for (const init of stmt.init) this.stmt(init);
          if (stmt.cond !== undefined) this.ev(stmt.cond);
          // A loop runs its body any number of times. A text it changes is followed as if it ran it once or not.
          this.branches([
            () => {
              this.stmt(stmt.body);
              for (const update of stmt.update) this.ev(update);
            },
            () => undefined,
          ]);
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
          this.branches([
            () => {
              this.stmt(stmt.body);
            },
            () => undefined,
          ]);
        });
        return;
      }
      case 'while':
        if (stmt.bodyFirst === true) {
          // `do { ... } while (cond)` runs its body once at least, and is followed as if it ran it once.
          this.stmt(stmt.body);
          this.ev(stmt.cond);
          return;
        }
        this.ev(stmt.cond);
        this.branches([
          () => {
            this.stmt(stmt.body);
          },
          () => undefined,
        ]);
        return;
      case 'return': {
        if (stmt.expr === undefined) {
          this.context.ended = true;
          return;
        }
        const value = this.given(this.ev(stmt.expr), this.context.returns);
        const { gives } = this.context;
        if (gives !== undefined) {
          const texts = Resolver.isText(value) ? this.textsOf(value, stmt.expr) : undefined;
          if (texts === undefined) gives.unknown = true;
          else gives.texts.push(...texts);
        }
        this.context.ended = true;
        return;
      }
      case 'throw':
        this.ev(stmt.expr);
        this.context.ended = true;
        return;
      case 'try': {
        // A block can stop at any statement, and a clause runs from where it stopped: from the texts before it, or
        // after any statement of it that does not end it.
        const ctx = this.context;
        const ended = ctx.ended === true;
        const stops = [new Map(ctx.texts)];
        this.inScope(() => {
          for (const inner of stmt.block.kind === 'block' ? stmt.block.stmts : [stmt.block]) {
            this.stmt(inner);
            if (ctx.ended === true) break;
            stops.push(new Map(ctx.texts));
          }
        });
        const after = ctx.texts;
        const caught = Resolver.merged(stops);
        const ends = ctx.ended === true ? [] : [after];
        for (const clause of stmt.catches) {
          ctx.texts = new Map(caught);
          ctx.ended = ended;
          this.inScope(() => {
            this.bind(clause.name, this.resolveType(clause.type, this.context.cls));
            this.stmt(clause.block);
          });
          if (!ctx.ended) ends.push(ctx.texts);
        }
        ctx.ended = ended || ends.length === 0;
        ctx.texts = ends.length === 0 ? caught : Resolver.merged(ends);
        this.stmt(stmt.finally);
        return;
      }
      case 'switch': {
        // A value of a `when` is a literal, which names nothing, also where it is a value of a picklist, or a value
        // of the enum that the switch is on, which is written alone.
        const on = this.ev(stmt.on).type;
        const enumeration = on.k === 'instance' && on.cls.kind === 'enum' ? on.cls : undefined;
        const runs = stmt.whens.map((when) => (): void => {
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
        });
        // Without `when else`, none of them can run.
        const otherwise = stmt.whens.some((when) => when.binding === undefined && when.values.length === 0);
        this.branches(otherwise ? runs : [...runs, () => undefined]);
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
        return { type: prim('string'), texts: [literalText(expr.at, expr.raw)] };
      case 'literal': {
        // A number, `true` or `false` is a text too where it is added to one. `null` is no text: it names nothing.
        const type = literalType(expr.text);
        return { type, texts: isNull(type) ? [] : [wordText(expr.at, expr.text)] };
      }
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
        const items = expr.elements.map((element) => {
          const value = this.given(this.ev(element), item);
          return Resolver.isText(value) ? this.textsOf(value, element) : undefined;
        });
        for (const pair of expr.pairs) {
          this.given(this.ev(pair.key), type.k === 'map' ? type.key : OTHER);
          this.given(this.ev(pair.value), type.k === 'map' ? type.value : OTHER);
        }
        return items.length > 0 && type.k === 'list' ? { type, items } : { type };
      }
      case 'cast': {
        const declared = this.resolveType(expr.type, this.context.cls);
        const inner = this.ev(expr.expr);
        const type = this.refine(declared, inner.type);
        return inner.texts === undefined ? { type, declared } : { type, declared, texts: inner.texts };
      }
      case 'assign': {
        const right = this.ev(expr.right);
        const left = this.ev(expr.left, expr.op === '=' ? 'write' : 'both');
        const texts = this.assignText(expr, left, right);
        if (expr.op !== '=') return texts === undefined ? right : { type: prim('string'), texts };
        return this.given(right, left.type);
      }
      case 'binary': {
        const left = this.ev(expr.left);
        const right = this.ev(expr.right);
        if (expr.op === '??') return this.either(left, right, { a: expr.left, b: expr.right });
        const type = Resolver.operation(expr.op, left.type, right.type);
        // `'SELECT ' + fields + ' FROM Invoice__c'` puts texts together.
        if (expr.op.trim() !== '+' || type.k !== 'prim' || type.name !== 'string') return { type };
        return { type, texts: joined(this.joinable(left, expr.left), this.joinable(right, expr.right)) };
      }
      case 'unary': {
        const steps = expr.op.includes('++') || expr.op.includes('--');
        const operand = this.ev(expr.operand, steps ? 'both' : 'read');
        // `-1` and `count++` are numbers that the code works out: no text the code shows. `+` changes nothing.
        if (steps && expr.operand.kind === 'name') {
          const local = this.lookup(foldName(expr.operand.name.text));
          if (local !== undefined) this.context.texts.set(local, undefined);
        }
        const op = expr.op.trim();
        return op === '!' ? { type: BOOLEAN } : op === '+' ? operand : { type: operand.type };
      }
      case 'ternary': {
        this.ev(expr.cond);
        const then = this.ev(expr.then);
        return this.either(then, this.ev(expr.else), { a: expr.then, b: expr.else });
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
    if (local !== undefined) {
      const texts = this.context.texts.get(local);
      return texts === undefined ? local : { ...local, texts };
    }
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
        texts: new Map(),
      };
      try {
        const value = this.ev(member.init);
        member.value = this.refine(declared, value.type);
        member.texts = value.texts ?? null;
      } finally {
        this.ctx = outer;
      }
    }
    // A constant that is set from itself has no value that can be followed.
    if (member.value === 'working') return { type: declared };
    // The names in the text of a constant stand where the constant is used.
    const texts = member.texts === null || member.texts === undefined ? undefined : usedAt(member.texts, name.at);
    return texts === undefined ? { type: member.value, declared } : { type: member.value, declared, texts };
  }

  private dot(target: Value, name: Name, access: Access, step: boolean): Value {
    const folded = foldName(name.text);
    const { type } = target;
    switch (type.k) {
      case 'record':
        if (type.object !== undefined) return this.field(type.object, name, access, step);
        // `task.What.Name`: the relationship can lead to records of several objects, or to one not known here.
        if (type.through !== undefined && folded !== 'id')
          return { type: this.notFollowed(type.through, [name.text], name.at) };
        return folded === 'id' ? { type: prim('id') } : VALUE;
      case 'beyond':
        // `task.What.Owner.Name`: every name after the relationship is one that was not followed.
        if (type.names.length >= MOST_NAMES_SHOWN) return { type };
        return { type: this.notFollowed(type.through, [...type.names, name.text], name.at) };
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
  private fieldToken(object: string, name: Name, described?: boolean, via = 'token'): Value {
    const checked = this.schema.field(object, name.text);
    const made = this.add(name, 'references', checked, via, { object });
    this.notDescribed(name, checked, object);
    const type: Type = {
      k: 'fieldToken',
      object,
      field: name.text,
      ...(described === undefined ? {} : { described }),
      ...(via === 'text' ? { text: name } : {}),
    };
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
    else this.choose(at, constructors, values, undefined, 'new', expr.args);
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
    // A token that a text named stays a name in a text.
    const via = type.text === undefined ? 'token' : 'text';
    this.add(at, 'references', this.schema.field(type.object, type.field), via, { object: type.object });
  }

  /**
   * Whether an argument is a text or the token of a field, which `get` of a record takes, and not a number, which
   * `get` of a list takes. Only what the syntax and the declarations show counts.
   */
  private textOrToken(arg: Expr): boolean {
    if (arg.kind === 'string') return true;
    // `prefix + 'Amount__c'`: a text put together.
    if (arg.kind === 'binary' && arg.op.trim() === '+')
      return this.textOrToken(arg.left) || this.textOrToken(arg.right);
    let first: Expr = arg;
    while (first.kind === 'dot') first = first.target;
    if (first.kind !== 'name') return false;
    const folded = foldName(first.name.text);
    const local = this.lookup(folded);
    const member = local === undefined ? this.findVar(this.context.cls, folded) : undefined;
    const isTextOrToken = (type: Type): boolean =>
      type.k === 'fieldToken' || (type.k === 'prim' && type.name === 'string');
    if (arg.kind === 'name') {
      if (local !== undefined) return isTextOrToken(local.type);
      return member !== undefined && isTextOrToken(this.resolveType(member.type, member.owner));
    }
    // `InvoiceConstants.FIELD_LEGACY`: a constant of a class that is a text or a token.
    const found =
      local === undefined && member === undefined ? this.findClass([first.name.text], this.context.cls) : undefined;
    if (arg.kind === 'dot' && found !== undefined && !isOpaque(found)) {
      const constant = this.findVar(found, foldName(arg.name.text), false);
      return constant !== undefined && isTextOrToken(this.resolveType(constant.type, constant.owner));
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
          this.byName(args[0], method === 'get' ? 'reads' : 'writes', type, expr.name);
          rest(1);
          // `get` gives an `Object`, whichever field it reads.
          return method === 'get' ? { type: prim('object') } : VALUE;
        }
        if (RELATIONSHIP_METHODS.has(method) && args[0] !== undefined) {
          const value = this.byRelationship(args[0], method, type, expr.name);
          rest(1);
          return value;
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
      case 'fieldMap':
      case 'describes': {
        // `fields.getMap().get(name)` names a field of the object, `Schema.getGlobalDescribe().get(name)` an object.
        if (method === 'get' && args[0] !== undefined) {
          const value =
            type.k === 'fieldMap'
              ? this.fieldByName(args[0], type.object, expr.name)
              : this.objectByName(args[0], expr.name);
          rest(1);
          return value;
        }
        rest(0);
        const item: Type =
          type.k === 'fieldMap'
            ? { k: 'fieldToken', object: type.object, field: undefined, described: false }
            : { k: 'objectToken', object: undefined };
        if (method === 'values') return { type: { k: 'list', of: item, coll: 'list' } };
        return method === 'keyset' ? { type: { k: 'list', of: prim('string'), coll: 'set' } } : VALUE;
      }
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
        return this.choose(expr.name, methods, values, on, 'call', args);
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
      case 'fields':
        rest(0);
        return method === 'getmap' ? { type: { k: 'fieldMap', object: type.object } } : VALUE;
      case 'ns':
        return this.system(type.name, expr);
      default: {
        // A value of no class known here can be of a class of the snapshot, whose method the call runs.
        if (type.k === 'other' || type.k === 'named') this.unknownCall(method, args.length);
        // Only a record has `get` and `put` with a field token, also one whose type is not known here.
        if (
          (method === 'get' || method === 'put') &&
          args[0] !== undefined &&
          (type.k === 'other' || type.k === 'named')
        ) {
          this.byToken(this.ev(args[0]), args[0], method === 'get' ? 'reads' : 'writes');
          rest(1);
          return VALUE;
        }
        const values = args.map((arg) => this.ev(arg));
        // `String.valueOf(flag)`, `Decimal.valueOf(text)`: a value of the primitive type named in front.
        if (type.k === 'other' && expr.target.kind === 'name') {
          const named = foldName(expr.target.name.text);
          if (named === 'string' && (TEXT_METHODS.has(method) || method === 'valueof')) {
            return this.ofString(method, args, values, expr.name);
          }
          if (method === 'valueof' && PRIMITIVES.has(named) && named !== 'object') return { type: prim(named) };
        }
        if (type.k === 'prim' && type.name === 'string') return Resolver.ofText(target, method, values);
        return VALUE;
      }
    }
  }

  /**
   * A call of a method of a name and a number of arguments that is not known, where the member is worked out for its
   * callers: it can be a call of a method of the snapshot (`called`).
   */
  private unknownCall(method: string, args: number): void {
    this.context.unknownCalls?.add(`${method}/${String(args)}`);
  }

  /** What a method of `String` gives that makes a text: `join`, `format`, `escapeSingleQuotes` and `valueOf`. */
  private ofString(method: string, args: readonly Expr[], values: readonly Value[], at: Name): Value {
    const type = prim('string');
    const [first, second] = values;
    const texts = ((): Texts | undefined => {
      if (first === undefined) return undefined;
      switch (method) {
        case 'join': {
          // The items of a list the code writes out, with the text that stands between them.
          if (first.items === undefined) return undefined;
          const between = second !== undefined && args[1] !== undefined ? this.textsOf(second, args[1]) : [[]];
          let all: Texts = [[]];
          for (const [index, item] of first.items.entries()) {
            if (item === undefined) return undefined;
            all = joined(index > 0 ? joined(all, between) : all, item);
          }
          return all;
        }
        case 'format': {
          const items = second?.items;
          const formats = first.texts;
          if (formats === undefined) return undefined;
          const place = Resolver.placeOf(args[1]) ?? at.at;
          return eitherText(formats.map((format) => formatted(format, items, place)));
        }
        case 'escapesinglequotes':
          return first.texts?.map(escaped);
        default:
          // `String.valueOf(x)`: the text of a text, or of a number the code writes.
          return first.texts;
      }
    })();
    return texts === undefined ? { type } : { type, texts };
  }

  /** What a method of a text gives that is the text changed in a way that keeps its names. */
  private static ofText(target: Value, method: string, values: readonly Value[]): Value {
    const type = prim('string');
    const { texts } = target;
    const [first] = values;
    const only = first?.texts?.length === 1 && first.texts[0] !== undefined ? known(first.texts[0]) : undefined;
    const changed = ((): Texts | undefined => {
      switch (method) {
        case 'tolowercase':
          return texts?.map((text) => mapped(text, (chars) => chars.toLowerCase()));
        case 'touppercase':
          return texts?.map((text) => mapped(text, (chars) => chars.toUpperCase()));
        case 'trim':
          return texts?.map(trimmed);
        case 'removeend':
          return only === undefined ? undefined : texts?.map((text) => withoutEnd(text, only));
        case 'removestart':
          return only === undefined ? undefined : texts?.map((text) => withoutStart(text, only));
        default:
          return undefined;
      }
    })();
    if (!['tolowercase', 'touppercase', 'trim', 'removeend', 'removestart'].includes(method)) return VALUE;
    const all = changed === undefined ? undefined : distinct(changed);
    return all === undefined ? { type } : { type, texts: all };
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
      else this.choose(expr.name, constructors, values, undefined, 'call', expr.args);
      return VALUE;
    }
    for (let at: ClassInfo | undefined = cls; at !== undefined; at = at.outer) {
      const methods = this.methodsOf(at, method).filter((one) => one.params.length === values.length);
      if (methods.length > 0) return this.choose(expr.name, methods, values, at, 'call', expr.args);
    }
    this.unknownCall(method, values.length);
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
      modifiers: [],
      annotations: [],
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
    args?: readonly Expr[],
  ): Value {
    const { chosen, sure } = this.overload(
      methods.filter((one) => one.params.length === values.length),
      values,
    );
    // The constructors every exception has are of the class, which each of them calls.
    const builtin = chosen.every((one) => one.builtin === true);
    /** The methods that can run for the call. */
    const run = new Set<MethodInfo>(chosen);
    for (const one of chosen) {
      // `this(message)` of an exception calls a constructor of Salesforce.
      if (one.builtin === true && via === 'call' && one.owner === this.context.cls) continue;
      this.addCall(at, Resolver.targetOf(one), sure || builtin ? 'confirmed' : 'probable', via);
      if (on === undefined || !one.open) continue;
      const runs = this.methodsOf(on, one.name).find((each) => each.sub === one.sub);
      if (runs !== undefined && runs !== one) {
        this.addCall(at, Resolver.targetOf(runs), 'probable', via);
        run.add(runs);
      }
      for (const override of this.overrides(on, runs ?? one)) {
        this.addCall(at, Resolver.targetOf(override), 'probable', via);
        run.add(override);
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
    const { calls } = this.context;
    if (calls !== undefined) for (const one of run) if (one.builtin !== true) calls.add(one);
    if (args !== undefined) this.replay(at, run, values, args);
    const [first] = chosen;
    if (first === undefined) return VALUE;
    const spelled = (one: MethodInfo): string => (one.returns === undefined ? '' : typeText(one.returns));
    if (!chosen.every((one) => spelled(one) === spelled(first))) return VALUE;
    const type = this.resolveType(first.returns, first.owner);
    if (type.k !== 'prim' || type.name !== 'string' || args === undefined) return { type };
    // A text that a method of the snapshot gives back, with what the call gives its parameters.
    const given = values.map((value, index) => {
      const arg = args[index];
      return arg === undefined ? undefined : this.textsOf(value, arg);
    });
    const texts: Texts[] = [];
    for (const one of run) {
      const template = this.template(one);
      if (template === undefined) return { type };
      texts.push(usedAt(template, at.at, given));
    }
    return { type, texts: eitherText(texts) };
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
  private byToken(value: Value, arg: Expr, kind: 'reads' | 'writes'): void {
    const { type } = value;
    const at = anchor(arg);
    if (type.k !== 'fieldToken' || type.object === undefined || type.field === undefined || at === undefined) return;
    const checked = this.schema.field(type.object, type.field);
    if (type.text === undefined) {
      this.retract(value.made);
      this.add(at, kind, checked, 'token', { object: type.object });
      return;
    }
    // A token that a text named stays a name in a text: read where the text stands when the code reads it right
    // there (`record.get(fields.getMap().get('Amount__c'))`), and where the code uses the token otherwise.
    const made = value.made ?? [];
    this.retract(made);
    this.add(made.length > 0 ? type.text : at, kind, checked, 'text', { object: type.object });
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
    const rest = (from: number): void => {
      for (const arg of args.slice(from)) this.ev(arg);
    };
    const binds = TEXT_QUERIES.get(method);
    if (first !== undefined && namespace === 'database' && binds !== undefined) {
      // `Database.query(soql)`: the text of a query.
      const read = this.textQuery(first, this.ev(first), 'soql', binds, expr.name);
      rest(1);
      if (!DATABASE_QUERIES.has(method)) return VALUE;
      return { type: read?.k === 'list' ? read : { k: 'list', of: { k: 'record', object: undefined } } };
    }
    if (first !== undefined && namespace === 'search' && (method === 'query' || method === 'find')) {
      const read = this.textQuery(first, this.ev(first), 'sosl', true, expr.name);
      rest(1);
      return method === 'query' && read !== undefined ? { type: read } : VALUE;
    }
    if (namespace === 'schema' && method === 'getglobaldescribe') {
      rest(0);
      return { type: { k: 'describes' } };
    }
    if (first !== undefined && namespace === 'schema' && method === 'describesobjects') {
      const value = this.describeObjects(first, this.ev(first), expr.name);
      rest(1);
      return value;
    }
    if (namespace === 'type' && method === 'forname') return this.forNameText(expr);
    rest(0);
    if (namespace === 'database' && DATABASE_QUERIES.has(method)) {
      return { type: { k: 'list', of: { k: 'record', object: undefined } } };
    }
    return VALUE;
  }

  // -------------------------------------------------------------- names in texts

  /** A reference to an object of which a text names something that is not known: `possible` (decision record 0012). */
  private possible(at: Pos, kind: 'reads' | 'writes' | 'references', object: string): void {
    // Where a parameter enters the text, the calls of the method say what it names.
    if (this.silent(at)) return;
    const checked = this.schema.object(object);
    // An object that nothing defines has no field that the snapshot holds, and a name of it says that it is not
    // found.
    if (checked.target.to === null) return;
    this.add({ text: object, at }, kind, checked, 'text', { tier: 'possible' });
  }

  /**
   * The warning that nothing says which object the field a text names is of, or which object the relationship the
   * record was reached through leads to.
   */
  private fieldNotKnown(name: Name, record?: Extract<Type, { k: 'record' }>): void {
    if (foldName(name.text) === 'id') return;
    if (record?.through !== undefined) {
      this.notFollowed(record.through, [name.text], name.at);
      return;
    }
    this.warn(
      name,
      'PATH_NOT_FOLLOWED',
      `nothing says which object "${cut(name.text, 80)}" is a field of, so it was not followed.`,
      { notFollowed: [name.text], endsAt: 'field', origin: 'parser:apex' },
    );
  }

  /**
   * The warning that a name the code holds in a text is not known here: of a field of an object nothing says, of an
   * object, of a class, or the text of a query or a search as a whole. It stands where the text is not known, or at
   * `sink` where nothing says where that is.
   */
  private nameNotKnown(at: Pos | undefined, sink: Name, what: 'field' | 'object' | 'class' | 'query' | 'search'): void {
    const message =
      what === 'field'
        ? 'the name of the field is a text that is not known here, and nothing says which object it is a field of, so it was not followed.'
        : what === 'object'
          ? 'the name of the object is a text that is not known here, so it was not followed.'
          : what === 'class'
            ? 'the name of the class is a text that is not known here, so it was not followed.'
            : `the text of the ${what} is not known here, so what it reads was not followed.`;
    // Only an object can be named by a name of an object, and a field by any other.
    const ends = what === 'object' ? { endsAt: 'object' } : {};
    this.warn({ text: '', at: at ?? sink.at }, 'PATH_NOT_FOLLOWED', message, {
      notFollowed: [],
      ...ends,
      origin: 'parser:apex',
    });
  }

  /** The name of a whole text, at the place of its first character, or at `sink`. */
  private static named(name: { readonly text: string; readonly at: Pos | undefined }, sink: Name): Name {
    return { text: name.text, at: name.at ?? sink.at };
  }

  /** `record.get(name)` and `record.put(name, value)`: a token or a text names the field that is read or written. */
  private byName(arg: Expr, kind: 'reads' | 'writes', record: RecordType, sink: Name): void {
    const value = this.ev(arg);
    if (value.type.k === 'fieldToken') {
      this.byToken(value, arg, kind);
      return;
    }
    if (!Resolver.isText(value)) return;
    const texts = this.textsOf(value, arg);
    this.atSink({ k: 'field', kind, record }, sink, [texts]);
    this.namedField(texts, kind, record, sink);
  }

  /** The field each text names, which a record of `record` reads or writes. */
  private namedField(texts: Texts, kind: 'reads' | 'writes', record: RecordType, sink: Name): void {
    const { object } = record;
    for (const text of texts) {
      this.own(text);
      const found = nameIn(text);
      if ('unknown' in found && this.methodSays(found.unknown)) continue;
      if ('name' in found) {
        const name = Resolver.named(found.name, sink);
        if (object === undefined) this.fieldNotKnown(name, record);
        else this.naming('text', () => this.field(object, name, kind === 'reads' ? 'read' : 'write', false));
      } else if (object !== undefined) this.possible(found.unknown ?? sink.at, kind, object);
      else this.nameNotKnown(found.unknown, sink, 'field');
    }
  }

  /**
   * `record.getSObject(name)`, `record.getSObjects(name)` and `record.putSObject(name, value)`: a text names a
   * relationship, or a child relationship, which is read as the code reads one after a dot.
   */
  private byRelationship(arg: Expr, method: string, record: RecordType, sink: Name): Value {
    const value = this.ev(arg);
    if (!Resolver.isText(value)) return this.namedRelationship([], method, record, sink);
    const texts = this.textsOf(value, arg);
    this.atSink({ k: 'relationship', method, record }, sink, [texts]);
    return this.namedRelationship(texts, method, record, sink);
  }

  /** The relationship each text names, of a record of `record`, with what `method` gives through it. */
  private namedRelationship(texts: Texts, method: string, record: RecordType, sink: Name): Value {
    const { object } = record;
    const children = method === 'getsobjects';
    const write = method === 'putsobject';
    const none: Value = {
      type: children ? { k: 'list', of: { k: 'record', object: undefined } } : { k: 'record', object: undefined },
    };
    const found: Value[] = [];
    for (const text of texts) {
      this.own(text);
      const one = nameIn(text);
      if ('unknown' in one && this.methodSays(one.unknown)) continue;
      if ('name' in one) {
        const name = Resolver.named(one.name, sink);
        if (object === undefined) this.fieldNotKnown(name, record);
        else {
          found.push(
            this.naming('text', () =>
              children
                ? this.asList(this.field(object, name, 'read', false))
                : this.field(object, name, write ? 'write' : 'read', true),
            ),
          );
        }
      } else if (object !== undefined) this.possible(one.unknown ?? sink.at, write ? 'writes' : 'reads', object);
      else this.nameNotKnown(one.unknown, sink, 'field');
    }
    const [only] = found;
    return write ? VALUE : found.length === 1 && only !== undefined ? { type: only.type } : none;
  }

  /** `fields.getMap().get(name)`: a text names a field of the object, which gives its token. */
  private fieldByName(arg: Expr, object: string | undefined, sink: Name): Value {
    const value = this.ev(arg);
    if (!Resolver.isText(value)) return this.namedToken([], object, sink);
    const texts = this.textsOf(value, arg);
    this.atSink({ k: 'fieldMap', object }, sink, [texts]);
    return this.namedToken(texts, object, sink);
  }

  /** The field of `object` each text names, with its token. */
  private namedToken(texts: Texts, object: string | undefined, sink: Name): Value {
    const none: Value = { type: { k: 'fieldToken', object, field: undefined, described: false } };
    const found: Value[] = [];
    for (const text of texts) {
      this.own(text);
      const one = nameIn(text);
      if ('unknown' in one && this.methodSays(one.unknown)) continue;
      if ('name' in one) {
        const name = Resolver.named(one.name, sink);
        if (object === undefined) this.fieldNotKnown(name);
        else found.push(this.fieldToken(object, name, false, 'text'));
      } else if (object !== undefined) this.possible(one.unknown ?? sink.at, 'references', object);
      else this.nameNotKnown(one.unknown, sink, 'field');
    }
    const [only] = found;
    return found.length === 1 && only !== undefined ? only : none;
  }

  /** `Schema.getGlobalDescribe().get(name)`: a text names an object, which gives its token. */
  private objectByName(arg: Expr, sink: Name): Value {
    const texts = this.textsOrNone(this.ev(arg), arg);
    this.atSink({ k: 'object' }, sink, [texts]);
    const objects = this.objectsNamed(texts, sink);
    const [only] = objects;
    return { type: { k: 'objectToken', object: objects.length === 1 ? only : undefined } };
  }

  /** `Schema.describeSObjects(names)`: each text of the list the code writes out names an object. */
  private describeObjects(arg: Expr, value: Value, sink: Name): Value {
    const objects: string[] = [];
    if (value.items === undefined) this.nameNotKnown(Resolver.placeOf(arg), sink, 'object');
    for (const item of value.items ?? []) {
      const texts = item ?? [holeText(sink.at, 'text')];
      this.atSink({ k: 'object' }, sink, [texts]);
      objects.push(...this.objectsNamed(texts, sink));
    }
    const [only] = objects;
    const object = objects.length === 1 ? only : undefined;
    return { type: { k: 'list', of: { k: 'describe', object }, coll: 'list' } };
  }

  /** The texts of a value that can be a text, and none of one that cannot. */
  private textsOrNone(value: Value, arg: Expr): Texts {
    return Resolver.isText(value) ? this.textsOf(value, arg) : [];
  }

  /** Each object the texts name, with a reference to it, and the warning where a text is not known. */
  private objectsNamed(texts: Texts, sink: Name): string[] {
    const objects: string[] = [];
    for (const text of texts) {
      this.own(text);
      const one = nameIn(text);
      if ('unknown' in one && this.methodSays(one.unknown)) continue;
      if ('name' in one) {
        const name = Resolver.named(one.name, sink);
        this.add(name, 'references', this.schema.object(name.text), 'text');
        if (!objects.includes(name.text)) objects.push(name.text);
      } else this.nameNotKnown(one.unknown, sink, 'object');
    }
    return objects;
  }

  /**
   * `Type.forName(name)` and `Type.forName(namespace, name)` with a text that is no literal: the class it names, as
   * a literal names one (`apex.ts`), which the call uses as a type.
   */
  private forNameText(expr: Extract<Expr, { kind: 'call' }>): Value {
    const values = expr.args.map((arg) => this.ev(arg));
    const type: Value = { type: { k: 'named', name: 'Type' } };
    if (forName(expr) !== undefined || values.length === 0 || values.length > 2) return type;
    const at = values.length - 1;
    const [value, arg] = [values[at], expr.args[at]];
    if (value === undefined || arg === undefined || !Resolver.isText(value)) return type;
    // The namespace: none where it is an empty text or `null`.
    const [space, spaceArg] = [
      values.length === 2 ? values[0] : undefined,
      expr.args.length === 2 ? expr.args[0] : undefined,
    ];
    const spaces =
      space === undefined || spaceArg === undefined
        ? undefined
        : spaceArg.kind === 'literal' && foldName(spaceArg.text) === 'null'
          ? [[]]
          : this.textsOf(space, spaceArg);
    const names = this.textsOf(value, arg);
    this.atSink(
      { k: 'class', space: spaces !== undefined },
      expr.name,
      spaces === undefined ? [names] : [spaces, names],
    );
    this.namedClass(spaces, names, expr.name);
    return type;
  }

  /** The class each text names, in the namespace each of `spaces` names, or in none. */
  private namedClass(spaces: Texts | undefined, names: Texts, sink: Name): void {
    const prefixes: (string | undefined)[] = [];
    for (const text of spaces ?? [[]]) {
      const whole = known(text);
      if (whole === undefined) {
        this.nameNotKnown(text.find((piece) => piece.k === 'hole')?.at, sink, 'class');
        return;
      }
      prefixes.push(whole === '' ? undefined : whole);
    }
    const { replay } = this.context;
    const spaced = replay !== undefined && (spaces ?? []).some((text) => charsBeside(text, replay.at));
    for (const text of names) {
      this.own(text, spaced);
      const whole = known(text);
      const start = text[0]?.at;
      if (whole === undefined || !/^[A-Za-z]\w*(?:\.[A-Za-z]\w*)?$/.test(whole)) {
        const unknown = nameIn(text);
        if (!('unknown' in unknown && this.methodSays(unknown.unknown))) {
          this.nameNotKnown('unknown' in unknown ? unknown.unknown : start, sink, 'class');
        }
        continue;
      }
      for (const prefix of prefixes) {
        const target = this.types.find(prefix === undefined ? whole : `${prefix}.${whole}`, this.context.unit.key);
        if (target === undefined || target.to === this.context.from) continue;
        const checked: Checked = { target, checked: true, known: true, notDescribed: false };
        this.add({ text: whole, at: start ?? sink.at }, 'uses-type', checked, 'text');
      }
    }
  }

  /**
   * The text of a query or a search (`kind`) that a method of `Database` or `Search` runs: each text it can be is
   * read as a query, and the names in it are reported where they stand in the code, at `probable`. Gives the type
   * of what the query gives, or `undefined` where the value is no text.
   */
  private textQuery(arg: Expr, value: Value, kind: 'soql' | 'sosl', binds: boolean, sink: Name): Type | undefined {
    if (!Resolver.isText(value)) return undefined;
    const texts = this.textsOf(value, arg);
    this.atSink({ k: 'text', kind }, sink, [texts]);
    return this.readQuery(texts, kind, binds, sink);
  }

  /** The texts of a query or a search, each read as one. Gives the type of what the query gives. */
  private readQuery(all: Texts, kind: 'soql' | 'sosl', binds: boolean, sink: Name): Type | undefined {
    const texts = all.map((text) => this.parsedText(text, kind));
    // The parts that are not known of the texts that are read as a query.
    const read = texts.some((one) => one.read !== undefined) ? new Set<string>() : undefined;
    for (const one of texts) {
      if (one.read !== undefined)
        for (const filled of one.put.filled) if (filled.at !== undefined) read?.add(placeKey(filled.at));
    }
    let type: Type | undefined;
    for (const one of texts) {
      const found = this.readText(one, kind, binds, sink, read);
      type = type === undefined ? found : this.eitherType(type, found);
    }
    return type;
  }

  // -------------------------------------------------------------- texts a method is given

  /** Keeps what a member does with a text that holds a parameter, where the member is worked out for its callers. */
  private atSink(sink: Sink, name: Name, slots: readonly (Texts | undefined)[]): void {
    if (this.context.uses !== undefined && slots.some((slot) => slot !== undefined && holdsParam(slot))) {
      this.keep({ sink, name, slots });
    }
  }

  /** Keeps a use of a member that is worked out for its callers, once: a use kept twice would be read twice. */
  private keep(use: Use): void {
    const { uses, kept } = this.context;
    if (uses === undefined || kept === undefined) return;
    const key = JSON.stringify([use.sink, use.name, use.slots]);
    if (kept.has(key)) return;
    kept.add(key);
    uses.push(use);
  }

  /** What a use of a text does, read with the texts it is given. */
  private readSink(sink: Sink, name: Name, slots: readonly (Texts | undefined)[]): void {
    const [first = [], second = []] = slots;
    switch (sink.k) {
      case 'field':
        this.namedField(first, sink.kind, sink.record, name);
        return;
      case 'relationship':
        this.namedRelationship(first, sink.method, sink.record, name);
        return;
      case 'fieldMap':
        this.namedToken(first, sink.object, name);
        return;
      case 'object':
        this.objectsNamed(first, name);
        return;
      case 'class':
        if (sink.space) this.namedClass(first, second, name);
        else this.namedClass(undefined, first, name);
        return;
      case 'text':
        // What the query binds is code of the method, which the method reads.
        this.readQuery(first, sink.kind, false, name);
        return;
    }
  }

  /** A use of a text, as a call at `at` reads it: the relationship a record was reached through stands at the call. */
  private static movedSink(sink: Sink, at: Pos): Sink {
    if (sink.k !== 'field' && sink.k !== 'relationship') return sink;
    const { through } = sink.record;
    if (through === undefined) return sink;
    return { ...sink, record: { ...sink.record, through: { ...through, name: { ...through.name, at } } } };
  }

  /**
   * Reads again, at a call at `at`, what each method the call can run does with a text that holds a parameter of the
   * type `String`, with the texts the call gives (decision record 0091). What the call gives is the caller's, and is
   * reported by it where its characters stand. Where the caller is worked out for its own callers, a use that holds a
   * parameter of it is kept for them.
   */
  private replay(at: Name, run: ReadonlySet<MethodInfo>, values: readonly Value[], args: readonly Expr[]): void {
    const ctx = this.context;
    if (ctx.quiet && ctx.uses === undefined) return;
    for (const one of run) {
      if (one.builtin === true) continue;
      const strings = one.params.map((_, index) => {
        const type = this.paramType(one, index);
        return type.k === 'prim' && type.name === 'string';
      });
      if (!strings.includes(true)) continue;
      const worked = this.work(one.key);
      // What a method of a group that calls each other does is worked out without what the others do, and a method
      // that calls itself without what it does again: it says what it does not know of a text it is handed.
      if (worked === undefined || (ctx.uses !== undefined && this.looping.has(one.key))) continue;
      const { uses } = worked;
      if (uses.length === 0) continue;
      const given = values.map((value, index) => {
        const arg = args[index];
        return arg === undefined || strings[index] !== true ? undefined : this.textsOf(value, arg);
      });
      // Uses that differ in the method can be the same at the call, where all its characters stand.
      const read = new Set<string>();
      for (const use of uses) {
        const slots = use.slots.map((slot) => (slot === undefined ? undefined : usedAt(slot, at.at, given)));
        const sink = Resolver.movedSink(use.sink, at.at);
        const name: Name = { text: use.name.text, at: at.at };
        if (ctx.uses !== undefined) {
          if (slots.some((slot) => slot !== undefined && holdsParam(slot))) this.keep({ sink, name, slots });
          continue;
        }
        const key = JSON.stringify([sink, name, slots]);
        if (read.has(key)) continue;
        read.add(key);
        const before = ctx.replay;
        ctx.replay = { at: at.at, all: false };
        try {
          this.readSink(sink, name, slots);
        } finally {
          ctx.replay = before;
        }
      }
    }
  }

  /**
   * While a use is read again at a call: whether a part of a name that is not known stands at the call, where every
   * character and every part of the method that is called stands. The method says itself what it does not know.
   */
  private methodSays(at: Pos | undefined): boolean {
    const { replay } = this.context;
    return replay !== undefined && at !== undefined && samePlace(at, replay.at);
  }

  /**
   * While a use is read again at a call: whether the names a text holds are of the caller, where it holds characters
   * that the call gives, or `also`. The names of the method that is called stand at the call, and the method reports
   * them.
   */
  private own(text: Text, also = false): void {
    const { replay, blocked } = this.context;
    if (replay !== undefined) replay.all = also || charsBeside(text, replay.at);
    // A name that holds a parameter and something else that is not known is not known whatever a call gives. What
    // stands at a call that reads a use again is of the method that is called, which says so itself.
    const place = blocked === undefined ? undefined : argBesideOther(text, replay?.at);
    if (place !== undefined) blocked?.add(placeKey(place));
  }

  /**
   * While a use is read again at a call: what a query or a search reads of an object the caller names is of the
   * caller, also the names the method wrote, which it could not report.
   */
  private owning<T>(object: Name | undefined, run: () => T): T {
    const { replay } = this.context;
    if (replay === undefined || object === undefined) return run();
    const before = replay.all;
    replay.all = !samePlace(object.at, replay.at);
    try {
      return run();
    } finally {
      replay.all = before;
    }
  }

  /** A text of a query or a search, put together and read, where it can be read. */
  private parsedText(text: Text, kind: 'soql' | 'sosl'): ParsedText {
    const put = composed(text);
    const whole = text.every((piece) => piece.k === 'hole');
    const read =
      whole || this.reader === undefined
        ? undefined
        : kind === 'soql'
          ? this.reader.parseQuery(put.source)
          : this.reader.parseSearch(put.source);
    return { text, put, whole, read };
  }

  /**
   * The names of a text of a query or a search. `read` holds the places of the parts that are not known of each text
   * of the same value that was read, and is `undefined` where none was.
   */
  private readText(
    parsed: ParsedText,
    kind: 'soql' | 'sosl',
    binds: boolean,
    sink: Name,
    read: ReadonlySet<string> | undefined,
  ): Type {
    const { text, put, whole } = parsed;
    const records: Type = { k: 'record', object: undefined };
    const none: Type = kind === 'soql' ? { k: 'list', of: records } : { k: 'list', of: { k: 'list', of: records } };
    const first = text.find((piece) => piece.at !== undefined)?.at;
    // Read again at a call, a text that is not read as a query is the caller's where the call gives characters of
    // it, and what a query reads is the caller's where the caller names its object (`owning`).
    this.own(parsed.read === undefined ? text : []);
    if (parsed.read === undefined) {
      // A text that is not read as a query: the object after `FROM`, where it is known, is read with what is not
      // known of it (decision record 0012). A text that the code can only put together where it holds no query,
      // such as `WHERE` without a condition, where it holds a query as each other text does, adds nothing: what is
      // not known of it is not known of a text that was read.
      const object = kind === 'soql' && !whole ? Resolver.objectAfterFrom(put) : undefined;
      const covered =
        !whole && read !== undefined && put.filled.every((one) => one.at !== undefined && read.has(placeKey(one.at)));
      if (object !== undefined) this.possible(object.at, 'reads', object.name);
      else if (whole) this.nameNotKnown(first, sink, kind === 'soql' ? 'query' : 'search');
      else if (!covered) this.textNotRead(put.filled[0]?.at ?? first, sink, kind, put.filled.length > 0);
      return none;
    }
    const { read: query } = parsed;
    // Each name stands where its first character stands in the code. A name for a part that is not known stands
    // where that part enters the text.
    const holes = put.filled.map((one) => (one.named ? { ...(one.at ?? sink.at) } : undefined));
    // A name that a part that is not known stands in, as `ns + '__Field__c'`, stands for that part.
    const place = (at: Pos, length: number): Pos => {
      const offset = at.column - 1;
      const hole = put.filled.findIndex(
        (one, index) => holes[index] !== undefined && offset < one.end && offset + length > one.start,
      );
      return holes[hole] ?? put.places[offset] ?? sink.at;
    };
    const outer = { holes: this.holes, met: this.met, binds: this.textBinds };
    this.holes = new Set(holes.filter((one) => one !== undefined));
    this.met = new Set();
    this.textBinds = binds;
    try {
      const moved = relocated(query, place);
      const type = this.naming('text', () =>
        kind === 'soql' ? this.soql(moved as Query) : this.sosl(moved as Search),
      );
      // A part that is not known and that no name of the text stands for can name fields of the object.
      const from = kind === 'soql' ? (moved as Query).from : [];
      const [object, ...more] = from;
      const known = object !== undefined && more.length === 0 && !this.holes.has(object.at) ? object.text : undefined;
      for (const at of holes) {
        if (at === undefined || this.met.has(at)) continue;
        if (known !== undefined) this.possible(at, 'reads', known);
        else this.nameNotKnown(at, sink, 'field');
      }
      return type;
    } finally {
      this.holes = outer.holes;
      this.met = outer.met;
      this.textBinds = outer.binds;
    }
  }

  /**
   * The warning that a text the code shows, or a part of it, is not read as a query or a search: Salesforce would
   * refuse it as it is written, or the reader does not know it.
   */
  private textNotRead(at: Pos | undefined, sink: Name, kind: 'soql' | 'sosl', partly: boolean): void {
    const what = kind === 'soql' ? 'query' : 'search';
    const message = partly
      ? `the text of the ${what} is known only in part here, and it could not be read as a ${what} as far as it is known, so what it reads was not followed.`
      : `the text of the ${what} could not be read as a ${what}, so what it reads was not followed.`;
    this.warn({ text: '', at: at ?? sink.at }, 'PATH_NOT_FOLLOWED', message, {
      notFollowed: [],
      origin: 'parser:apex',
    });
  }

  /**
   * The object after `FROM` in the characters of a text that is not read as a query, at its place: the `FROM` outside
   * brackets, and not that of a subquery.
   */
  private static objectAfterFrom(put: Composed): { name: string; at: Pos } | undefined {
    for (const match of put.source.matchAll(/\bfrom\s+([A-Za-z][A-Za-z0-9_]*)/gi)) {
      const before = put.source.slice(0, match.index);
      if (before.split('(').length !== before.split(')').length) continue;
      const start = match.index + match[0].length - (match[1]?.length ?? 0);
      const filled = put.filled.some((one) => start < one.end && start + (match[1]?.length ?? 0) > one.start);
      const at = put.places[start];
      if (!filled && at !== undefined && match[1] !== undefined) return { name: match[1], at };
    }
    return undefined;
  }

  /** Whether a name of a text that is read stands for a part of it that is not known. It is met then. */
  private isHole(name: Name): boolean {
    if (this.holes.size === 0 || !this.holes.has(name.at)) return false;
    this.met.add(name.at);
    return true;
  }

  // -------------------------------------------------------------- queries and searches

  /** Runs `run` with the fields and variables it names named as `via`. */
  private naming<T>(via: 'soql' | 'sosl' | 'text', run: () => T): T {
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
    return this.owning(query.from[0], () => this.soqlOf(query));
  }

  private soqlOf(query: Query): Type {
    const [from, ...more] = query.from;
    if (from !== undefined && this.isHole(from)) {
      // `'SELECT Name FROM ' + objectName`: the names of the query are of an object nothing says.
      this.warn(
        from,
        'PATH_NOT_FOLLOWED',
        'the object of the query is a text that is not known here, so the query was not followed.',
        { notFollowed: this.namesOfQuery(query), endsAt: 'object', origin: 'parser:apex' },
      );
      this.queried(query, undefined);
      return { k: 'list', of: { k: 'record', object: undefined } };
    }
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
    if (this.textBinds) for (const bind of query.binds) this.ev(bind);
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
    for (const [index, name] of path.entries()) {
      if (this.isHole(name)) {
        // `'SELECT Account__r.' + field + ' FROM Invoice__c'`: a field of the object the path leads to.
        const { type } = value;
        if (type.k === 'record' && type.object !== undefined) this.possible(name.at, 'reads', type.object);
        else this.nameNotKnown(name.at, name, 'field');
        return VALUE;
      }
      value = this.dot(value, name, 'read', index < path.length - 1);
    }
    return value;
  }

  /** The names of paths of a text that was read, without the parts of it that are not known. */
  private namesOutside(paths: readonly FieldPath[]): string[] {
    return namesOf(paths.filter((path) => !path.some((name) => this.holes.has(name.at))));
  }

  /**
   * The names a query of an object that is not known holds beside its object: its fields, the child relationship of
   * each subquery of its select list with what the subquery names, and each `TYPEOF` with what it names.
   */
  private namesOfQuery(query: Query): string[] {
    const paths: FieldPath[] = [];
    const visit = (one: Query): void => {
      paths.push(...one.fields);
      for (const child of one.children) {
        paths.push(child.from.slice(-1));
        visit(child);
      }
      for (const typeOf of one.typeOfs) {
        paths.push(typeOf.relationship, ...typeOf.whens.flatMap((when) => when.fields), ...typeOf.otherwise);
      }
    };
    visit(query);
    return this.namesOutside(paths);
  }

  /**
   * A subquery of the select list, through a child relationship of `parent`: the relationship refers to the lookup
   * field of the child object that defines it, and the subquery reads that object. Of a relationship that nothing
   * defines the lookup field can have any name, so a warning stands for the subquery.
   */
  private childQuery(parent: string, child: Query, prefixes: readonly (string | undefined)[]): void {
    const from = Resolver.unprefixed(child.from, prefixes);
    const name = from.at(-1);
    if (from.some((one) => this.isHole(one)) && name !== undefined) {
      this.warn(
        name,
        'PATH_NOT_FOLLOWED',
        `the child relationship of a subquery of "${cut(parent, 80)}" is a text that is not known here, so the subquery was not followed.`,
        { notFollowed: this.namesOutside(child.fields), origin: 'parser:apex' },
      );
      this.meet(child);
      this.queried(child, undefined);
      return;
    }
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
        { relationship: name.text, notFollowed: this.namesOutside(child.fields), origin: 'parser:apex' },
      );
      // A part of a text that is not known in the subquery is a field of the child: the warning stands for it.
      this.meet(child);
    }
    this.queried(child, undefined);
  }

  /** Meets each part that is not known of a text among the fields of a query and of its subqueries. */
  private meet(query: Query): void {
    for (const name of query.fields.flat()) this.isHole(name);
    for (const child of query.children) this.meet(child);
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
    // A part of a text that is not known stands for the relationship or an object: what is not known of the query
    // names fields of its object.
    const named = [...typeOf.relationship, ...typeOf.whens.map((when) => when.object)];
    if (this.holes.size > 0 && named.some((name) => this.holes.has(name.at))) return;
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
    const names = this.namesOutside(typeOf.otherwise);
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
    if (this.textBinds) for (const bind of search.binds) this.ev(bind);
    for (const { object, fields } of search.returning) {
      this.owning(object, () => {
        if (this.isHole(object)) {
          this.warn(
            object,
            'PATH_NOT_FOLLOWED',
            'an object the search returns is a text that is not known here, so what it reads of it was not followed.',
            { notFollowed: this.namesOutside(fields), endsAt: 'object', origin: 'parser:apex' },
          );
          for (const name of fields.flat()) this.isHole(name);
          return;
        }
        this.add(object, 'reads', this.schema.object(object.text), this.named);
        for (const path of fields) this.fieldPath(object.text, Resolver.unprefixed(path, [foldName(object.text)]));
      });
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

/** The code of a member: the body of a trigger, a method or an initialiser, the accessors of a property, a value. */
function bodiesOf(syntax: ApexPart['syntax']): readonly (Stmt | Expr | undefined)[] {
  switch (syntax.kind) {
    case 'trigger':
      return syntax.trigger.body;
    case 'method':
      return [syntax.member.body];
    case 'property':
      return syntax.member.accessors;
    case 'var':
      return [syntax.declarator.init];
    case 'init':
      return syntax.bodies;
    case 'type':
      return [];
  }
}

/** What a query binds, also in its subqueries. */
function bindsOf(query: Query): Expr[] {
  return [...query.binds, ...query.children.flatMap(bindsOf), ...query.nested.flatMap(bindsOf)];
}

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
export function buildApexResolver(
  units: readonly ApexUnitInput[],
  schema: ApexSchema,
  types: ApexTypes,
  reader?: TextReader,
): ApexResolver {
  return new Resolver(units, schema, types, reader);
}

/** A place as a key of a set. */
const placeKey = (at: Pos): string => `${String(at.line)}:${String(at.column)}`;

const isPos = (value: unknown): value is Pos =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { line?: unknown }).line === 'number' &&
  typeof (value as { column?: unknown }).column === 'number';

/**
 * A query or a search that was read from a text, with each place of it moved to where it stands in the code. The
 * place of a name is moved with the number of its characters.
 */
function relocated(node: unknown, place: (at: Pos, length: number) => Pos): unknown {
  if (Array.isArray(node)) return node.map((one: unknown) => relocated(one, place));
  if (typeof node !== 'object' || node === null) return node;
  const { text } = node as { text?: unknown };
  const length = typeof text === 'string' ? Math.max(text.length, 1) : 1;
  const moved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    moved[key] = key === 'at' && isPos(value) ? place(value, length) : relocated(value, place);
  }
  return moved;
}
