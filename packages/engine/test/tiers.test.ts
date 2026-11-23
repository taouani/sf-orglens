/**
 * The logic tier: the types a snapshot of an org is judged by (`core/tiers.ts`, decision records 0046 and 0068).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RegistryAccess } from '@salesforce/source-deploy-retrieve';
import { describe, expect, it } from 'vitest';
import { logicTierTypes, tierOf, tierOfAny } from '../src/core/tiers.ts';
import { analyseSource } from '../src/extraction/analyse.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';

describe('the logic tier', () => {
  it('is the list of record 0004 with the three types of record 0038 and the four of record 0068', () => {
    expect(logicTierTypes()).toEqual([
      'ApexClass',
      'ApexTrigger',
      'AuraDefinitionBundle',
      'CustomField',
      'CustomLabel',
      'CustomLabels',
      'CustomMetadata',
      'CustomObject',
      'CustomPermission',
      'FieldSet',
      'Flow',
      'GlobalValueSet',
      'LightningComponentBundle',
      'NamedCredential',
      'PermissionSet',
      'PermissionSetGroup',
      'Profile',
      'RecordType',
      'ValidationRule',
      'Workflow',
      'WorkflowAlert',
      'WorkflowFieldUpdate',
      'WorkflowOutboundMessage',
      'WorkflowRule',
      'WorkflowTask',
    ]);
  });

  it('holds every type the analysis reads', () => {
    // Every type that has an analyser counts for the judgement of a snapshot (decision record 0058). The core
    // knows no analyser, so the list names them, and this test fails when an analyser reads a type it lacks.
    const nothing = {
      files: [],
      read: (path: string): Uint8Array => {
        throw new Error(`The tree holds no file, and ${path} was asked for.`);
      },
    };
    const read = analyseSource(nothing, []).types;
    expect(read).toContain('WorkflowTask');
    expect(read.filter((type) => tierOf(type) !== 'logic')).toEqual([]);
  });

  it('holds only names the Salesforce library knows as metadata types', () => {
    const registry = new RegistryAccess();
    for (const type of logicTierTypes()) expect(registry.getTypeByName(type).name).toBe(type);
  });

  it('is written out in the documentation of the command line, type by type', () => {
    const documented = readFileSync(join(FIXTURES_DIR, '..', 'docs', 'cli.md'), 'utf8');
    const list = /The types of the logic tier are:\n\n((?:\s*`[A-Za-z]+`[,.])+)/.exec(documented)?.[1] ?? '';
    expect([...list.matchAll(/`([A-Za-z]+)`/g)].map((match) => match[1])).toEqual(logicTierTypes());
  });

  it('takes a type by its own name, also a part of an object', () => {
    expect(tierOf('CustomObject')).toBe('logic');
    expect(tierOf('ValidationRule')).toBe('logic');
    // A list view is a part of an object and is not named in the list.
    expect(tierOf('ListView')).toBe('other');
    expect(tierOf('Report')).toBe('other');
    expect(tierOf('customobject')).toBe('other');
  });

  it('counts what can be of a type of the tier, and what nothing tells the type of, against the tier', () => {
    expect(tierOfAny([])).toBe('logic');
    expect(tierOfAny(['Report', 'ReportFolder'])).toBe('other');
    expect(tierOfAny(['Report', 'ApexClass'])).toBe('logic');
    expect(tierOfAny(['ApexClass'])).toBe('logic');
  });
});
