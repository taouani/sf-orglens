/**
 * A part of the step that asks the test org (`probe-org.ts`): asks the
 * Metadata API for one flow of the fixture project in every way a version
 * of it could be named, and says what came back.
 *
 * The maintainer decided on 23 November 2026 that the active version of a
 * flow is the one that is analysed, and that a newer draft is said to be
 * there and is not analysed. An org hands out the draft when it is asked
 * for the flow by its name (run 21 of the workflow). So the engine has to
 * ask for the active version in another way, and this measures whether
 * there is one:
 *
 * - the flow by its name, as a snapshot asks for it,
 * - the file of its `FlowDefinition`, which should name the number of the
 *   active version,
 * - the flow by its name with the number of a version, such as
 *   `Invoice_Recalculate-1`, for every version the org holds. The
 *   reference of the Metadata API says that a version can be retrieved that
 *   way, and says in the same place that the name holds no version number
 *   from API version 44 on. Which of the two holds is what is measured.
 *
 * The flow is the one the step "draft" sends once more as a draft, so the
 * org should hold an active version of it and a newer draft. Each name is
 * asked for in a retrieve of its own, so that it is known which request a
 * file answers.
 *
 * Nothing is written to the org. A file that comes back is read in memory
 * and not kept. What is printed follows the rule of `public-log.ts`: the
 * names are of the fixture project, with a number, and of a file only its
 * size, its state and which of the two versions of the project it is.
 */
import JSZip from 'jszip';
import { metadataApi, MetadataRequestError, notFoundIn, type MetadataApi } from '../../src/sources/metadata-api.ts';
import type { OrgSession } from '../../src/sources/org.ts';
import { codeOf, draftPlaces, FLOW_WITH_DRAFT } from './deploy-fixture.ts';
import type { PublicLog } from './public-log.ts';

/** The first pause before the state of a retrieve is asked for, the longest one, and how long a retrieve may take. */
const POLL_FIRST_MS = 250;
const POLL_MS = 2_000;
const RETRIEVE_MS = 120_000;
/** At most this many versions are asked for by their number. */
const NUMBERS_ASKED = 5;

/** The flow as the Tooling API describes it: every version with its number and state. */
export interface HeldFlow {
  readonly versions: readonly { readonly number: number; readonly status: string }[];
  /** The number of the active version, or `null` if the flow has none or its number is not known. */
  readonly active: number | null;
}

/** One file of an answer. */
interface AnswerFile {
  /** The path below `unpackaged`, if it is a name of the flow with or without a number. Else `null`. */
  readonly path: string | null;
  readonly kind: 'flow' | 'definition' | 'other';
  readonly text: string;
  readonly bytes: number;
}

/** What a retrieve of one name gave. */
interface Answer {
  /** How the retrieve ended, as Salesforce names it, or what kept it from ending. */
  readonly ended: string;
  readonly succeeded: boolean;
  /** Whether Salesforce remarked that it cannot find what was asked for, and how many other remarks it made. */
  readonly notFound: boolean;
  readonly otherRemarks: number;
  readonly files: readonly AnswerFile[];
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The files of the flow and of its definition, as a retrieve names them. */
const FLOW_FILE = new RegExp(`^flows/${escaped(FLOW_WITH_DRAFT)}(?:-\\d{1,6})?\\.flow$`);
const DEFINITION_FILE = new RegExp(`^flowDefinitions/${escaped(FLOW_WITH_DRAFT)}\\.flowDefinition$`);

/** The number of the active version a file of a `FlowDefinition` names, or `null`. */
function activeIn(definition: string): number | null {
  const found = /<activeVersionNumber>\s*(\d{1,6})\s*<\/activeVersionNumber>/.exec(definition)?.[1];
  return found === undefined ? null : Number(found);
}

/** Which of the two versions of the project a file of the flow is. */
function whichVersion(text: string): string {
  const { ofDraft, ofActive, all } = draftPlaces(text);
  if (ofDraft === all && ofActive === 0) return 'the draft';
  if (ofActive === all && ofDraft === 0) return 'the version that was sent as active';
  return `neither of the two: of the ${String(all)} places the draft differs in, it has ${String(ofDraft)} as the draft has them and ${String(ofActive)} as the version that was sent as active`;
}

/** Asks for one component in a retrieve of its own, and reads what comes back. */
async function retrieveOne(
  log: PublicLog,
  api: MetadataApi,
  type: string,
  fullName: string,
  options: { pollMs?: number; retrieveMs?: number },
  counter: { requests: number },
): Promise<Answer> {
  const nothing = { succeeded: false, notFound: false, otherRemarks: 0, files: [] };
  try {
    counter.requests += 1;
    const job = await api.startRetrieve([{ type, fullName }]);
    const deadline = Date.now() + (options.retrieveMs ?? RETRIEVE_MS);
    const longest = options.pollMs ?? POLL_MS;
    for (let wait = Math.min(POLL_FIRST_MS, longest); ; wait = Math.min(wait * 2, longest)) {
      await pause(wait);
      counter.requests += 1;
      if ((await api.retrieveState(job, false)).done) break;
      if (Date.now() >= deadline) return { ...nothing, ended: 'not ended in time' };
    }
    counter.requests += 1;
    const state = await api.retrieveState(job, true);
    const notFound = notFoundIn(state.problems).some((member) => member.type === type && member.fullName === fullName);
    const files: AnswerFile[] = [];
    if (state.zip !== null) {
      const zip = await JSZip.loadAsync(state.zip);
      for (const [name, entry] of Object.entries(zip.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const path = name.replace(/^unpackaged\//, '');
        if (entry.dir || path === 'package.xml') continue;
        const bytes = await entry.async('nodebuffer');
        const kind = FLOW_FILE.test(path) ? 'flow' : DEFINITION_FILE.test(path) ? 'definition' : 'other';
        files.push({ path: kind === 'other' ? null : path, kind, text: bytes.toString('utf8'), bytes: bytes.length });
      }
    }
    const failed = log.code(state.errorCode);
    return {
      ended: `${log.name(state.status) ?? 'a state that is not shown'}${failed === null ? '' : ` (${failed})`}`,
      succeeded: state.succeeded,
      notFound,
      otherRemarks: state.problems.length - (notFound ? 1 : 0),
      files,
    };
  } catch (error) {
    const code = error instanceof MetadataRequestError ? log.code(error.code) : codeOf(log, error);
    return { ...nothing, ended: `refused or not answered (${code ?? 'NO_CODE'})` };
  }
}

/** The line about one answer. */
function answerLine(log: PublicLog, type: string, fullName: string, answer: Answer): string {
  const remarks =
    (answer.notFound ? ' Salesforce remarked that it cannot find it.' : '') +
    (answer.otherRemarks > 0
      ? ` Salesforce made ${plural(answer.otherRemarks, 'other remark', 'other remarks')}.`
      : '');
  const files = answer.files.map((file) => {
    const size = `${String(file.bytes)} bytes`;
    if (file.kind === 'other') return `a file with another name, ${size}`;
    if (file.kind === 'definition') {
      const active = activeIn(file.text);
      return `${file.path ?? ''}, ${size}, which names ${active === null ? 'no active version' : `version ${String(active)} as the active one`}`;
    }
    const state = log.name(/<status>([A-Za-z]+)<\/status>/.exec(file.text)?.[1]) ?? 'no state';
    return `${file.path ?? ''}, ${size}, with the state ${state}: ${whichVersion(file.text)}`;
  });
  return (
    `- ${type} ${fullName}: the retrieve ended as ${answer.ended}.${remarks} ` +
    (files.length === 0
      ? 'No file came back.'
      : `${plural(files.length, 'file', 'files')} came back: ${files.join('; ')}.`)
  );
}

/**
 * Asks for the flow with a draft by its name, by its `FlowDefinition`, and by its name with the number of each
 * version, and says what came back. `held` is what the Tooling API said of the flow.
 */
export async function probeFlowVersions(
  log: PublicLog,
  session: OrgSession,
  held: HeldFlow,
  options: { pollMs?: number; retrieveMs?: number } = {},
): Promise<void> {
  const flow = FLOW_WITH_DRAFT;
  log.say('');
  log.say(`The versions of the flow ${flow}, asked for by name and by number (retrieves of the Metadata API)`);
  log.say(
    `The Tooling API says that the org holds ${plural(held.versions.length, 'version', 'versions')} of it` +
      (held.versions.length === 0
        ? '.'
        : `: ${held.versions.map((one) => `${String(one.number)} (${log.name(one.status) ?? 'a state that is not shown'})`).join(', ')}.`) +
      ` The active one: ${held.active === null ? 'none, or its number is not known' : String(held.active)}.`,
  );

  const counter = { requests: 0 };
  let api: MetadataApi;
  try {
    api = await metadataApi(session.connection, session.apiVersion);
  } catch (error) {
    log.say(`The Metadata API could not be asked (${codeOf(log, error) ?? 'NO_CODE'}). Nothing was measured.`);
    return;
  }
  try {
    const version = log.version(api.apiVersion);
    log.say(
      `Each name is asked for in a retrieve of its own${version === null ? '' : `, with API version ${version}`}.`,
    );

    const byName = await retrieveOne(log, api, 'Flow', flow, options, counter);
    log.say(answerLine(log, 'Flow', flow, byName));
    const definition = await retrieveOne(log, api, 'FlowDefinition', flow, options, counter);
    log.say(answerLine(log, 'FlowDefinition', flow, definition));

    // The numbers to ask for: the active version first, as the definition and the Tooling API name it.
    const named =
      definition.files.flatMap((file) => (file.kind === 'definition' ? [activeIn(file.text)] : []))[0] ?? null;
    const numbers = [...new Set([named, held.active, ...held.versions.map((one) => one.number)])].filter(
      (number): number is number => number !== null,
    );
    const asked = numbers.slice(0, NUMBERS_ASKED);
    const byNumber = new Map<number, Answer>();
    for (const number of asked) {
      const answer = await retrieveOne(log, api, 'Flow', `${flow}-${String(number)}`, options, counter);
      byNumber.set(number, answer);
      log.say(answerLine(log, 'Flow', `${flow}-${String(number)}`, answer));
    }
    if (numbers.length > asked.length) {
      log.say(`${plural(numbers.length - asked.length, 'more version was', 'more versions were')} not asked for.`);
    }

    // What it comes to.
    const whichOf = (answer: Answer): string => {
      const files = answer.files.filter((file) => file.kind === 'flow');
      const [file] = files;
      if (file === undefined) return 'no file of the flow';
      return files.length > 1 ? `${String(files.length)} files of the flow` : whichVersion(file.text);
    };
    log.say(`Asked for by its name, Salesforce handed out: ${whichOf(byName)}.`);
    log.say(
      named === null
        ? 'The file of the FlowDefinition names no active version, or did not come back.'
        : `The file of the FlowDefinition names version ${String(named)} as the active one.` +
            (held.active === null
              ? ''
              : ` The Tooling API says ${String(held.active)}, which is ${held.active === named ? 'the same' : 'another number'}.`),
    );
    const active = named ?? held.active;
    const answer = active === null ? undefined : byNumber.get(active);
    log.say(
      active === null || answer === undefined
        ? 'No number of an active version is known, so the active version was not asked for by its number.'
        : `Asked for by the number of its active version (${String(active)}), Salesforce handed out: ${whichOf(answer)}.`,
    );
    log.say(`Requests to the Metadata API for this: ${String(counter.requests)}.`);
  } finally {
    await api.close();
  }
}
