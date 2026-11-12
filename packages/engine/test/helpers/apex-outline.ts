/**
 * A reading of the Apex files of the fixture that is just deep enough to
 * check the answer key: which characters are code, text, comment or query,
 * and which member of the class a line belongs to.
 *
 * It is not an analyser and it knows nothing about fields. It understands the
 * plain style the fixture is written in: one class or trigger per file, and
 * members that are methods, properties, fields and inner types.
 */
import { apexSignature, type SubComponent } from '../../src/core/keys.ts';

/** What a character of an Apex file is part of. A query is an inline `[SELECT ...]` or `[FIND ...]`. */
type Region = 'code' | 'text' | 'comment' | 'query';

interface Member {
  /** The path of the member below the class, as the sub-components of a key. */
  readonly subs: readonly SubComponent[];
  readonly from: number;
  to: number;
}

export interface ApexOutline {
  /** The lines of the file with comments and the content of text literals replaced by spaces. */
  readonly code: readonly string[];
  /** Line and column start at 1. */
  regionAt(line: number, column: number): Region;
  /** The member a line belongs to: the innermost one that starts at or above it and ends at or below it. */
  memberAt(line: number): readonly SubComponent[];
  /** The fields that are `static final`, by their name in lower case, with the text they are set to. */
  readonly constants: ReadonlyMap<string, string>;
}

type Scope =
  | { readonly kind: 'type'; readonly subs: readonly SubComponent[]; readonly name: string; readonly from: number }
  | { readonly kind: 'body'; readonly member?: Member }
  | { readonly kind: 'value' };

/** Splits a parameter list at the commas that are not inside `<...>`, and returns the type of each parameter. */
function parameterTypes(list: string): string[] {
  const types: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of `${list},`) {
    if (char === '<') depth += 1;
    if (char === '>') depth -= 1;
    if (char === ',' && depth === 0) {
      const words = current.trim().replace(/^final\s+/, '');
      // The last word is the name of the parameter. What stands before it is the type.
      if (words !== '') types.push(words.replace(/\s*\w+$/, ''));
      current = '';
    } else {
      current += char;
    }
  }
  return types;
}

export function outlineApex(source: string): ApexOutline {
  // First pass: what every character is.
  const regions: Region[] = [];
  let state: 'code' | 'text' | 'line' | 'block' = 'code';
  for (let at = 0; at < source.length; at += 1) {
    const char = source.charAt(at);
    const next = source.charAt(at + 1);
    if (state === 'line' && char === '\n') {
      regions.push('code');
      state = 'code';
    } else if (state === 'line') {
      regions.push('comment');
    } else if (state === 'block') {
      regions.push('comment');
      if (char === '*' && next === '/') {
        regions.push('comment');
        at += 1;
        state = 'code';
      }
    } else if (state === 'text') {
      if (char === '\\') {
        regions.push('text', 'text');
        at += 1;
      } else if (char === "'") {
        // The quotes are code. What stands between them is text.
        regions.push('code');
        state = 'code';
      } else {
        regions.push('text');
      }
    } else if (char === '/' && (next === '/' || next === '*')) {
      regions.push('comment', 'comment');
      at += 1;
      state = next === '/' ? 'line' : 'block';
    } else {
      regions.push('code');
      if (char === "'") state = 'text';
    }
  }
  let masked = '';
  for (let at = 0; at < source.length; at += 1) {
    const char = source.charAt(at);
    masked += regions[at] === 'code' || char === '\n' ? char : ' ';
  }

  // Second pass: inline queries, from the bracket that opens one to the bracket that closes it.
  const opening = /\[\s*(?:SELECT|FIND)\b/gi;
  for (let match = opening.exec(masked); match !== null; match = opening.exec(masked)) {
    let depth = 0;
    for (let at = match.index; at < masked.length; at += 1) {
      const char = masked.charAt(at);
      if (char === '[') depth += 1;
      if (char === ']') depth -= 1;
      if (regions[at] === 'code' && char !== '\n') regions[at] = 'query';
      if (depth === 0) {
        opening.lastIndex = at;
        break;
      }
    }
  }

  // Third pass: the members, from the statements that stand directly in the body of a type.
  const members: Member[] = [];
  const types: { subs: readonly SubComponent[]; from: number; to: number }[] = [];
  const constants = new Map<string, string>();
  const scopes: Scope[] = [];
  let head = '';
  let raw = '';
  let headLine = 0;
  let line = 1;
  const reset = (): void => {
    head = '';
    raw = '';
  };
  const declared = (): { text: string; value: string | undefined } => {
    const text = head.replace(/@\w+(?:\s*\([^)]*\))?/g, ' ').trim();
    const equals = text.search(/(?<![=!<>])=(?!=)/);
    return equals === -1 || text.slice(0, equals).includes('(')
      ? { text, value: undefined }
      : { text: text.slice(0, equals).trim(), value: raw.slice(raw.indexOf('=') + 1) };
  };

  for (let at = 0; at < masked.length; at += 1) {
    const char = masked.charAt(at);
    if (char === '\n') line += 1;
    const top = scopes.at(-1);
    if (top !== undefined && top.kind !== 'type') {
      // Inside the body of a member, or inside the braces of a value: only the braces count.
      if (char === '{') scopes.push({ kind: top.kind });
      if (char === '}') {
        scopes.pop();
        if (top.kind === 'body' && top.member !== undefined) top.member.to = line;
        if (top.kind === 'body') reset();
        else {
          head += ' ';
          raw += ' ';
        }
      }
      if (top.kind === 'value' && char !== '{' && char !== '}') raw += source.charAt(at);
      continue;
    }
    const subs = top?.subs ?? [];
    if (char === '{') {
      const { text, value } = declared();
      const type = /\b(?:class|interface|trigger)\s+(\w+)/.exec(text);
      const call = /(\w+)\s*\(([^)]*)\)/.exec(text);
      if (value !== undefined) {
        // The braces of a value, as in `new List<String>{ ... }`. The declaration goes on to its semicolon.
        scopes.push({ kind: 'value' });
        head += ' ';
        raw += ' ';
        continue;
      }
      if (/^trigger\s/.test(text)) {
        scopes.push({ kind: 'body' });
      } else if (type?.[1] !== undefined) {
        const inner = top === undefined ? [] : [...subs, { kind: 'inner' as const, name: type[1] }];
        scopes.push({ kind: 'type', subs: inner, name: type[1], from: headLine });
      } else if (/\benum\s+\w+/.test(text)) {
        scopes.push({ kind: 'body' });
      } else if (call?.[1] !== undefined) {
        const signature = apexSignature(parameterTypes(call[2] ?? ''));
        const sub: SubComponent =
          call[1].toLowerCase() === top?.name.toLowerCase()
            ? { kind: 'ctor', name: signature }
            : { kind: 'method', name: `${call[1]}${signature}` };
        const member: Member = { subs: [...subs, sub], from: headLine, to: line };
        members.push(member);
        scopes.push({ kind: 'body', member });
      } else {
        const name = /(\w+)$/.exec(text)?.[1] ?? '';
        const member: Member = { subs: [...subs, { kind: 'prop', name }], from: headLine, to: line };
        members.push(member);
        scopes.push({ kind: 'body', member });
      }
      reset();
    } else if (char === '}') {
      const closed = scopes.pop();
      if (closed?.kind === 'type') types.push({ subs: closed.subs, from: closed.from, to: line });
      reset();
    } else if (char === ';') {
      const { text, value } = declared();
      const call = /(\w+)\s*\(([^)]*)\)/.exec(text);
      if (call?.[1] !== undefined) {
        // A method without a body, as in an interface.
        const sub: SubComponent = { kind: 'method', name: `${call[1]}${apexSignature(parameterTypes(call[2] ?? ''))}` };
        members.push({ subs: [...subs, sub], from: headLine, to: line });
      } else if (text !== '') {
        const name = /(\w+)$/.exec(text)?.[1] ?? '';
        members.push({ subs: [...subs, { kind: 'var', name }], from: headLine, to: line });
        if (value !== undefined && /\bstatic\b/.test(text) && /\bfinal\b/.test(text)) {
          constants.set(name.toLowerCase(), value);
        }
      }
      reset();
    } else {
      if (head.trim() === '' && char.trim() !== '') headLine = line;
      head += char;
      raw += source.charAt(at);
    }
  }

  // The position of the first character of every line.
  const starts = [0];
  for (let at = 0; at < source.length; at += 1) if (source.charAt(at) === '\n') starts.push(at + 1);

  return {
    code: masked.split('\n'),
    regionAt: (atLine, column) => regions[(starts[atLine - 1] ?? 0) + column - 1] ?? 'code',
    memberAt: (atLine) => {
      const inside = <T extends { from: number; to: number }>(all: readonly T[]): T | undefined =>
        all
          .filter((one) => one.from <= atLine && atLine <= one.to)
          .sort((a, b) => a.to - a.from - (b.to - b.from))
          .at(0);
      return (inside(members) ?? inside(types))?.subs ?? [];
    },
    constants,
  };
}
