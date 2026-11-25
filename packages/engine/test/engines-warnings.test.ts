/**
 * Which warnings of an analysis can bear on an impact answer (decision record 0074), from the keys of a walk alone.
 */
import { describe, expect, it } from 'vitest';
import { buildKey, type ComponentKey } from '../src/core/keys.ts';
import { warningsThatBear, type WalkedFrom } from '../src/engines/warnings.ts';
import { MOST_NAMES_SHOWN } from '../src/extraction/raw-references.ts';
import type { AnalysisWarning } from '../src/store/snapshots.ts';

const key = (type: string, fullName: string): ComponentKey => buildKey({ type, fullName });
const WEIGHT = key('CustomField', 'Parcel__c.Weight__c');
const HEAVY = key('CustomField', 'Parcel__c.Heavy__c');
const PARCEL = key('CustomObject', 'Parcel__c');
const FLOW = key('Flow', 'Ship');
const ELEMENT = key('Flow', 'Ship#element:Check');
const OTHER = key('Flow', 'Other#element:Read');
const KIND = key('RecordType', 'Parcel__c.Fragile');

const walked = (start: ComponentKey[], results: ComponentKey[] = [], through: ComponentKey[] = []): WalkedFrom => ({
  start,
  through,
  results: results.map((one) => ({ key: one })),
});
const path = (componentKey: ComponentKey | null, notFollowed: string[] | null): AnalysisWarning => ({
  code: 'PATH_NOT_FOLLOWED',
  componentKey,
  notFollowed,
});
const other = (componentKey: ComponentKey | null): AnalysisWarning => ({
  code: 'FORMULA_NOT_READ',
  componentKey,
  notFollowed: null,
});

describe('the warnings that bear on what a component refers to', () => {
  it('are those of what the walk went from: the start, what it contains, the results and the elements of flows', () => {
    const warnings = [other(WEIGHT), path(HEAVY, ['Width__c']), other(ELEMENT), other(OTHER), path(PARCEL, [])];
    expect(warningsThatBear(warnings, walked([HEAVY]), 'outgoing')).toEqual([warnings[1]]);
    expect(warningsThatBear(warnings, walked([HEAVY], [WEIGHT]), 'outgoing')).toEqual([warnings[0], warnings[1]]);
    expect(warningsThatBear(warnings, walked([PARCEL, HEAVY]), 'outgoing')).toEqual([warnings[1], warnings[4]]);
    expect(warningsThatBear(warnings, walked([WEIGHT], [FLOW], [ELEMENT]), 'outgoing')).toEqual([
      warnings[0],
      warnings[2],
    ]);
  });

  it('take a warning about no component for every answer, and none where there is no warning', () => {
    const file = other(null);
    expect(warningsThatBear([file], walked([HEAVY]), 'outgoing')).toEqual([file]);
    expect(warningsThatBear([file], walked([HEAVY]), 'incoming')).toEqual([file]);
    expect(warningsThatBear([], walked([HEAVY]), 'incoming')).toEqual([]);
  });
});

describe('the warnings that bear on what refers to a component', () => {
  it('leave out those of the start: what it names never refers to it', () => {
    const warnings = [other(HEAVY), path(HEAVY, ['Heavy__c']), other(FLOW)];
    expect(warningsThatBear(warnings, walked([HEAVY]), 'incoming')).toEqual([warnings[2]]);
    // The flow of an element that is asked about is of the start. The path of Heavy__c ends in a field of its
    // own name, which the answer does not hold.
    expect(warningsThatBear(warnings, walked([ELEMENT, FLOW]), 'incoming')).toEqual([warnings[0]]);
  });

  it('take every warning of another code, wherever it is', () => {
    const warnings = [
      other(WEIGHT),
      other(OTHER),
      { code: 'RESOURCE_NOT_FOUND', componentKey: OTHER, notFollowed: null },
      // Names on another code say nothing: only a path that was not followed keeps names of fields.
      { code: 'NAME_NOT_READ', componentKey: OTHER, notFollowed: ['Width__c'] },
    ];
    expect(warningsThatBear(warnings, walked([HEAVY]), 'incoming')).toEqual(warnings);
  });

  it('take a path that was not followed only where its names can be a field of the answer', () => {
    const width = path(OTHER, ['Width__c']);
    const weight = path(OTHER, ['Box__r', 'WEIGHT__C']);
    const parent = path(OTHER, ['Parcel__r']);
    const warnings = [width, weight, parent];
    expect(warningsThatBear(warnings, walked([WEIGHT]), 'incoming')).toEqual([weight]);
    // A result counts as the start does.
    expect(warningsThatBear(warnings, walked([HEAVY], [WEIGHT]), 'incoming')).toEqual([weight]);
    // A relationship is the field behind it: `Parcel__r` is `Parcel__c`.
    const lookup = key('CustomField', 'Box__c.Parcel__c');
    expect(warningsThatBear(warnings, walked([lookup]), 'incoming')).toEqual([parent]);
    expect(warningsThatBear(warnings, walked([HEAVY]), 'incoming')).toEqual([]);
  });

  it('take a path that was not followed where the answer holds an object, at whose end the path can be', () => {
    const warnings = [path(OTHER, ['Width__c']), path(OTHER, [])];
    expect(warningsThatBear(warnings, walked([HEAVY], [PARCEL]), 'incoming')).toEqual(warnings);
    expect(warningsThatBear(warnings, walked([PARCEL, HEAVY, WEIGHT]), 'incoming')).toEqual(warnings);
    // With no names the path ends at an object, and it bears on no answer without one.
    expect(warningsThatBear([path(OTHER, [])], walked([HEAVY]), 'incoming')).toEqual([]);
  });

  it('take a path through RecordType where the answer holds a record type, which a flow can compare with', () => {
    const warnings = [path(OTHER, ['Box__r', 'RecordType', 'DeveloperName']), path(OTHER, ['Box__r', 'Weight__c'])];
    expect(warningsThatBear(warnings, walked([KIND]), 'incoming')).toEqual([warnings[0]]);
    expect(warningsThatBear(warnings, walked([HEAVY]), 'incoming')).toEqual([]);
  });

  it('take a path that was not followed where its names were cut or not kept', () => {
    const many = Array.from({ length: MOST_NAMES_SHOWN }, (_, index) => `Step${String(index)}__r`);
    const warnings = [path(OTHER, many), path(OTHER, many.slice(1)), path(OTHER, null)];
    expect(warningsThatBear(warnings, walked([HEAVY]), 'incoming')).toEqual([warnings[0], warnings[2]]);
  });

  it('keep the order and the objects they were given', () => {
    const first = path(OTHER, ['Weight__c']);
    const second = other(WEIGHT);
    const kept = warningsThatBear([first, second], walked([WEIGHT]), 'incoming');
    expect(kept).toEqual([first]);
    expect(kept[0]).toBe(first);
  });
});
