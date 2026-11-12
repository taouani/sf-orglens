/**
 * Candidate B: `web-tree-sitter-sfapex`, the tree-sitter grammar for Apex as WebAssembly.
 *
 * The tree of the parser has one kind of node, with a type name and named fields. This file lowers it into the
 * model of `../syntax.ts`. A comment is a node of the tree and is skipped everywhere. After a syntax error the
 * parser keeps what it could read and adds nodes of the type `ERROR` or marks a node as missing.
 */
import type { Node, Parser } from 'web-tree-sitter';
import { getApexParser } from 'web-tree-sitter-sfapex';
import type {
  Declarator,
  DmlOp,
  Expr,
  FieldPath,
  Member,
  Name,
  Param,
  Pos,
  Problem,
  Query,
  Search,
  Stmt,
  SyntaxAdapter,
  TriggerDecl,
  TypeDecl,
  TypeOf,
  TypeRef,
  Unit,
  When,
} from '../syntax.ts';

const START: Pos = { line: 1, column: 1 };
const UNKNOWN: Expr = { kind: 'unknown', parts: [] };
const COMMENTS = new Set(['line_comment', 'block_comment']);

/** The number of lines the adapter put in front of the text it handed to the parser. */
let linesBefore = 0;
const posOf = (node: Node): Pos => ({
  line: node.startPosition.row + 1 - linesBefore,
  column: node.startPosition.column + 1,
});
const nameOf = (node: Node | null | undefined, fallback?: Node): Name =>
  node === null || node === undefined
    ? { text: '', at: fallback === undefined ? START : posOf(fallback) }
    : { text: node.text, at: posOf(node) };

/** The named children of a node, without comments. */
const kids = (node: Node | null | undefined): Node[] =>
  node === null || node === undefined ? [] : node.namedChildren.filter((kid) => !COMMENTS.has(kid.type));
const all = (node: Node | null | undefined, type: string): Node[] => kids(node).filter((kid) => kid.type === type);
const one = (node: Node | null | undefined, type: string): Node | undefined => all(node, type)[0];
const field = (node: Node | null | undefined, name: string): Node | undefined =>
  node?.childForFieldName(name) ?? undefined;
/** The named children that stand in a field. A comma between them carries the name of the field too. */
const fields = (node: Node, name: string): Node[] =>
  node.childrenForFieldName(name).filter((kid) => kid.isNamed && !COMMENTS.has(kid.type));

// ---------------------------------------------------------------- types

/** The words of a type name: `T1.Inner.Deep` is three. */
function typeWords(node: Node, into: Node[]): void {
  if (node.type === 'type_identifier' || node.type === 'identifier') into.push(node);
  else if (node.type === 'scoped_type_identifier') for (const kid of kids(node)) typeWords(kid, into);
  else if (node.type === 'generic_type') {
    for (const kid of kids(node)) if (kid.type !== 'type_arguments') typeWords(kid, into);
  }
}

function typeRef(node: Node | undefined): TypeRef {
  if (node === undefined) return { name: '', args: [], array: 0, at: START };
  if (node.type === 'array_type') {
    const element = typeRef(field(node, 'element'));
    const dimensions = field(node, 'dimensions');
    const array = dimensions === undefined ? 1 : dimensions.children.filter((kid) => kid.type === '[').length;
    return { ...element, array: element.array + array };
  }
  const words: Node[] = [];
  typeWords(node, words);
  if (words.length === 0) return { name: node.text, args: [], array: 0, at: posOf(node) };
  // The arguments of a generic type stand after its last word.
  const generic = node.type === 'generic_type' ? node : kids(node).findLast((kid) => kid.type === 'generic_type');
  const args = kids(one(generic, 'type_arguments')).map(typeRef);
  return { name: words.map((word) => word.text).join('.'), args, array: 0, at: posOf(node) };
}

/** The type that an expression such as `Schema.Account` names in front of `.class`. */
function typeOfExpression(node: Node): TypeRef | undefined {
  const words: string[] = [];
  const walk = (at: Node): boolean => {
    if (at.type === 'identifier') {
      words.push(at.text);
      return true;
    }
    if (at.type !== 'field_access') return false;
    const object = field(at, 'object');
    const name = field(at, 'field');
    if (object === undefined || name === undefined || !walk(object)) return false;
    words.push(name.text);
    return true;
  };
  return walk(node) ? { name: words.join('.'), args: [], array: 0, at: posOf(node) } : undefined;
}

// ---------------------------------------------------------------- expressions

const expressions = (nodes: readonly Node[]): Expr[] => nodes.map(expression);

function expression(node: Node | undefined): Expr {
  if (node === undefined) return UNKNOWN;
  switch (node.type) {
    case 'identifier':
      return { kind: 'name', name: nameOf(node) };
    case 'string_literal': {
      const text = node.text;
      if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
        return { kind: 'string', at: posOf(node), raw: text.slice(1, -1) };
      }
      return { kind: 'literal', at: posOf(node), text };
    }
    case 'multi_line_string_literal':
    case 'int':
    case 'decimal_floating_point_literal':
    case 'boolean':
    case 'null_literal':
      return { kind: 'literal', at: posOf(node), text: node.text };
    case 'this':
      return { kind: 'this' };
    case 'super':
      return { kind: 'super' };
    case 'parenthesized_expression':
      return expression(kids(node)[0]);
    case 'field_access': {
      const object = field(node, 'object');
      const name = field(node, 'field');
      if (name?.text.toLowerCase() === 'class' && object !== undefined) {
        const type = typeOfExpression(object);
        if (type !== undefined) return { kind: 'class', type };
      }
      return {
        kind: 'dot',
        target: expression(object),
        name: nameOf(name, node),
        safe: one(node, 'safe_navigation_operator') !== undefined,
      };
    }
    case 'class_literal':
      return { kind: 'class', type: typeRef(kids(node)[0]) };
    case 'method_invocation': {
      const object = field(node, 'object');
      return {
        kind: 'call',
        target: object === undefined ? undefined : expression(object),
        name: nameOf(field(node, 'name'), node),
        args: expressions(kids(field(node, 'arguments'))),
      };
    }
    case 'explicit_constructor_invocation':
      // `this(...)` and `super(...)` call a constructor. The keyword is the name.
      return {
        kind: 'call',
        target: undefined,
        name: nameOf(field(node, 'constructor'), node),
        args: expressions(kids(field(node, 'arguments'))),
      };
    case 'object_creation_expression':
      return { kind: 'new', type: typeRef(field(node, 'type')), args: expressions(kids(field(node, 'arguments'))) };
    case 'array_creation_expression': {
      const type = typeRef(field(node, 'type'));
      const sized = [...all(node, 'dimensions_expr'), ...all(node, 'dimensions')];
      const elements = [
        ...sized.flatMap((dimension) => expressions(kids(dimension))),
        ...expressions(kids(field(node, 'value'))),
      ];
      return { kind: 'collection', type: sized.length > 0 ? { ...type, array: 1 } : type, elements, pairs: [] };
    }
    case 'map_creation_expression': {
      const pairs = all(field(node, 'value'), 'map_key_initializer').map((pair) => {
        const [key, value] = kids(pair);
        return { key: expression(key), value: expression(value) };
      });
      return { kind: 'collection', type: typeRef(field(node, 'type')), elements: [], pairs };
    }
    case 'cast_expression':
      return { kind: 'cast', type: typeRef(field(node, 'type')), expr: expression(field(node, 'value')) };
    case 'assignment_expression':
      return {
        kind: 'assign',
        op: field(node, 'operator')?.text ?? '=',
        left: expression(field(node, 'left')),
        right: expression(field(node, 'right')),
      };
    case 'binary_expression':
      return {
        kind: 'binary',
        op: field(node, 'operator')?.text.toLowerCase() ?? '',
        left: expression(field(node, 'left')),
        right: expression(field(node, 'right')),
      };
    case 'unary_expression':
    case 'update_expression':
      return { kind: 'unary', op: field(node, 'operator')?.text ?? '', operand: expression(field(node, 'operand')) };
    case 'ternary_expression':
      return {
        kind: 'ternary',
        cond: expression(field(node, 'condition')),
        then: expression(field(node, 'consequence')),
        else: expression(field(node, 'alternative')),
      };
    case 'array_access':
      return { kind: 'index', target: expression(field(node, 'array')), index: expression(field(node, 'index')) };
    case 'instanceof_expression':
      return { kind: 'instanceof', expr: expression(field(node, 'left')), type: typeRef(field(node, 'right')) };
    case 'query_expression': {
      const soql = one(node, 'soql_query_body');
      if (soql !== undefined) return { kind: 'soql', query: query(soql) };
      const sosl = one(node, 'sosl_query_body');
      if (sosl !== undefined) return { kind: 'sosl', search: search(sosl) };
      return UNKNOWN;
    }
    default:
      return { kind: 'unknown', parts: expressions(kids(node)) };
  }
}

// ---------------------------------------------------------------- queries

/** The names of a `field_identifier`, of a `storage_identifier` or of a `dotted_identifier`. */
function path(node: Node | undefined): FieldPath {
  if (node === undefined) return [];
  if (node.type === 'identifier') return [nameOf(node)];
  return kids(node).flatMap(path);
}

interface QueryParts {
  fields: FieldPath[];
  children: Query[];
  nested: Query[];
  typeOfs: TypeOf[];
  binds: Expr[];
}

const emptyParts = (): QueryParts => ({ fields: [], children: [], nested: [], typeOfs: [], binds: [] });

/** Collects what a clause of a query names. A sub-query, a `TYPEOF` and a bound expression are not walked into. */
function collect(node: Node, into: QueryParts, inSelect: boolean): void {
  for (const kid of kids(node)) {
    switch (kid.type) {
      case 'from_clause':
        break;
      case 'subquery':
        (inSelect ? into.children : into.nested).push(query(one(kid, 'soql_query_body')));
        break;
      case 'type_of_clause':
        into.typeOfs.push({
          relationship: path(one(kid, 'identifier') ?? one(kid, 'dotted_identifier')),
          whens: all(kid, 'when_expression').map((when) => ({
            object: nameOf(one(when, 'identifier'), when),
            fields: kids(one(when, 'field_list')).map(path),
          })),
          otherwise: kids(one(one(kid, 'else_expression'), 'field_list')).map(path),
        });
        break;
      case 'bound_apex_expression':
        into.binds.push(expression(kids(kid)[0]));
        break;
      case 'field_identifier':
        into.fields.push(path(kid));
        break;
      case 'identifier':
        // An alias, the name of a function, of a scope or of a list view. Not a field.
        break;
      default:
        collect(kid, into, inSelect || kid.type === 'select_clause');
    }
  }
}

function query(body: Node | undefined): Query {
  const parts = emptyParts();
  if (body === undefined) return { from: [], alias: undefined, ...parts };
  const from = kids(field(body, 'from_clause') ?? one(body, 'from_clause'))[0];
  const aliased = from?.type === 'storage_alias';
  collect(body, parts, false);
  return {
    from: path(aliased ? one(from, 'storage_identifier') : from),
    alias: aliased ? one(from, 'identifier')?.text.toLowerCase() : undefined,
    ...parts,
  };
}

function search(body: Node): Search {
  const binds: Expr[] = [];
  const returning: { object: Name; fields: FieldPath[] }[] = [];
  const walk = (node: Node): void => {
    for (const kid of kids(node)) {
      if (kid.type === 'bound_apex_expression') {
        binds.push(expression(kids(kid)[0]));
      } else if (kid.type === 'sobject_return') {
        const object = one(kid, 'identifier');
        const parts = emptyParts();
        collect(kid, parts, false);
        binds.push(...parts.binds);
        if (object !== undefined) returning.push({ object: nameOf(object), fields: parts.fields });
      } else {
        walk(kid);
      }
    }
  };
  walk(body);
  return { returning, binds };
}

// ---------------------------------------------------------------- statements

function declarators(node: Node): Declarator[] {
  return fields(node, 'declarator').map((declarator) => {
    const init = field(declarator, 'value');
    return {
      name: nameOf(field(declarator, 'name'), declarator),
      init: init === undefined ? undefined : expression(init),
    };
  });
}

const local = (node: Node): Stmt => ({ kind: 'local', type: typeRef(field(node, 'type')), vars: declarators(node) });

function block(node: Node | undefined): Stmt {
  return { kind: 'block', stmts: kids(node).map(statement) };
}

const optional = (node: Node | undefined): Stmt | undefined => (node === undefined ? undefined : statement(node));

const DML_OPS: readonly DmlOp[] = ['insert', 'update', 'upsert', 'delete', 'undelete', 'merge'];

function dml(node: Node): Stmt {
  const keyword = kids(one(node, 'dml_type'))[0];
  const op = DML_OPS.find((candidate) => candidate === keyword?.type);
  if (op === undefined) return { kind: 'other' };
  const key: Node[] = [];
  const upsertKey = field(node, 'upsert_key');
  if (upsertKey !== undefined) {
    const words = (at: Node): void => {
      if (at.namedChildCount === 0) key.push(at);
      else for (const kid of kids(at)) words(kid);
    };
    words(upsertKey);
  }
  const targets = [field(node, 'target'), field(node, 'merge_with')].filter((target) => target !== undefined);
  return {
    kind: 'dml',
    op,
    at: posOf(keyword ?? node),
    targets: expressions(targets),
    key: key.map((word) => nameOf(word)),
  };
}

function statement(node: Node): Stmt {
  switch (node.type) {
    case 'block':
    case 'constructor_body':
      return block(node);
    case 'local_variable_declaration':
      return local(node);
    case 'expression_statement': {
      const inner = kids(node)[0];
      if (inner?.type === 'dml_expression') return dml(inner);
      if (inner?.type === 'switch_expression') return statement(inner);
      return { kind: 'expr', expr: expression(inner) };
    }
    case 'explicit_constructor_invocation':
      return { kind: 'expr', expr: expression(node) };
    case 'dml_expression':
      return dml(node);
    case 'if_statement':
      return {
        kind: 'if',
        cond: expression(field(node, 'condition')),
        then: optional(field(node, 'consequence')) ?? { kind: 'other' },
        else: optional(field(node, 'alternative')),
      };
    case 'switch_expression': {
      const whens = all(field(node, 'body'), 'switch_rule').map((rule): When => {
        const typed = one(one(rule, 'switch_label'), 'when_sobject_type');
        const [type, name] = kids(typed);
        const binding = type === undefined ? undefined : { type: typeRef(type), name: nameOf(name, type) };
        return { binding, values: [], block: block(one(rule, 'block')) };
      });
      return { kind: 'switch', on: expression(field(node, 'condition')), whens };
    }
    case 'for_statement': {
      const cond = field(node, 'condition');
      return {
        kind: 'for',
        init: fields(node, 'init').map((init): Stmt =>
          init.type === 'local_variable_declaration' ? local(init) : { kind: 'expr', expr: expression(init) },
        ),
        cond: cond === undefined ? undefined : expression(cond),
        update: expressions(fields(node, 'update')),
        body: optional(field(node, 'body')),
      };
    }
    case 'enhanced_for_statement':
      return {
        kind: 'foreach',
        type: typeRef(field(node, 'type')),
        name: nameOf(field(node, 'name'), node),
        iterable: expression(field(node, 'value')),
        body: optional(field(node, 'body')),
      };
    case 'while_statement':
    case 'do_statement':
      return { kind: 'while', cond: expression(field(node, 'condition')), body: optional(field(node, 'body')) };
    case 'try_statement': {
      const last = one(one(node, 'finally_clause'), 'block');
      return {
        kind: 'try',
        block: block(field(node, 'body')),
        catches: all(node, 'catch_clause').map((clause) => {
          const parameter = one(clause, 'formal_parameter');
          return {
            type: typeRef(field(parameter, 'type')),
            name: nameOf(field(parameter, 'name'), clause),
            block: block(field(clause, 'body')),
          };
        }),
        finally: last === undefined ? undefined : block(last),
      };
    }
    case 'return_statement': {
      const value = kids(node)[0];
      return { kind: 'return', expr: value === undefined ? undefined : expression(value) };
    }
    case 'throw_statement':
      return { kind: 'throw', expr: expression(kids(node)[0]) };
    case 'run_as_statement':
      return { kind: 'runas', args: expressions(kids(field(node, 'user'))), block: block(one(node, 'block')) };
    default:
      return { kind: 'other' };
  }
}

// ---------------------------------------------------------------- declarations

/** The modifiers of a declaration. An annotation is not one. */
function modifiers(node: Node): Set<string> {
  return new Set(all(one(node, 'modifiers'), 'modifier').flatMap((modifier) => kids(modifier).map((kid) => kid.type)));
}

function parameters(node: Node | undefined): Param[] {
  return all(node, 'formal_parameter').map((parameter) => ({
    type: typeRef(field(parameter, 'type')),
    name: nameOf(field(parameter, 'name'), parameter),
  }));
}

function method(node: Node, ctor: boolean): Member {
  const returns = field(node, 'type');
  const body = field(node, 'body');
  return {
    kind: 'method',
    name: nameOf(field(node, 'name'), node),
    ctor,
    static: !ctor && modifiers(node).has('static'),
    params: parameters(field(node, 'parameters')),
    returns: ctor || returns === undefined || returns.type === 'void_type' ? undefined : typeRef(returns),
    body: body === undefined ? (ctor ? block(undefined) : undefined) : block(body),
  };
}

function member(node: Node): Member | undefined {
  switch (node.type) {
    case 'method_declaration':
      return method(node, false);
    case 'constructor_declaration':
      return method(node, true);
    case 'field_declaration': {
      const marks = modifiers(node);
      const accessorList = one(node, 'accessor_list');
      if (accessorList !== undefined) {
        const accessors = all(accessorList, 'accessor_declaration').flatMap((accessor) => {
          const body = field(accessor, 'body');
          return body === undefined ? [] : [block(body)];
        });
        return {
          kind: 'property',
          type: typeRef(field(node, 'type')),
          static: marks.has('static'),
          name: nameOf(field(field(node, 'declarator'), 'name'), node),
          accessors,
        };
      }
      return {
        kind: 'field',
        type: typeRef(field(node, 'type')),
        static: marks.has('static'),
        final: marks.has('final'),
        vars: declarators(node),
      };
    }
    case 'static_initializer':
      return { kind: 'initializer', static: true, body: block(one(node, 'block')) };
    case 'block':
      return { kind: 'initializer', static: false, body: block(node) };
    default: {
      const decl = typeDeclaration(node);
      return decl === undefined ? undefined : { kind: 'type', decl };
    }
  }
}

function members(body: Node | undefined): Member[] {
  return kids(body).flatMap((kid) => {
    const found = member(kid);
    return found === undefined ? [] : [found];
  });
}

function typeDeclaration(node: Node): TypeDecl | undefined {
  if (node.type === 'class_declaration') {
    const base = kids(field(node, 'superclass'))[0];
    return {
      kind: 'class',
      name: nameOf(field(node, 'name'), node),
      extends: base === undefined ? undefined : typeRef(base),
      members: members(field(node, 'body')),
      values: [],
    };
  }
  if (node.type === 'interface_declaration') {
    return {
      kind: 'interface',
      name: nameOf(field(node, 'name'), node),
      extends: undefined,
      members: members(field(node, 'body')).filter((found) => found.kind === 'method'),
      values: [],
    };
  }
  if (node.type === 'enum_declaration') {
    const values = all(field(node, 'body'), 'enum_constant').map((constant) =>
      nameOf(field(constant, 'name'), constant),
    );
    return { kind: 'enum', name: nameOf(field(node, 'name'), node), extends: undefined, members: [], values };
  }
  return undefined;
}

const MEMBERS = new Set([
  'method_declaration',
  'field_declaration',
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
]);

function trigger(node: Node): TriggerDecl {
  const body: Stmt[] = [];
  const found: Member[] = [];
  for (const kid of kids(one(field(node, 'body'), 'block'))) {
    if (MEMBERS.has(kid.type)) {
      const made = member(kid);
      if (made !== undefined) found.push(made);
    } else {
      body.push(statement(kid));
    }
  }
  return { name: nameOf(field(node, 'name'), node), object: nameOf(field(node, 'object'), node), body, members: found };
}

/** The places where the parser gave up or made something up. */
function problemsOf(root: Node): Problem[] {
  const found: Problem[] = [];
  const walk = (node: Node): void => {
    if (!node.hasError) return;
    if (node.isError) {
      found.push({ at: posOf(node), message: `Syntax error at "${node.text.slice(0, 40)}".` });
      return;
    }
    if (node.isMissing) {
      found.push({ at: posOf(node), message: `Missing ${node.type}.` });
      return;
    }
    for (const kid of node.children) walk(kid);
  };
  walk(root);
  return found;
}

/**
 * Parses a text and hands the root of the tree to `read`. The tree lives in the memory of the WebAssembly module,
 * which no garbage collector frees, so it is deleted as soon as it is lowered.
 */
function withTree<T>(parser: Parser, source: string, read: (root: Node | undefined) => T): T {
  const tree = parser.parse(source);
  try {
    return read(tree?.rootNode);
  } finally {
    tree?.delete();
  }
}

function unit(root: Node | undefined, kind: 'class' | 'trigger'): Unit {
  if (root === undefined) {
    return { types: [], trigger: undefined, problems: [{ at: START, message: 'The parser gave no tree.' }] };
  }
  const problems = problemsOf(root);
  if (kind === 'trigger') {
    const declaration = one(root, 'trigger_declaration');
    if (declaration === undefined) problems.push({ at: START, message: 'The file declares no trigger.' });
    return { types: [], trigger: declaration === undefined ? undefined : trigger(declaration), problems };
  }
  const types = kids(root).flatMap((kid) => {
    const decl = typeDeclaration(kid);
    return decl === undefined ? [] : [decl];
  });
  // An empty file gives a tree without a type and without an error node.
  if (types.length === 0 && problems.length === 0) problems.push({ at: START, message: 'The file declares no type.' });
  return { types, trigger: undefined, problems };
}

/** The query of a text that was wrapped as `class Q{Object q=[ ... ];}`, or `undefined` when it is not one query. */
function wrappedQuery(root: Node | undefined): Query | undefined {
  if (root === undefined || root.hasError) return undefined;
  const declared = kids(field(one(root, 'class_declaration'), 'body'));
  const value = declared.length === 1 ? field(field(declared[0], 'declarator'), 'value') : undefined;
  const bodies = value?.type === 'query_expression' ? kids(value) : [];
  return bodies.length === 1 && bodies[0]?.type === 'soql_query_body' ? query(bodies[0]) : undefined;
}

/** Loads the grammar. It is WebAssembly, so this is the one step of the trial that is not synchronous. */
export async function createTreeSitterAdapter(): Promise<SyntaxAdapter> {
  const apex = await getApexParser();
  return {
    name: 'tree-sitter',
    parseUnit(source, kind): Unit {
      try {
        return withTree(apex, source, (root) => unit(root, kind));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { types: [], trigger: undefined, problems: [{ at: START, message }] };
      }
    },
    parseQuery(text): Query | undefined {
      // The grammar for SOQL alone does not read a bind variable (`:name`), which is an expression of Apex. So
      // the text is read as a query inside a class, on a line of its own, and the columns stay as they are.
      linesBefore = 1;
      try {
        return withTree(apex, `class Q{Object q=[\n${text}\n];}`, wrappedQuery);
      } catch {
        return undefined;
      } finally {
        linesBefore = 0;
      }
    },
  };
}
