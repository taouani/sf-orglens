/**
 * The rows of the issues of a reading, as `snapshot` and `coverage` print them: which issues share a row.
 *
 * The issues here are written by hand. Some of them no version of the engine writes: they hold the parts of the
 * rule that only a snapshot of an earlier form, or of a later one, would reach.
 */
import { describe, expect, it } from 'vitest';
import type { CoverageReport } from '@sf-orglens/engine';
import { readIssueRows } from '../src/commands.ts';

type Issue = CoverageReport['issues'][number];

const issue = (
  code: string,
  message: string,
  details: Issue['details'],
  severity: Issue['severity'] = 'warning',
): Issue => ({
  severity,
  code,
  message,
  stage: 'read',
  component: null,
  details,
});
/** A file that cannot be read, as a snapshot of an org writes it. */
const unread = (
  at: string,
  types: readonly string[],
  said = 'It is no metadata.',
  severity?: Issue['severity'],
): Issue =>
  issue('RESOLVE_FAILED', `${at} could not be read as metadata: ${said}`, { at, types: [...types] }, severity);
const whatOf = (issues: readonly Issue[]): (string | undefined)[] => readIssueRows(issues).map((row) => row[2]);
const said = (at: string, reason = 'It is no metadata.'): string => `${at} could not be read as metadata: ${reason}`;

describe('the rows of the issues of a reading', () => {
  it('shows one row for the files that are counted with the same types and say the same, where the first of them stood', () => {
    const rows = readIssueRows([
      unread('tabs/A.mystery', ['CustomTab']),
      issue('NOT_RETRIEVED', 'Something did not come back.', {}),
      unread('tabs/B.mystery', ['CustomTab']),
      unread('tabs/C.mystery', ['CustomTab']),
    ]);
    expect(rows).toEqual([
      ['warning', 'RESOLVE_FAILED', `3 issues of this kind. The first: ${said('tabs/A.mystery')}`],
      ['warning', 'NOT_RETRIEVED', 'Something did not come back.'],
    ]);
  });

  it('keeps apart what is counted with other types, what says something else, and an error beside a warning', () => {
    expect(
      whatOf([
        unread('objects/A.mystery', ['CustomField', 'CustomObject']),
        unread('classes/A.mystery', ['ApexClass']),
        unread('objects/B.mystery', ['CustomObject']),
        unread('classes/B.mystery', ['ApexClass'], 'It is empty.'),
        unread('classes/C.mystery', ['ApexClass'], 'It is no metadata.', 'error'),
      ]),
    ).toEqual([
      said('objects/A.mystery'),
      said('classes/A.mystery'),
      said('objects/B.mystery'),
      said('classes/B.mystery', 'It is empty.'),
      said('classes/C.mystery'),
    ]);
  });

  it('shows one row for each top folder where nothing tells the type of the files', () => {
    expect(
      whatOf([
        unread('aaa/One.mystery', []),
        unread('zzz/Two.mystery', []),
        unread('aaa/deep/Three.mystery', []),
        unread('Four.mystery', []),
        unread('zzz/Five.mystery', []),
        unread('Six.mystery', []),
      ]),
    ).toEqual([
      `2 issues of this kind. The first: ${said('aaa/One.mystery')}`,
      `2 issues of this kind. The first: ${said('zzz/Two.mystery')}`,
      `2 issues of this kind. The first: ${said('Four.mystery')}`,
    ]);
  });

  it('does not look at the folder where the types are told', () => {
    expect(
      whatOf([
        unread('reports/Early/A.report', ['Report']),
        unread('reports/Late/B.report', ['Report']),
        // A component is named by its type and its name, and its name can hold a folder.
        unread('Report Early/C', ['Report'], 'It cannot be converted.'),
        unread('Report Late/D', ['Report'], 'It cannot be converted.'),
      ]),
    ).toEqual([
      `2 issues of this kind. The first: ${said('reports/Early/A.report')}`,
      `2 issues of this kind. The first: ${said('Report Early/C', 'It cannot be converted.')}`,
    ]);
  });

  it('takes the place out of a message wherever it stands, as the Salesforce library names it once more', () => {
    const inferred = (at: string): string => `${at}: Could not infer a metadata type`;
    expect(
      whatOf([
        unread('mysteries/A.mystery', [], inferred('mysteries/A.mystery')),
        unread('mysteries/B.mystery', [], inferred('mysteries/B.mystery')),
        // It names another place than its own, so it says something else.
        unread('mysteries/C.mystery', [], inferred('mysteries/A.mystery')),
      ]),
    ).toEqual([
      `2 issues of this kind. The first: ${said('mysteries/A.mystery', inferred('mysteries/A.mystery'))}`,
      said('mysteries/C.mystery', inferred('mysteries/A.mystery')),
    ]);
  });

  it('gives an issue a row of its own where it does not say what it is counted with, or where', () => {
    const twice = (details: Issue['details'], message = said('classes/A.cls')): Issue[] => [
      issue('RESOLVE_FAILED', message, details),
      issue('RESOLVE_FAILED', message, details),
    ];
    // A Git source, and a snapshot that was taken before an issue named its types.
    expect(whatOf(twice({ at: 'classes/A.cls' }))).toHaveLength(2);
    expect(whatOf(twice({ at: 'classes/A.cls', types: 'ApexClass' }))).toHaveLength(2);
    expect(whatOf(twice({ types: ['ApexClass'] }))).toHaveLength(2);
    expect(whatOf(twice({ at: 7, types: ['ApexClass'] }))).toHaveLength(2);
    // A message that does not start with the place it names.
    expect(
      whatOf(twice({ at: 'classes/A.cls', types: ['ApexClass'] }, 'Something of classes/A.cls is wrong.')),
    ).toHaveLength(2);
    // With all of it, the two share a row.
    expect(whatOf(twice({ at: 'classes/A.cls', types: ['ApexClass'] }))).toEqual([
      `2 issues of this kind. The first: ${said('classes/A.cls')}`,
    ]);
  });

  it('shows one row for a code that comes once for each flow, and one for each reason it gives', () => {
    const unknown = (flow: string, reason: string): Issue =>
      issue('FLOW_VERSION_UNKNOWN', `The flow ${flow} came back as a draft (${reason}).`, {
        flow,
        reason,
        types: ['Flow'],
      });
    const newer = (flow: string, version: number): Issue =>
      issue(
        'FLOW_NEWER_VERSION',
        `The flow ${flow} has a version newer than ${String(version)}.`,
        { flow, version },
        'info',
      );
    const notBack = (flow: string): Issue =>
      issue('ACTIVE_FLOW_NOT_RETRIEVED', `The active version of the flow ${flow} did not come back.`, { flow }, 'info');
    expect(
      readIssueRows([
        unknown('Alpha', 'no-definition'),
        newer('Beta', 2),
        unknown('Gamma', 'not-listed'),
        notBack('Eta'),
        unknown('Delta', 'no-definition'),
        newer('Epsilon', 5),
        unknown('Zeta', 'no-definition'),
        notBack('Theta'),
      ]),
    ).toEqual([
      ['warning', 'FLOW_VERSION_UNKNOWN', '3 flows. The first: The flow Alpha came back as a draft (no-definition).'],
      ['info', 'FLOW_NEWER_VERSION', '2 flows. The first: The flow Beta has a version newer than 2.'],
      ['warning', 'FLOW_VERSION_UNKNOWN', 'The flow Gamma came back as a draft (not-listed).'],
      [
        'info',
        'ACTIVE_FLOW_NOT_RETRIEVED',
        '2 flows. The first: The active version of the flow Eta did not come back.',
      ],
    ]);
  });

  it('gives every other issue a row, also where two say the same of the place they name', () => {
    const one = issue('NOT_RETRIEVED', 'classes/A.cls did not come back.', {
      at: 'classes/A.cls',
      types: ['ApexClass'],
    });
    expect(readIssueRows([one, one])).toEqual([
      ['warning', 'NOT_RETRIEVED', 'classes/A.cls did not come back.'],
      ['warning', 'NOT_RETRIEVED', 'classes/A.cls did not come back.'],
    ]);
  });
});
