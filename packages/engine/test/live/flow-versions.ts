/**
 * A part of the step that asks the test org (`probe-org.ts`): asks the
 * Metadata API for one flow of the fixture project in every way a version
 * of it could be named, and says what came back.
 *
 * The maintainer decided on 23 November 2026 that the active version of a
 * flow is the one that is analysed, and that a newer draft is said to be
 * there and is not analysed (decision record 0060 holds the answer). An
 * org hands out the draft when it is asked for the flow by its name (run 21
 * of the workflow). So the engine has to ask for the active version in
 * another way, and this measures whether there is one:
 *
 * - the flow by its name, as a snapshot asks for it,
 * - the file of its `FlowDefinition`, which should name the number of the
 *   active version,
 * - the flow by its name with the number of a version, such as
 *   `Invoice_Recalculate-1`: the active version, the latest one, and then
 *   the others from the newest down, five numbers at most. The reference
 *   of the Metadata API says that a version can be retrieved that way, and
 *   says in the same place that the name holds no version number from API
 *   version 44 on. Which of the two holds is what is measured, for the API
 *   version of the run and no other,
 * - as a control, the flow by its name with a number the org holds no
 *   version for. If a file comes back for it, the number plays no part.
 *
 * The flow is the one the step "draft" sends once more as a draft, so the
 * org should hold an active version of it and a newer draft. The answer
 * means something only while that is so: where the org hands out the
 * active version for the name alone, a version asked for by its number
 * cannot be told from the latest one, and the last line says so. Each name
 * is asked for in a retrieve of its own, so that it is known which request
 * a file answers. Once a retrieve does not end in time, the others are not
 * started.
 *
 * Nothing is written to the org. A file that comes back is read in memory
 * and not kept, and of a file with another name than the flow's only the
 * number of such files is known. What is printed follows the rule of
 * `public-log.ts`: the names are of the fixture project, with a number,
 * and of a file its size, its state if it is one of the four the Metadata
 * API knows, and which of the two versions of the project it is.
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
/** At most this many versions are asked for by their number, beside the control. */
const NUMBERS_ASKED = 5;
/** At most this many numbers are listed in a line. */
const NUMBERS_SHOWN = 20;

/** The states of a retrieve and of a version of a flow, as the Metadata API names them. No other word is shown. */
const RETRIEVE_STATES: ReadonlySet<string> = new Set([
  'Pending',
  'InProgress',
  'Succeeded',
  'Failed',
  'Canceling',
  'Canceled',
]);
const FLOW_STATES: ReadonlySet<string> = new Set(['Active', 'Draft', 'Obsolete', 'InvalidDraft']);

/** The flow as the Tooling API describes it: every version with its number and state. */
export interface HeldFlow {
  readonly versions: readonly { readonly number: number; readonly status: string }[];
  /** How many versions the org named without a number. */
  readonly withoutNumber: number;
  /** The number of the active version, or `null` if the flow has none or its number is not known. */
  readonly active: number | null;
}

/** A file of the flow in an answer. */
interface FlowFile {
  /** The path below `unpackaged`: the name of the flow, with or without a number. */
  readonly path: string;
  readonly bytes: number;
  readonly text: string;
}

/** What a retrieve of one name gave. */
interface Answer {
  /**
   * `answered`: the retrieve ended as succeeded and its zip file was read. Only then is it known what Salesforce
   * handed out. `not ended`: it was given up. `not asked`: it was not started, because one before it did not end.
   */
  readonly outcome: 'answered' | 'failed' | 'not ended' | 'not asked';
  /** How the retrieve went, as the end of a sentence that starts with "the retrieve". */
  readonly went: string;
  /** Whether Salesforce remarked that it cannot find what was asked for, and how many other remarks it made. */
  readonly notFound: boolean;
  readonly otherRemarks: number;
  readonly flows: readonly FlowFile[];
  /** The files of the definition: the path, the size, and the number of the active version each names. */
  readonly definitions: readonly { readonly path: string; readonly bytes: number; readonly active: number | null }[];
  /** How many files with another name the zip file held. */
  readonly others: number;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The number of a version: a whole number from 1 on. */
const isNumber = (value: number | null): value is number =>
  value !== null && Number.isSafeInteger(value) && value >= 1 && value <= 999_999;

/** The files of the flow and of its definition, as a retrieve names them. */
const FLOW_FILE = new RegExp(`^flows/${escaped(FLOW_WITH_DRAFT)}(?:-\\d{1,6})?\\.flow$`);
const DEFINITION_FILE = new RegExp(`^flowDefinitions/${escaped(FLOW_WITH_DRAFT)}\\.flowDefinition$`);

/**
 * The number of the active version a file of a `FlowDefinition` names, or `null`. Salesforce writes 0 for a flow
 * that has no active version, which is no number of a version.
 */
function activeIn(definition: string): number | null {
  const found = /<activeVersionNumber>\s*(\d{1,6})\s*<\/activeVersionNumber>/.exec(definition)?.[1];
  const number = found === undefined ? null : Number(found);
  return isNumber(number) ? number : null;
}

/** The state a file of a flow names, if it is one the Metadata API knows. */
function stateIn(flow: string): string {
  const found = /<status>([^<]*)<\/status>/.exec(flow)?.[1];
  if (found === undefined) return 'no state';
  return FLOW_STATES.has(found.trim()) ? `the state ${found.trim()}` : 'a state that is not shown';
}

/** Which of the two versions of the project a file of the flow is. */
function whichVersion(text: string): string {
  const { ofDraft, ofActive, all } = draftPlaces(text);
  if (ofDraft === all && ofActive === 0) return 'the draft';
  if (ofActive === all && ofDraft === 0) return 'the version that was sent as active';
  return `neither of the two: of the ${String(all)} places the draft differs in, it has ${String(ofDraft)} as the draft has them and ${String(ofActive)} as the version that was sent as active`;
}

const NOTHING = { notFound: false, otherRemarks: 0, flows: [], definitions: [], others: 0 } as const;
const NOT_ASKED: Answer = { ...NOTHING, outcome: 'not asked', went: 'was not started' };

/** Asks for one component in a retrieve of its own, and reads what comes back. */
async function retrieveOne(
  log: PublicLog,
  api: MetadataApi,
  type: string,
  fullName: string,
  options: { pollMs?: number; retrieveMs?: number },
  counter: { requests: number },
): Promise<Answer> {
  let state: Awaited<ReturnType<MetadataApi['retrieveState']>>;
  try {
    counter.requests += 1;
    const job = await api.startRetrieve([{ type, fullName }]);
    const deadline = Date.now() + (options.retrieveMs ?? RETRIEVE_MS);
    const longest = options.pollMs ?? POLL_MS;
    for (let wait = Math.min(POLL_FIRST_MS, longest); ; wait = Math.min(wait * 2, longest)) {
      await pause(wait);
      counter.requests += 1;
      if ((await api.retrieveState(job, false)).done) break;
      if (Date.now() >= deadline) return { ...NOTHING, outcome: 'not ended', went: 'did not end in time' };
    }
    counter.requests += 1;
    state = await api.retrieveState(job, true);
  } catch (error) {
    const code = error instanceof MetadataRequestError ? log.code(error.code) : codeOf(log, error);
    return { ...NOTHING, outcome: 'failed', went: `was refused or not answered (${code ?? 'NO_CODE'})` };
  }
  const failed = log.code(state.errorCode);
  const ended = `ended as ${RETRIEVE_STATES.has(state.status) ? state.status : 'a state that is not shown'}${failed === null ? '' : ` (${failed})`}`;
  const notFound = notFoundIn(state.problems).some((member) => member.type === type && member.fullName === fullName);
  const remarks = { notFound, otherRemarks: state.problems.length - (notFound ? 1 : 0) };
  if (!state.succeeded) return { ...NOTHING, ...remarks, outcome: 'failed', went: ended };
  if (state.zip === null) {
    return { ...NOTHING, ...remarks, outcome: 'failed', went: `${ended}, and gave no zip file` };
  }
  const flows: FlowFile[] = [];
  const definitions: { path: string; bytes: number; active: number | null }[] = [];
  let others = 0;
  try {
    const zip = await JSZip.loadAsync(state.zip);
    for (const [name, entry] of Object.entries(zip.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const path = name.replace(/^unpackaged\//, '');
      if (entry.dir || path === 'package.xml') continue;
      const flow = FLOW_FILE.test(path);
      if (!flow && !DEFINITION_FILE.test(path)) {
        // Nothing of a file with another name is read.
        others += 1;
        continue;
      }
      const bytes = await entry.async('nodebuffer');
      const text = bytes.toString('utf8');
      if (flow) flows.push({ path, bytes: bytes.length, text });
      else definitions.push({ path, bytes: bytes.length, active: activeIn(text) });
    }
  } catch {
    return { ...NOTHING, ...remarks, outcome: 'failed', went: `${ended}, and its zip file could not be read` };
  }
  return { ...remarks, outcome: 'answered', went: ended, flows, definitions, others };
}

/** The line about one answer. */
function answerLine(type: string, fullName: string, answer: Answer): string {
  if (answer.outcome === 'not asked') {
    return `- ${type} ${fullName}: not asked for, because a retrieve before it did not end in time.`;
  }
  const remarks =
    (answer.notFound ? ' Salesforce remarked that it cannot find it.' : '') +
    (answer.otherRemarks > 0
      ? ` Salesforce made ${plural(answer.otherRemarks, 'other remark', 'other remarks')}.`
      : '');
  const head = `- ${type} ${fullName}: the retrieve ${answer.went}.${remarks}`;
  if (answer.outcome !== 'answered') return head;
  const files = [
    ...answer.flows.map(
      (file) => `${file.path}, ${String(file.bytes)} bytes, with ${stateIn(file.text)}: ${whichVersion(file.text)}`,
    ),
    ...answer.definitions.map(
      (file) =>
        `${file.path}, ${String(file.bytes)} bytes, which names ${file.active === null ? 'no active version' : `version ${String(file.active)} as the active one`}`,
    ),
  ];
  const others = answer.others === 0 ? '' : ` ${plural(answer.others, 'file', 'files')} with another name came back.`;
  if (files.length === 0) return `${head} No file of the flow or of its definition came back.${others}`;
  return `${head} ${plural(files.length, 'file', 'files')} came back: ${files.join('; ')}.${others}`;
}

/** What an answer handed out of the flow, as the end of a sentence, and the one file of the flow if it is one. */
function handedOut(answer: Answer | undefined): { readonly said: string; readonly file: FlowFile | null } {
  if (answer === undefined || answer.outcome === 'not asked') {
    return { said: 'nothing is known, because it was not asked for', file: null };
  }
  if (answer.outcome !== 'answered')
    return { said: `nothing is known, because the retrieve ${answer.went}`, file: null };
  const remark = answer.notFound ? ', with the remark that what was asked for cannot be found' : '';
  const [file, ...more] = answer.flows;
  if (file === undefined) return { said: `no file of the flow${remark}`, file: null };
  if (more.length > 0) return { said: `${String(answer.flows.length)} files of the flow${remark}`, file: null };
  return { said: `${file.path}, which is ${whichVersion(file.text)}${remark}`, file };
}

/**
 * Asks for the flow with a draft by its name, by its `FlowDefinition`, and by its name with the number of a
 * version, and says what came back. `held` is what the Tooling API said of the flow.
 */
export async function probeFlowVersions(
  log: PublicLog,
  session: OrgSession,
  held: HeldFlow,
  options: { pollMs?: number; retrieveMs?: number } = {},
): Promise<void> {
  const flow = FLOW_WITH_DRAFT;
  const versions = held.versions.filter((one) => isNumber(one.number));
  const heldActive = isNumber(held.active) ? held.active : null;
  const state = (status: string): string => (FLOW_STATES.has(status) ? status : 'a state that is not shown');
  log.say('');
  log.say(`The versions of the flow ${flow}, asked for by name and by number (retrieves of the Metadata API)`);
  log.say(
    `The Tooling API says that the org holds ${plural(versions.length, 'version', 'versions')} of it with a number` +
      (versions.length === 0
        ? '.'
        : `: ${versions
            .slice(-NUMBERS_SHOWN)
            .map((one) => `${String(one.number)} (${state(one.status)})`)
            .join(', ')}${versions.length > NUMBERS_SHOWN ? ', of which these are the newest' : ''}.`) +
      (held.withoutNumber + (held.versions.length - versions.length) > 0
        ? ` ${plural(held.withoutNumber + (held.versions.length - versions.length), 'more has', 'more have')} no number that can be asked for.`
        : '') +
      ` The active one: ${heldActive === null ? 'none, or its number is not known' : String(heldActive)}.`,
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
    const withVersion = version === null ? '' : `, with API version ${version}`;
    log.say(`Each name is asked for in a retrieve of its own${withVersion}.`);

    // Once a retrieve does not end, no other is started: the step has other things to say, and a time limit.
    let gaveUp = false;
    const ask = async (type: string, fullName: string): Promise<Answer> => {
      const answer = gaveUp ? NOT_ASKED : await retrieveOne(log, api, type, fullName, options, counter);
      if (answer.outcome === 'not ended') gaveUp = true;
      log.say(answerLine(type, fullName, answer));
      return answer;
    };

    const byName = await ask('Flow', flow);
    const definition = await ask('FlowDefinition', flow);
    const named = definition.definitions[0]?.active ?? null;

    // The numbers to ask for: the active version first, as the Tooling API and the definition name it, then the
    // latest, then the others from the newest down.
    const newestFirst = versions.map((one) => one.number).sort((a, b) => b - a);
    const numbers = [...new Set([heldActive, named, ...newestFirst])].filter(isNumber);
    const asked = numbers.slice(0, NUMBERS_ASKED);
    const byNumber = new Map<number, Answer>();
    for (const number of asked) byNumber.set(number, await ask('Flow', `${flow}-${String(number)}`));
    const left = numbers.slice(NUMBERS_ASKED);
    if (left.length > 0) {
      log.say(
        `Not asked for by their number, because at most ${String(NUMBERS_ASKED)} are: ${plural(left.length, 'version', 'versions')}, ${left.slice(0, NUMBERS_SHOWN).join(', ')}${left.length > NUMBERS_SHOWN ? ' and older ones' : ''}.`,
      );
    }
    // The control: a number the org holds no version for.
    const beyond = numbers.length === 0 ? null : Math.max(...numbers) + 1;
    const control = beyond === null ? undefined : await ask('Flow', `${flow}-${String(beyond)}`);

    // What it comes to.
    log.say('What it comes to:');
    const plain = handedOut(byName);
    log.say(`- Asked for by its name, Salesforce handed out: ${plain.said}.`);
    log.say(
      (definition.outcome !== 'answered'
        ? `- The file of the FlowDefinition: nothing is known, because ${definition.outcome === 'not asked' ? 'it was not asked for' : `the retrieve ${definition.went}`}.`
        : definition.definitions.length === 0
          ? '- The file of the FlowDefinition did not come back.'
          : named === null
            ? '- The file of the FlowDefinition names no active version.'
            : `- The file of the FlowDefinition names version ${String(named)} as the active one.`) +
        (heldActive === null
          ? ' The Tooling API names no active version, or not its number.'
          : ` The Tooling API says ${String(heldActive)}${named === null ? '' : `, which is ${heldActive === named ? 'the same' : 'another number'}`}.`),
    );
    const active = heldActive ?? named;
    const byActive = active === null ? undefined : handedOut(byNumber.get(active));
    if (active === null || byActive === undefined) {
      log.say('- No number of an active version is known, so the active version was not asked for by its number.');
    } else {
      log.say(
        `- Asked for by the number of its active version (${String(active)}), Salesforce handed out: ${byActive.said}.`,
      );
      if (heldActive !== null && named !== null && named !== heldActive) {
        log.say(
          `- Asked for by the number the definition names (${String(named)}), Salesforce handed out: ${handedOut(byNumber.get(named)).said}.`,
        );
      }
    }
    const beside = handedOut(control);
    if (beyond !== null) {
      log.say(
        `- Asked for by a number the org holds no version for (${String(beyond)}), Salesforce handed out: ${beside.said}.`,
      );
    }

    // Whether the active version can be had by its number. It can be told only where the name alone gives
    // another version than the active one, and where a number without a version gives nothing.
    const isDraft = (file: FlowFile | null): boolean => file !== null && whichVersion(file.text) === 'the draft';
    const isActive = (file: FlowFile | null): boolean =>
      file !== null && whichVersion(file.text) === 'the version that was sent as active';
    const controlGaveNothing = control?.outcome === 'answered' && control.flows.length === 0;
    const activeAnswer = active === null ? undefined : byNumber.get(active);
    const scope = ` That is what the test org did${withVersion}. No other org and no other version was asked.`;
    let verdict: string;
    if (!isDraft(plain.file)) {
      verdict =
        'This run cannot say whether the active version can be asked for by its number: asked for by its name alone, the org did not hand out the draft, so a version that is asked for by its number cannot be told from the latest one.';
    } else if (byActive === undefined || activeAnswer?.outcome !== 'answered') {
      verdict =
        'This run does not say whether the active version can be asked for by its number: it was not asked for that way, or the retrieve gave no answer.';
    } else if (isActive(byActive.file) && controlGaveNothing) {
      verdict = `The org hands out the active version when it is asked for by its number: by the name alone it gives the draft, by the number of the active version the version that was sent as active, and by a number it holds no version for no file.${scope}`;
    } else if (isActive(byActive.file)) {
      verdict =
        'By the number of the active version the org handed out the version that was sent as active, and the answer for a number it holds no version for does not confirm that the number is what decides. The lines above say what came back.';
    } else if (isDraft(byActive.file)) {
      verdict = `The org hands out the draft also when it is asked for the number of the active version: the number plays no part.${scope}`;
    } else if (activeAnswer.flows.length === 0) {
      verdict = `The org does not hand out the active version when it is asked for by its number: no file came back.${scope}`;
    } else {
      verdict =
        'What came back for the number of the active version is neither the draft nor the version that was sent as active. The lines above say what it is.';
    }
    log.say(verdict);
    log.say(
      `Requests to the Metadata API for this: ${String(counter.requests)}. A request that was sent again after no answer is counted once.`,
    );
  } finally {
    // An error of the end of the connections is no result of the measurement.
    await api.close().catch(() => undefined);
  }
}
