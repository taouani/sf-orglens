/**
 * Pieces of Apex that a parser of today has to read: the syntax Salesforce added in the last years, and the less
 * common corners of SOQL and SOSL. Each piece is valid Apex as far as the documentation of Salesforce says. None
 * was compiled in an org for this trial.
 */
export interface Probe {
  readonly name: string;
  /** `statement`: inside a method. `member`: inside a class. `file`: a whole file. */
  readonly where: 'statement' | 'member' | 'file';
  readonly code: string;
}

export const PROBES: readonly Probe[] = [
  { name: 'safe navigation', where: 'statement', code: 'String n = a?.Owner?.Name; Integer s = l?.size();' },
  { name: 'null coalescing', where: 'statement', code: "String n = a.Name ?? b.Name ?? 'none';" },
  {
    name: 'switch on an object',
    where: 'statement',
    code: 'switch on r { when Account a { f(a); } when null { } when else { } }',
  },
  { name: 'switch on values', where: 'statement', code: "switch on s { when 'a', 'b' { } when else { } }" },
  { name: 'switch on an enum', where: 'statement', code: 'switch on c { when RED, GREEN { } when BLUE { } }' },
  { name: 'DML in user mode', where: 'statement', code: 'insert as user a; update as system a; delete as user a;' },
  { name: 'upsert with a key field', where: 'statement', code: 'upsert rows Invoice__c.External_Id__c;' },
  { name: 'merge', where: 'statement', code: 'merge a b;' },
  {
    name: 'query in user mode',
    where: 'statement',
    code: 'List<Account> l = [SELECT Id FROM Account WITH USER_MODE];',
  },
  {
    name: 'query with SECURITY_ENFORCED',
    where: 'statement',
    code: 'List<Account> l = [SELECT Id FROM Account WITH SECURITY_ENFORCED];',
  },
  {
    name: 'query with FIELDS()',
    where: 'statement',
    code: 'List<Account> l = [SELECT FIELDS(STANDARD) FROM Account LIMIT 200];',
  },
  {
    name: 'query with TYPEOF',
    where: 'statement',
    code: 'List<Event> l = [SELECT TYPEOF What WHEN Account THEN Phone ELSE Name END FROM Event];',
  },
  {
    name: 'query with a date function and a date literal',
    where: 'statement',
    code: 'List<AggregateResult> l = [SELECT CALENDAR_YEAR(CreatedDate) y, COUNT(Id) n FROM Account WHERE CreatedDate = LAST_N_DAYS:30 GROUP BY CALENDAR_YEAR(CreatedDate) HAVING COUNT(Id) > 1];',
  },
  {
    name: 'query with a five-step relationship',
    where: 'statement',
    code: 'List<Contact> l = [SELECT Account.Parent.Parent.Owner.Manager.Name FROM Contact];',
  },
  {
    name: 'query with a nested sub-query',
    where: 'statement',
    code: 'List<Account> l = [SELECT Id, (SELECT Id, (SELECT Id FROM Assets) FROM Contacts) FROM Account];',
  },
  {
    name: 'query with a semi-join',
    where: 'statement',
    code: 'List<Account> l = [SELECT Id FROM Account WHERE Id NOT IN (SELECT AccountId FROM Contact WHERE Email != null)];',
  },
  {
    name: 'query with a bound expression',
    where: 'statement',
    code: 'List<Account> l = [SELECT Id FROM Account WHERE Name = :a.b.c() AND Id IN :new Set<Id>{ x } LIMIT :n OFFSET :o];',
  },
  {
    name: 'query FOR UPDATE and ALL ROWS',
    where: 'statement',
    code: 'List<Account> l = [SELECT Id FROM Account FOR UPDATE]; List<Account> m = [SELECT Id FROM Account ALL ROWS];',
  },
  {
    name: 'query with USING SCOPE',
    where: 'statement',
    code: 'List<Account> l = [SELECT Id FROM Account USING SCOPE mine WHERE Name != null];',
  },
  {
    name: 'query with toLabel, FORMAT and convertCurrency',
    where: 'statement',
    code: 'List<Opportunity> l = [SELECT toLabel(StageName), FORMAT(Amount) amt, convertCurrency(Amount) c FROM Opportunity];',
  },
  {
    name: 'query with GROUP BY ROLLUP',
    where: 'statement',
    code: 'List<AggregateResult> l = [SELECT LeadSource, COUNT(Name) c FROM Lead GROUP BY ROLLUP(LeadSource)];',
  },
  {
    name: 'query with DISTANCE',
    where: 'statement',
    code: "List<Account> l = [SELECT Id FROM Account WHERE DISTANCE(Location__c, GEOLOCATION(37.7, -122.4), 'mi') < 20];",
  },
  {
    name: 'query with ORDER BY NULLS LAST',
    where: 'statement',
    code: 'List<Account> l = [SELECT Id FROM Account ORDER BY Name DESC NULLS LAST, CreatedDate ASC];',
  },
  {
    name: 'query with INCLUDES',
    where: 'statement',
    code: "List<Account> l = [SELECT Id FROM Account WHERE Tags__c INCLUDES ('a;b', 'c')];",
  },
  {
    name: 'query with a date and a date-time',
    where: 'statement',
    code: 'List<Account> l = [SELECT Id FROM Account WHERE CreatedDate > 2024-01-01T00:00:00Z AND Day__c = 2024-01-01];',
  },
  {
    name: 'query with WITH DATA CATEGORY',
    where: 'statement',
    code: "List<SObject> l = [SELECT Title FROM KnowledgeArticleVersion WHERE PublishStatus = 'Online' WITH DATA CATEGORY Geography__c ABOVE usa__c];",
  },
  {
    name: 'search',
    where: 'statement',
    code: "List<List<SObject>> l = [FIND 'acme*' IN NAME FIELDS RETURNING Account(Id, Name WHERE Industry = 'x' ORDER BY Name LIMIT 5), Contact];",
  },
  {
    name: 'search with a bound term and options',
    where: 'statement',
    code: 'List<List<SObject>> l = [FIND :term IN ALL FIELDS RETURNING Account(Name) WITH SNIPPET LIMIT 10];',
  },
  {
    name: 'for over a query',
    where: 'statement',
    code: 'for (List<Account> batch : [SELECT Id FROM Account]) { } for (Account a : [SELECT Id FROM Account]) { }',
  },
  {
    name: 'nested generic types',
    where: 'statement',
    code: 'Map<Id, List<Set<String>>> m = new Map<Id, List<Set<String>>>();',
  },
  {
    name: 'collections with values',
    where: 'statement',
    code: "Map<String, Integer> m = new Map<String, Integer>{ 'a' => 1 }; List<String> l = new List<String>{ 'a' }; String[] s = new String[]{ 'a' }; Integer[] n = new Integer[3];",
  },
  {
    name: 'class literal and instanceof',
    where: 'statement',
    code: 'Type t = Account.class; Type u = List<Account>.class; Boolean b = o instanceof Account;',
  },
  {
    name: 'cast and ternary',
    where: 'statement',
    code: 'Account a = (Account) o; Integer i = b ? 1 : c ? 2 : 3; Object p = (Map<String, Object>) JSON.deserializeUntyped(s);',
  },
  {
    name: 'bit operators',
    where: 'statement',
    code: 'Integer i = a >>> 2 | b << 1 & c ^ d; i >>>= 1; i <<= 2; i |= 1; Boolean e = x === y || x !== y;',
  },
  { name: 'runAs', where: 'statement', code: 'System.runAs(u) { insert a; }' },
  {
    name: 'try, catch, finally, throw',
    where: 'statement',
    code: 'try { f(); } catch (DmlException e) { throw new MyException(e); } catch (Exception e) { } finally { g(); }',
  },
  {
    name: 'do, while, break, continue',
    where: 'statement',
    code: 'do { i++; if (i > 3) break; continue; } while (i < 9); while (true) { break; }',
  },
  {
    name: 'a name that is a keyword elsewhere',
    where: 'statement',
    code: 'Integer limit = 1; String name = order.get(0); Object first = last; Integer count = sum + offset;',
  },
  { name: 'text with escapes', where: 'statement', code: "String s = 'it\\'s \\\\ a \\n \\u00e9 \\\"q\\\"';" },
  {
    name: 'long, decimal and double literals',
    where: 'statement',
    code: 'Long l = 100L; Decimal d = 1.50; Double f = 2.0d;',
  },
  {
    name: 'property with accessors',
    where: 'member',
    code: 'public static Integer n { get; private set; } public String s { get { return s; } set { s = value; } }',
  },
  {
    name: 'annotations with values',
    where: 'member',
    code: "@AuraEnabled(cacheable=true) @TestVisible private static void m() { } @InvocableMethod(label='x' description='y') public static void n(List<Id> ids) { } @Future(callout=true) static void p() { }",
  },
  {
    name: 'inner class, interface and enum',
    where: 'member',
    code: 'public virtual class A { } public abstract class B extends A implements I, J { abstract void m(); } public interface I extends J { void m(); } public enum E { X, Y }',
  },
  {
    name: 'initialisers and constructors',
    where: 'member',
    code: 'static { f(); } { g(); } public P() { this(1); } public P(Integer a) { super(); }',
  },
  {
    name: 'modifiers',
    where: 'member',
    code: "global virtual override void a() { } transient Integer t; webservice static void w() { } public final static String C = 'c';",
  },
  {
    name: 'sharing modes',
    where: 'file',
    code: 'public inherited sharing class P { public without sharing class Q { } public with sharing class R { } }',
  },
  {
    name: 'trigger',
    where: 'file',
    code: "trigger T on Account (before insert, after update, after undelete) { for (Account a : Trigger.new) { a.Name = 'x'; } }",
  },
  {
    name: 'test class',
    where: 'file',
    code: "@IsTest private class P { @IsTest static void t() { Test.startTest(); System.assertEquals(1, 1, 'm'); Assert.areEqual(1, 1); Test.stopTest(); } @TestSetup static void s() { } static testMethod void old() { } }",
  },
];

/** The file a probe makes. */
export function probeSource(probe: Probe): { source: string; kind: 'class' | 'trigger' } {
  if (probe.where === 'file')
    return { source: probe.code, kind: probe.code.startsWith('trigger') ? 'trigger' : 'class' };
  const body = probe.where === 'member' ? probe.code : `void m() { ${probe.code} }`;
  return { source: `public class P { ${body} }`, kind: 'class' };
}
