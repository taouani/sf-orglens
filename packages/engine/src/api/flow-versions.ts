/**
 * Which version of a flow a snapshot of an org holds (decision record 0060).
 *
 * An org hands out the latest version of a flow when it is asked for the
 * flow by its name, and that can be a draft while an older version is the
 * one that runs. The active version is analysed. Where the file the org
 * handed out says that it is not active, the file of the `FlowDefinition`
 * names the number of the active version, and the org is asked once more,
 * for the name of the flow with that number: `Invoice_Recalculate-1`.
 *
 * This module says which flows that is, and which file of a retrieve is the
 * active version. It reads the files and asks nothing. The retrieve is made
 * by `org-snapshot.ts`.
 */
import { childOf, readXml, type XmlElement } from '../extraction/xml.ts';
import type { SourceTree } from '../sources/tree.ts';

/** The folder of the files of flows, and the end of their names, in the form a repository holds them. */
const FLOWS = 'flows/';
const FLOW_FILE = '.flow-meta.xml';
const definitionPath = (flow: string): string => `flowDefinitions/${flow}.flowDefinition-meta.xml`;
export const flowPath = (flow: string): string => `${FLOWS}${flow}${FLOW_FILE}`;

/** The state a flow says it is in when it runs. */
const ACTIVE = 'Active';

/** The root element of a file, or null if the file cannot be read as XML or its root has another name. */
function rootOf(bytes: Uint8Array, name: string): XmlElement | null {
  const { document } = readXml(bytes);
  return document?.root.local === name ? document.root : null;
}

const textIn = (element: XmlElement | null, local: string): string | null => {
  const child = element === null ? null : childOf(element, local);
  const text = child?.text?.value.trim() ?? '';
  return text === '' ? null : text;
};

/** The state a file of a flow names, such as `Draft`, or null if it names none or cannot be read. */
export function stateOf(bytes: Uint8Array): string | null {
  return textIn(rootOf(bytes, 'Flow'), 'status');
}

/** A flow whose file is not the active version and whose active version is asked for by its number. */
export interface FlowToFetch {
  /** The name of the flow, as the name of its file has it. */
  readonly flow: string;
  /** The state of the file the snapshot holds, such as `Draft`. */
  readonly state: string;
  /** The number of the active version, as the file of the definition names it. */
  readonly version: number;
}

/** A flow whose file is not the active version, and of which nothing says whether another version is. */
export interface FlowUnknown {
  readonly flow: string;
  readonly state: string;
  /** `no-definition`: the snapshot holds no file of its definition. `definition-unreadable`: the file is no definition. */
  readonly reason: 'no-definition' | 'definition-unreadable';
}

/**
 * The flows of a snapshot whose file says that it is not active, by what the files of their definitions say.
 * A flow whose definition names no active version is in neither list: it has no other version to ask for, and
 * is analysed as the org handed it out. A file whose state cannot be read is in neither list either: the
 * analysis says what is wrong with it. Each list is sorted by the name of the flow.
 */
export function flowsNotActive(tree: SourceTree): { fetch: FlowToFetch[]; unknown: FlowUnknown[] } {
  const files = new Set(tree.files);
  const fetch: FlowToFetch[] = [];
  const unknown: FlowUnknown[] = [];
  for (const path of tree.files) {
    if (!path.startsWith(FLOWS) || !path.endsWith(FLOW_FILE)) continue;
    const flow = path.slice(FLOWS.length, -FLOW_FILE.length);
    if (flow.includes('/')) continue;
    const state = stateOf(tree.read(path));
    if (state === null || state === ACTIVE) continue;
    const definition = definitionPath(flow);
    if (!files.has(definition)) {
      unknown.push({ flow, state, reason: 'no-definition' });
      continue;
    }
    const root = rootOf(tree.read(definition), 'FlowDefinition');
    if (root === null) {
      unknown.push({ flow, state, reason: 'definition-unreadable' });
      continue;
    }
    // A definition that names 0, or no number, names no active version (decision record 0060).
    const number = textIn(root, 'activeVersionNumber');
    if (number === null || !/^[1-9][0-9]{0,8}$/.test(number)) continue;
    fetch.push({ flow, state, version: Number(number) });
  }
  return { fetch, unknown };
}

/** The name a version of a flow is asked for by. A name of a flow holds no hyphen, so the number is unambiguous. */
export const versionName = (flow: string, version: number): string => `${flow}-${String(version)}`;

/**
 * The file of the active version among the files of a retrieve that asked for `versionName(flow, version)`.
 * Run 22 of "Live org" showed both names: the file of an older version is named with the number, and the file of
 * the latest without it, also when it is asked for by its number. A file is taken only if it says that it is
 * active. Returned: its content, or the states the files of the flow that came back name.
 */
export function activeVersionIn(
  tree: SourceTree,
  flow: string,
  version: number,
): { readonly content: Uint8Array } | { readonly content: null; readonly states: readonly string[] } {
  const states: string[] = [];
  for (const path of [flowPath(versionName(flow, version)), flowPath(flow)]) {
    if (!tree.files.includes(path)) continue;
    const content = tree.read(path);
    const state = stateOf(content);
    if (state === ACTIVE) return { content };
    states.push(state ?? 'unknown');
  }
  return { content: null, states };
}
