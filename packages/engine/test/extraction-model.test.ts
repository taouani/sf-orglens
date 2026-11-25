/**
 * The model of objects that names are resolved against, and what a name says about where it comes from.
 */
import { describe, expect, it } from 'vitest';
import { buildKey, type ComponentKey } from '../src/core/keys.ts';
import {
  buildModel,
  GLOBAL_OBJECTS,
  walkPath,
  type FieldFacts,
  type ObjectModel,
  type Target,
} from '../src/extraction/model.ts';
import { geolocationField, isCustomName, namespaceOf, plainNamespaceOf } from '../src/extraction/names.ts';
import { fieldsANameCanBe } from '../src/extraction/raw-references.ts';

const key = (type: string, fullName: string): ComponentKey => buildKey({ type, fullName });
const field = (fullName: string): ComponentKey => key('CustomField', fullName);

/**
 * A small snapshot: an invoice with its file, an account of which the snapshot holds two fields and no file,
 * a user with a hierarchy field, a custom field of the activity, two of the contact, and two as a person account
 * shows them, of which one is a field of the contact too.
 */
function model(): ObjectModel {
  const fields = new Map<ComponentKey, FieldFacts>([
    [field('Invoice__c.Account__c'), { type: 'Lookup', referenceTo: ['Account'] }],
    [field('Invoice__c.Amount__c'), { type: 'Currency', referenceTo: [] }],
    [field('Invoice__c.Place__c'), { type: 'Location', referenceTo: [] }],
    [field('Invoice__c.Related__c'), { type: 'Lookup', referenceTo: ['Account', 'Contact'] }],
    [field('Invoice__c.Broken__c'), { type: 'Lookup', referenceTo: [] }],
    [field('Account.Tier__c'), { type: 'Picklist', referenceTo: [] }],
    [field('Account.SponsorId'), { type: 'Lookup', referenceTo: ['Sponsor__c'] }],
    [field('User.Backup__c'), { type: 'Hierarchy', referenceTo: [] }],
    [field('Activity.Stage__c'), { type: 'Text', referenceTo: [] }],
    [field('Contact.Level__c'), { type: 'Text', referenceTo: [] }],
    [field('Contact.Mentor__c'), { type: 'Lookup', referenceTo: ['User'] }],
    [field('PersonAccount.Level__pc'), { type: 'Text', referenceTo: [] }],
    [field('PersonAccount.Hobby__pc'), { type: 'Lookup', referenceTo: ['Sponsor__c'] }],
  ]);
  return buildModel({
    defined: new Set([
      key('CustomObject', 'Invoice__c'),
      key('GlobalValueSet', 'Region'),
      key('CustomObject', 'Sponsor__c'),
      ...fields.keys(),
    ]),
    objects: ['Invoice__c', 'Account', 'User', 'Sponsor__c'],
    namedObjects: ['Account', 'Contact', 'Sponsor__c', 'Depot'],
    fields,
  });
}

describe('what a name says', () => {
  it('tells a custom name from a standard one', () => {
    expect(['Invoice__c', 'Rule__mdt', 'ns__Invoice__c', 'Account__r'].map(isCustomName)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(['Account', 'OwnerId', 'Product2', 'a_b'].map(isCustomName)).toEqual([false, false, false, false]);
  });

  it('finds the namespace of an object or a field: the first of three parts', () => {
    expect(namespaceOf('npsp__Batch__c')).toBe('npsp');
    expect(namespaceOf('npsp__Batch__r')).toBe('npsp');
    expect(namespaceOf('Batch__c')).toBeNull();
    expect(namespaceOf('Account')).toBeNull();
    expect(namespaceOf('__Batch__c')).toBeNull();
  });

  it('does not take the two parts of a geolocation field for a namespace', () => {
    expect(namespaceOf('Place__Latitude__s')).toBeNull();
    expect(namespaceOf('Place__longitude__s')).toBeNull();
    expect(namespaceOf('ns__Place__Latitude__s')).toBe('ns');
    expect(geolocationField('Place__Latitude__s')).toBe('Place__c');
    expect(geolocationField('ns__Place__Longitude__s')).toBe('ns__Place__c');
    expect(geolocationField('Place__c')).toBeNull();
    expect(geolocationField('Latitude__s')).toBeNull();
  });

  it('finds the namespace of a name without a suffix: the first of two parts', () => {
    expect(plainNamespaceOf('npsp__Region')).toBe('npsp');
    expect(plainNamespaceOf('Region')).toBeNull();
    expect(plainNamespaceOf('Billing_Region')).toBeNull();
    expect(plainNamespaceOf('__Region')).toBeNull();
  });
});

describe('what becomes of the name of an object', () => {
  const object = (name: string): Target => model().object(name);

  it('is resolved when a file defines the object', () => {
    expect(object('Invoice__c')).toEqual({
      to: 'CustomObject:invoice__c',
      toType: 'CustomObject',
      resolution: 'resolved',
    });
    expect(object('INVOICE__C').to).toBe('CustomObject:invoice__c');
  });

  it('is external and keeps its key when Salesforce provides the object, or the snapshot holds only parts of it', () => {
    expect(object('Account')).toEqual({ to: 'CustomObject:account', toType: 'CustomObject', resolution: 'external' });
    expect(object('Contact')).toEqual({ to: 'CustomObject:contact', toType: 'CustomObject', resolution: 'external' });
  });

  it('is external for an object of a package that is not in the snapshot', () => {
    expect(object('npsp__Batch__c')).toEqual({
      to: 'CustomObject:npsp__batch__c',
      toType: 'CustomObject',
      resolution: 'external',
    });
  });

  it('is unresolved, without a key, for a custom object that nothing defines', () => {
    expect(object('Missing__c')).toEqual({ to: null, toType: 'CustomObject', resolution: 'unresolved' });
  });

  it('is unresolved for a text that cannot be a name', () => {
    expect(object('In\u0000voice')).toEqual({ to: null, toType: 'CustomObject', resolution: 'unresolved' });
  });
});

describe('what becomes of the name of a field', () => {
  const fieldOf = (object: string, name: string): Target => model().field(object, name);
  const resolutions = (object: string, names: readonly string[]): (string | null)[] =>
    names.map((name) => {
      const { to, resolution } = fieldOf(object, name);
      return `${resolution} ${String(to)}`;
    });

  it('is resolved when a file defines the field, in any case', () => {
    expect(resolutions('Invoice__c', ['Amount__c', 'AMOUNT__C'])).toEqual([
      'resolved CustomField:invoice__c.amount__c',
      'resolved CustomField:invoice__c.amount__c',
    ]);
    expect(resolutions('Account', ['Tier__c'])).toEqual(['resolved CustomField:account.tier__c']);
  });

  it('is external and keeps its key for a standard field that no file defines', () => {
    expect(resolutions('Account', ['Name'])).toEqual(['external CustomField:account.name']);
    expect(resolutions('Invoice__c', ['OwnerId'])).toEqual(['external CustomField:invoice__c.ownerid']);
    // An object of which the snapshot holds nothing.
    expect(resolutions('Contact', ['Email'])).toEqual(['external CustomField:contact.email']);
  });

  it('is unresolved for a custom field that nothing defines, on an object of the snapshot or on a standard one', () => {
    expect(resolutions('Invoice__c', ['Missing__c'])).toEqual(['unresolved null']);
    expect(resolutions('Account', ['Missing__c'])).toEqual(['unresolved null']);
    expect(resolutions('Contact', ['Missing__c'])).toEqual(['unresolved null']);
  });

  it('is external for a field of a package', () => {
    expect(resolutions('Account', ['npsp__Level__c'])).toEqual(['external CustomField:account.npsp__level__c']);
    // Every field of an object of a package that is not in the snapshot, also one without a prefix.
    expect(resolutions('npsp__Batch__c', ['Name', 'Local__c', 'npsp__Size__c'])).toEqual([
      'external CustomField:npsp__batch__c.name',
      'external CustomField:npsp__batch__c.local__c',
      'external CustomField:npsp__batch__c.npsp__size__c',
    ]);
  });

  it('is unresolved for every field of a custom object that nothing defines', () => {
    expect(resolutions('Missing__c', ['Name', 'Amount__c'])).toEqual(['unresolved null', 'unresolved null']);
  });

  it('takes a part of a geolocation field for the field', () => {
    expect(resolutions('Invoice__c', ['Place__Latitude__s', 'Place__Longitude__s'])).toEqual([
      'resolved CustomField:invoice__c.place__c',
      'resolved CustomField:invoice__c.place__c',
    ]);
    expect(resolutions('Invoice__c', ['Nowhere__Latitude__s'])).toEqual(['unresolved null']);
  });

  it('looks for a custom field of a task or an event at the activity, where Salesforce keeps it', () => {
    expect(resolutions('Task', ['Stage__c', 'Subject', 'Other__c', 'ns__Stage__c'])).toEqual([
      'resolved CustomField:activity.stage__c',
      'external CustomField:task.subject',
      'unresolved null',
      'external CustomField:activity.ns__stage__c',
    ]);
    expect(resolutions('event', ['STAGE__C'])).toEqual(['resolved CustomField:activity.stage__c']);
    expect(resolutions('Activity', ['Stage__c'])).toEqual(['resolved CustomField:activity.stage__c']);
  });

  it('looks for a field of a person account at the contact, and only from the account', () => {
    expect(resolutions('Account', ['Level__pc', 'LEVEL__PC', 'Lost__pc', 'ns__Level__pc', 'Tier__c'])).toEqual([
      'resolved CustomField:contact.level__c',
      'resolved CustomField:contact.level__c',
      'unresolved null',
      'external CustomField:contact.ns__level__c',
      'resolved CustomField:account.tier__c',
    ]);
    expect(resolutions('Contact', ['Level__pc', 'Level__c'])).toEqual([
      'unresolved null',
      'resolved CustomField:contact.level__c',
    ]);
  });

  it('looks for it at the contact from the objects an org hands out parts of the account under, too', () => {
    // The snapshot defines `PersonAccount.Level__pc` as well: the field of the contact is the one that is meant.
    for (const object of ['PersonAccount', 'BusinessAccount', 'personaccount', 'BUSINESSACCOUNT']) {
      expect(resolutions(object, ['Level__pc', 'Lost__pc', 'ns__Level__pc'])).toEqual([
        'resolved CustomField:contact.level__c',
        'unresolved null',
        'external CustomField:contact.ns__level__c',
      ]);
    }
    // A custom field of another kind is the object's own, as written.
    expect(resolutions('BusinessAccount', ['Level__c'])).toEqual(['unresolved null']);
  });

  it('takes the field as the person account shows it where the snapshot defines that and no field of the contact', () => {
    expect(resolutions('PersonAccount', ['Hobby__pc', 'HOBBY__PC'])).toEqual([
      'resolved CustomField:personaccount.hobby__pc',
      'resolved CustomField:personaccount.hobby__pc',
    ]);
    // Only the object it is defined on shows it: no file defines it on the account.
    expect(resolutions('Account', ['Hobby__pc'])).toEqual(['unresolved null']);
  });
});

describe('what becomes of the name of another component', () => {
  const component = (type: string, name: string): Target => model().component(type, name);

  it('is resolved, external for a package, and unresolved otherwise', () => {
    expect(component('GlobalValueSet', 'Region')).toEqual({
      to: 'GlobalValueSet:region',
      toType: 'GlobalValueSet',
      resolution: 'resolved',
    });
    expect(component('GlobalValueSet', 'npsp__Region')).toEqual({
      to: 'GlobalValueSet:npsp__region',
      toType: 'GlobalValueSet',
      resolution: 'external',
    });
    expect(component('GlobalValueSet', 'Missing')).toEqual({
      to: null,
      toType: 'GlobalValueSet',
      resolution: 'unresolved',
    });
  });

  it('takes the name of a part by its own name, not by the suffix of its object', () => {
    const resolution = (type: string, name: string): string => {
      const target = component(type, name);
      return `${target.resolution} ${String(target.to)}`;
    };
    // The two underscores of `Invoice__c` are no prefix of a package: an alert the snapshot lacks is missing.
    expect(resolution('WorkflowAlert', 'Invoice__c.Overdue')).toBe('unresolved null');
    expect(resolution('WorkflowAlert', 'npsp__Batch__c.Overdue')).toBe('unresolved null');
    expect(resolution('WorkflowAlert', 'Invoice__c.npsp__Overdue')).toBe(
      'external WorkflowAlert:invoice__c.npsp__overdue',
    );
    // A record of a custom metadata type is named with its type, and is of a package when the type is.
    expect(resolution('CustomMetadata', 'npsp__Rule.Std')).toBe('external CustomMetadata:npsp__rule.std');
    expect(resolution('CustomMetadata', 'Rule.Std')).toBe('unresolved null');
  });
});

describe('a step through a relationship', () => {
  const step = (object: string, name: string): string => {
    const { field: behind, leadsTo } = model().relationship(object, name);
    return `${behind.resolution} ${String(behind.to)} -> ${String(leadsTo)}`;
  };

  it('takes a custom relationship as its lookup field, and goes where the file of the field says', () => {
    expect(step('Invoice__c', 'Account__r')).toBe('resolved CustomField:invoice__c.account__c -> Account');
    expect(step('Invoice__c', 'ACCOUNT__R')).toBe('resolved CustomField:invoice__c.account__c -> Account');
  });

  it('takes the relationship of a person account as the lookup field of the contact', () => {
    expect(step('Account', 'Mentor__pr')).toBe('resolved CustomField:contact.mentor__c -> User');
    expect(step('Account', 'MENTOR__PR')).toBe('resolved CustomField:contact.mentor__c -> User');
    expect(step('Account', 'Lost__pr')).toBe('unresolved null -> null');
    // Only an account shows the fields of a contact.
    expect(step('Contact', 'Mentor__pr')).toBe('unresolved null -> null');
  });

  it('takes it so from the objects an org hands out parts of the account under, too', () => {
    expect(step('BusinessAccount', 'Mentor__pr')).toBe('resolved CustomField:contact.mentor__c -> User');
    expect(step('PersonAccount', 'Mentor__pr')).toBe('resolved CustomField:contact.mentor__c -> User');
    expect(step('BusinessAccount', 'Lost__pr')).toBe('unresolved null -> null');
    // The field as the person account shows it, which is all the snapshot defines of it, says where it leads.
    expect(step('PersonAccount', 'Hobby__pr')).toBe('resolved CustomField:personaccount.hobby__pc -> Sponsor__c');
  });

  it('takes a hierarchy field as a field that points at its own object', () => {
    expect(step('User', 'Backup__r')).toBe('resolved CustomField:user.backup__c -> User');
  });

  it('takes a standard relationship as the field with Id at its end', () => {
    expect(step('Invoice__c', 'Owner')).toBe('external CustomField:invoice__c.ownerid -> User');
    expect(step('Account', 'CreatedBy')).toBe('external CustomField:account.createdbyid -> User');
    expect(step('Account', 'LastModifiedBy')).toBe('external CustomField:account.lastmodifiedbyid -> User');
    expect(step('User', 'Manager')).toBe('external CustomField:user.managerid -> User');
    expect(step('Contact', 'ReportsTo')).toBe('external CustomField:contact.reportstoid -> Contact');
    expect(step('Account', 'RecordType')).toBe('external CustomField:account.recordtypeid -> RecordType');
  });

  it('takes the parent and the master record as records of the same object', () => {
    expect(step('Account', 'Parent')).toBe('external CustomField:account.parentid -> Account');
    expect(step('Case', 'MasterRecord')).toBe('external CustomField:case.masterrecordid -> Case');
  });

  it('follows a relationship that is named like a standard object, or like an object a file names', () => {
    expect(step('Opportunity', 'Account')).toBe('external CustomField:opportunity.accountid -> Account');
    expect(step('Case', 'contact')).toBe('external CustomField:case.contactid -> Contact');
    expect(step('User', 'Profile')).toBe('external CustomField:user.profileid -> Profile');
    // No table knows a depot. A lookup of the snapshot points at one.
    expect(step('Invoice__c', 'Depot')).toBe('external CustomField:invoice__c.depotid -> Depot');
  });

  it('believes a file before the table', () => {
    expect(step('Account', 'Sponsor')).toBe('resolved CustomField:account.sponsorid -> Sponsor__c');
  });

  it('leads nowhere when nothing says where', () => {
    // A standard relationship that points at several objects, or that no table has.
    expect(step('Event', 'What')).toBe('external CustomField:event.whatid -> null');
    expect(step('Lead', 'ConvertedAccount')).toBe('external CustomField:lead.convertedaccountid -> null');
    // A lookup whose file names two objects, or none.
    expect(step('Invoice__c', 'Related__r')).toBe('resolved CustomField:invoice__c.related__c -> null');
    expect(step('Invoice__c', 'Broken__r')).toBe('resolved CustomField:invoice__c.broken__c -> null');
    // A custom relationship whose field is not there, or is a field of a package.
    expect(step('Invoice__c', 'Missing__r')).toBe('unresolved null -> null');
    expect(step('Invoice__c', 'npsp__Batch__r')).toBe('external CustomField:invoice__c.npsp__batch__c -> null');
  });
});

describe('walking a path', () => {
  const walk = (start: string, names: readonly string[]): { steps: (string | null)[]; complete: boolean } => {
    const { steps, complete } = walkPath(model(), start, names);
    return { steps: steps.map((one) => one.to), complete };
  };

  it('reads the field behind every relationship, and the field at the end', () => {
    expect(walk('Invoice__c', ['Account__r', 'Owner', 'Manager', 'Email'])).toEqual({
      steps: [
        'CustomField:invoice__c.account__c',
        'CustomField:account.ownerid',
        'CustomField:user.managerid',
        'CustomField:user.email',
      ],
      complete: true,
    });
    expect(walk('Invoice__c', ['Amount__c'])).toEqual({ steps: ['CustomField:invoice__c.amount__c'], complete: true });
  });

  it('stops after a relationship that leads nowhere, and says so', () => {
    expect(walk('Event', ['What', 'Name'])).toEqual({ steps: ['CustomField:event.whatid'], complete: false });
    expect(walk('Invoice__c', ['Account__r', 'Missing__r', 'Owner', 'Email'])).toEqual({
      steps: ['CustomField:invoice__c.account__c', null],
      complete: false,
    });
  });

  it('believes what the source says about a relationship before the model', () => {
    const said = (start: string, names: readonly string[], hints: Parameters<typeof walkPath>[3]): string => {
      const { steps, on, complete } = walkPath(model(), start, names, hints);
      return `${steps.map((one) => String(one.to)).join(' ')} on ${on.join(' ')} ${complete ? 'complete' : 'stopped'}`;
    };
    // The owner is taken as a user. A formula can say that it is a group.
    expect(said('Invoice__c', ['Owner', 'Name'], [])).toBe(
      'CustomField:invoice__c.ownerid CustomField:user.name on Invoice__c User complete',
    );
    expect(said('Invoice__c', ['Owner', 'Name'], [{ leadsTo: 'Group' }])).toBe(
      'CustomField:invoice__c.ownerid CustomField:group.name on Invoice__c Group complete',
    );
    // Also where a file says otherwise, and where the model knows nothing.
    expect(said('Invoice__c', ['Account__r', 'Name'], [{ leadsTo: 'Contact' }])).toBe(
      'CustomField:invoice__c.account__c CustomField:contact.name on Invoice__c Contact complete',
    );
    expect(said('Invoice__c', ['Related__r', 'Name'], [{ leadsTo: 'Contact' }])).toBe(
      'CustomField:invoice__c.related__c CustomField:contact.name on Invoice__c Contact complete',
    );
    // A hint is for the name at its place. The names without one are walked as ever.
    expect(said('Invoice__c', ['Account__r', 'Owner', 'Name'], [undefined, { leadsTo: 'Group' }])).toBe(
      'CustomField:invoice__c.account__c CustomField:account.ownerid CustomField:group.name on Invoice__c Account Group complete',
    );
  });

  it('looks for the field at the end under the name the source says it has in metadata', () => {
    const to = (names: readonly string[], hints: Parameters<typeof walkPath>[3]): (string | null)[] =>
      walkPath(model(), 'Invoice__c', names, hints).steps.map((one) => one.to);
    expect(to(['Owner', 'QueueName'], [{ leadsTo: 'Group' }, { resolveAs: 'Name' }])).toEqual([
      'CustomField:invoice__c.ownerid',
      'CustomField:group.name',
    ]);
    // Only the last name is a field. On a relationship the other name is not used.
    expect(to(['Account__r', 'Tier__c'], [{ resolveAs: 'Owner' }, undefined])).toEqual([
      'CustomField:invoice__c.account__c',
      'CustomField:account.tier__c',
    ]);
  });

  it('walks nothing for no names', () => {
    expect(walk('Invoice__c', [])).toEqual({ steps: [], complete: true });
  });

  it('says for each name which object it was looked for on, also for the one it stopped at', () => {
    expect(walkPath(model(), 'Invoice__c', ['Account__r', 'Owner', 'Manager', 'Email']).on).toEqual([
      'Invoice__c',
      'Account',
      'User',
      'User',
    ]);
    expect(walkPath(model(), 'Invoice__c', ['Account__r', 'Missing__r', 'Owner', 'Email']).on).toEqual([
      'Invoice__c',
      'Account',
    ]);
    expect(walkPath(model(), 'Invoice__c', []).on).toEqual([]);
  });
});

describe('the global variables that stand for a record', () => {
  it('are the user, the profile, the role and the organization', () => {
    expect([...GLOBAL_OBJECTS]).toEqual([
      ['$user', 'User'],
      ['$profile', 'Profile'],
      ['$userrole', 'UserRole'],
      ['$organization', 'Organization'],
    ]);
  });
});

describe('the fields a name of a path that was not followed can be', () => {
  /** The name of the field without its object, as the key folds it. */
  const nameOf = (target: Target): string | null =>
    target.to === null ? null : target.to.slice(target.to.lastIndexOf('.') + 1);
  const NAMES = [
    'Account__c',
    'Account__r',
    'Amount__c',
    'Place__Latitude__s',
    'Place__Longitude__s',
    'Related__r',
    'Tier__c',
    'Sponsor',
    'SponsorId',
    'Backup__r',
    'Stage__c',
    'Level__pc',
    'Level__pr',
    'Mentor__pr',
    'Mentor__c',
    'Hobby__pc',
    'Hobby__pr',
    'Owner',
    'Name',
    'npsp__Batch__r',
    'ACCOUNT__R',
  ];
  const OBJECTS = [
    ...['Invoice__c', 'Account', 'Contact', 'User', 'Task', 'Event', 'Sponsor__c'],
    ...['PersonAccount', 'BusinessAccount'],
  ];

  it('holds every field the model takes the name for, as the field at the end of a path or behind a relationship', () => {
    let found = 0;
    for (const object of OBJECTS) {
      for (const name of NAMES) {
        const can = fieldsANameCanBe(name);
        for (const target of [model().field(object, name), model().relationship(object, name).field]) {
          const field = nameOf(target);
          if (field === null) continue;
          found += 1;
          expect({ object, name, field, in: can.includes(field) }).toEqual({ object, name, field, in: true });
        }
      }
    }
    // The pairs that have a key, so that the test cannot pass by finding none.
    expect(found).toBeGreaterThan(90);
  });

  it('holds the name of a group that a formula calls the name of a queue', () => {
    const { steps } = walkPath(
      model(),
      'Invoice__c',
      ['Owner', 'QueueName'],
      [{ leadsTo: 'Group' }, { resolveAs: 'Name' }],
    );
    const last = steps.at(-1);
    expect(last === undefined ? null : nameOf(last)).toBe('name');
    expect(fieldsANameCanBe('QueueName')).toContain('name');
  });

  it('gives the name itself, folded, and the field of the relationship it can be', () => {
    expect(fieldsANameCanBe('Amount__c')).toEqual(['amount__c', 'amount__cid']);
    expect(fieldsANameCanBe('Invoice__r')).toEqual(['invoice__r', 'invoice__rid', 'invoice__c']);
    expect(fieldsANameCanBe('Account')).toEqual(['account', 'accountid']);
    expect(fieldsANameCanBe('Level__pr')).toEqual(['level__pr', 'level__prid', 'level__pc', 'level__c']);
    expect(fieldsANameCanBe('Level__pc')).toEqual(['level__pc', 'level__pcid', 'level__c']);
    expect(fieldsANameCanBe('Place__Latitude__s')).toEqual(['place__latitude__s', 'place__latitude__sid', 'place__c']);
  });
});
