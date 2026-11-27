# 0092. The resolver of Apex reads the names that records of custom metadata and field sets hold

- Status: Accepted
- Date: 2026-11-27
- Decisions: none (builds part C of work package 5 of the Phase 3 plan, with the choices the author made in it, which
  the maintainer can strike)

## Context

Step 2 of work package 5 of the [Phase 3 plan](../plans/phase-3.md) reads metadata that holds names: "A text read from
a field of a custom metadata record, or the fields of a field set read by its name, give the names the records and the
field set hold, at `probable`, with the place of the read in the code: the names are read from metadata, and the
object is known (record 0012)." Records [0090](0090-the-resolver-of-apex-reads-names-in-texts.md) and
[0091](0091-the-resolver-of-apex-reads-texts-from-the-calls.md) built step 1 and step 3: the names in the texts that a
member builds, and in the texts that a method is handed by its calls. Until now a field of a record of a custom
metadata type was a text that is not known, as a field of any other record is, and a field set was a class of
Salesforce: `fieldSets.getMap().get('Invoice_Summary')` gave nothing.

Record [0065](0065-record-types-field-sets-and-records-of-custom-metadata.md) reads the files of both. A
record of a custom metadata type is a file of its own, `customMetadata/Billing_Rule.Invoice_Late_Fee.md-meta.xml`, that
gives some fields of its type a value. A field set is a file in the folder of its object that lists the fields it
shows (`displayedFields`) and the fields a user may add to it (`availableFields`), also through relationships, as
`Account__r.Tier__c`. Apex reads a record with `Billing_Rule__mdt.getInstance(name)`, `Billing_Rule__mdt.getAll()`, a
query of the type or a record it is handed, and a field set with
`Schema.SObjectType.Invoice__c.fieldSets.getMap().get(name)`, a describe of the object, or the token
`Schema.SObjectType.Invoice__c.fieldSets.Invoice_Summary`. The fields of a field set are those `getFields()` gives:
the ones it shows.

The fixture project holds one of each (`InvoiceQueries`): a field of the record `Invoice_Late_Fee` that names the field
a query reads, and the field set `Invoice_Summary` read by its name. The answer key has seven entries for them, which
the resolver did not find so far (`ofMetadata` of `test/helpers/answer-key.ts`).

This is the last part of the reading of names in texts. The counts of the coverage, the other line of the work
package, are a pull request of their own.

## Decision

1. **A field of a record that holds a text.** A field of a record of a custom metadata type that the file of the field
   gives the type `Text`, `TextArea` or `LongTextArea`, as record 0065 reads a value as a name, is a text when the code
   reads it: the values that the records of the snapshot give it. Its characters stand where the code reads the field,
   as `rule.Field_Name__c`, so each name it makes stands there, and the rules of records 0090 and 0091 apply to it as to
   a literal: a name is `probable`, a part that is not known is a `possible` reference to the object or a warning. Where
   the snapshot holds no record of the type, the field is a text that is not known, as before. A field that the code
   writes is not read.
2. **Which records.** The code can name the records it reads. `getInstance(text)` and `getAll().get(text)` of the type
   give a record of each name the text holds, and a reference to the record, of the kind `references`, with the `via`
   `text`, where the name stands: `probable` and resolved where the snapshot holds the record, also one named after its
   type with the suffix `__mdt`, and unresolved otherwise, with the type in `attrs.object`. A local variable assigned
   once keeps the records its value names, and a value of two ways can be the records of both. Every record of the type
   can be read where the code does not name it: a text that is not known, an id, `getAll()` and its values, a query of
   the type, a record a method is handed or gives back, a local variable assigned again, and a branch of which one way
   names no record, also where that way is of no known type, as what a method of a package gives. A text that is known
   and is no name, and `null`, name no record: the code gets none, and its fields give no text. Where a call chooses
   among methods by the types of their arguments, the map that `getAll()` gives is a map of texts to records of the
   type.
3. **A text that is not known.** A field adds a part that is not known to the texts it holds where a record the code
   names is not in the snapshot, where the code makes the record with `new`, whose fields hold what the code puts in
   them, and where no record that can be read gives the field a value. So `inv.get(rule.Field__c)` then gives a
   `possible` reference to the object beside the names the records hold, or a warning where the object is not known.
4. **A field set.** A text that `getMap().get(text)` of the field sets of a describe is given, also of a describe of a
   token, names a field set of the object. The token `Schema.SObjectType.Invoice__c.fieldSets.Invoice_Summary` names one
   as a token. The code refers to the field set where its name stands, with the `via` `text` or `token`, and reads each
   field it shows there, through relationships as a path of a query does, with the `via` `text` and at `probable`: the
   names are read from the metadata. A field the field set only offers is not read, and the name of a field set is
   matched whatever its case. A field set the snapshot does not hold, a name that is not known, and `getMap().values()`,
   of which the code can read any field set, give a `possible` reference to the object, of the kind `reads`. A text that
   is known and is no name names no field set, as for a record. Where nothing says the object, the name of the field set
   is the warning `PATH_NOT_FOLLOWED`. Where a call chooses among methods, the map that `getMap()` gives is a map of
   texts to field sets.
5. **At the calls.** The name of a record and of a field set are two more uses of record 0091. A method that hands a
   `String` parameter to `getInstance` or to `getMap().get` keeps the use, and each call reads it again with the text it
   gives, as for a field of `get`. The caller reports a name its own characters make, the method one of its own, and the
   method says what it does not know itself, once. A call that hands an empty text, as `''`, gives no character, but the
   name that the characters of the method make with it is the caller's too, at the name of the method in the call: the
   method does not report it, because the parameter stands in it, so until now nobody did. This changes rule 3 of record
   0091 in that one point, also for the names of fields and objects.
6. **Not read.**
   - What a method gives back of a record it is handed the name of, or that it reads by a text that is not known: any
     record of the type, so its fields give every text the records hold, at each call.
   - A field of the type `MetadataRelationship`: it is a relationship to the definition of an object or a field, which
     record 0065 reads in the file as a `confirmed` reference. What Apex reads in it when the code runs was not checked,
     so it is not taken as a text. A field of another type that holds a text, as a picklist, is not read either, as
     record 0065 does not read it.
   - A field read with `get`, as `rule.get('Field_Name__c')`, which gives an `Object`, and the names of a record,
     `DeveloperName`, `Label` and `MasterLabel`, which the snapshot knows: they are texts that are not known, as before.
   - The condition of a query of the type: `[SELECT ... FROM Billing_Rule__mdt WHERE DeveloperName = 'X']` reads every
     record. What the code writes into a field of a record and reads again, and what it puts into the map that
     `getAll()` gives, as a test does with a record it makes: the field gives what the records of the snapshot hold.
   - The case of the names in the map of `getAll()`. The analysis matches the name of a record whatever its case.
     Whether Salesforce matches the keys of that map so too was not checked: where it does not, `getAll().get('late')`
     gives a `probable` reference that the code does not make.
   - A field set of a map that the code does not take from `getMap()` of a known object, as a member that is not
     constant, a local variable assigned again or a parameter, and the fields of a field set that `values()` gives,
     beside the `possible` reference of rule 4: nothing is reported, as before.
   - The object of a describe, a token or a name of an object that a method is handed: a field set that a call names of
     such an object is the warning of rule 4 at the call. Most of these are helpers that are handed the name of the
     object as a text and describe the object by it.
   - A record of a custom setting, which is data that a snapshot does not hold (record 0012).

## Consequences

- The fixture project gives the seven entries of the key that its metadata holds: the record `Invoice_Late_Fee`, the
  field `Late_Fee__c` its field `Field_Name__c` names, where `InvoiceQueries` reads it into a query, and the field set
  `Invoice_Summary` with the fields it shows, also through a relationship, at the place of its name. Every entry of the
  key that is not stretch is now found, and nothing is reported that the key does not hold: the `possible` reference to
  the object that record 0090 gave at that query, which the key does not hold, is now the field the key names. The
  classes and triggers give 517 references instead of 511, and the analysis of the project 851 instead of 845. An impact
  answer about `Invoice__c.Amount__c` holds the method that reads the field set, and through the field `Late_Fee__c` the
  method that runs the query.
- Five tests of `extraction-apex-resolver.test.ts` hold the rules: the records the code names, every record, a map and a
  list of `getAll()`, a branch, also with a way of no known type, a local, also one assigned again, a record the
  snapshot does not hold or that gives the field no value, a type it holds no record of, a text that is no name, `null`,
  an id, a record the code makes, a record named with the suffix, a field written, a number, a metadata relationship, a
  picklist, a text area and a long text, a custom setting, a field set by name, whatever its case, by token and by a
  describe, through a relationship, one that the snapshot does not hold, by name and by token, one of an object nothing
  says, `values()` of the field sets, the maps of rules 2 and 4 where a call chooses among methods, and the calls of
  rule 5, with names that a call and the method make together, also of an empty text. Of 74 faults planted in the code
  of this part, one at a time, the tests catch all. Each fault takes a condition out, turns it round, makes it always
  true or always false, or leaves a step out: in reading a field and its texts, in naming records and the field sets, in
  each method of rule 2, in a local and a branch, in the uses at the calls, in the schema, in what the analysis gathers
  of the files, and in the types of fields that hold a text. The first run planted 70 and let 15 pass. Eleven of them
  changed nothing the analysis gives. Ten were checks, which were taken out of the code: the keys of the map of
  `getAll()` and the keys and values of the map of field sets, which nothing reads; a check of the object where a local
  keeps the names of records, and one where two ways meet; a check of a write, and one of the type of the record, of
  which the schema holds no record anyway; two checks of the kind of value that names a record or a field set, where an
  id and a text that is not known give the same; a check of a name given twice, which the reading of the records drops
  anyway; and one of an empty value, which the reader of the files never gives. The eleventh changed a value that only a
  field is read with, and was dropped. Four showed gaps in the tests: the list of `getAll()`, a text area, a record
  named with the suffix, and the names a call and the method make together for a record. A second run, of the code as it
  was then, let five pass: the check of a write, which was still in the code, a choice of the object where two ways
  meet, which was taken out too, and three gaps, the names a call and the method make together for a record and for a
  field set, and what the method does not know itself in front of a parameter. Each gap has a case now. Writing them
  showed that a record the code makes with `new` gave the texts of the records of the snapshot, which rule 3 now says.
  Ten faults more were planted in the fixes of the review, and are caught. The faults of records 0090 and 0091 were
  planted again: of 50, 49 are caught, and of 59, 55, the same misses as before. The faults were chosen by hand, so a
  fault of another kind can still pass.
- On the eight public codebases the names that metadata holds give 149 `text` references more (Apex Recipes 2, Nebula
  Logger 18, NPSP 68, PMM 24, V4S 37) and 33 `token` references more, the field sets named by a token (NPSP 16, PMM 5,
  V4S 12) (`extraction-corpora.test.ts`). Of the warnings, 28 came (EDA 2, Nebula Logger 4, NPSP 20, PMM 2) and 5 went
  (Apex Recipes 1, Nebula Logger 1, NPSP 3), where a class that `Type.forName` is given now comes from a field of the
  records. Coral Cloud and Outbound Funds are unchanged. No codebase names a record by a literal in the folders the
  analysis reads: the new references are of every record of a type, as `LoggerSObjectHandler` of Nebula Logger and
  `MetadataTriggerHandler` of Apex Recipes read the classes that records name for `Type.forName`, and of field sets,
  which Nebula Logger, NPSP, PMM and V4S read by token or by name. Most of the warnings that came are calls of a helper
  of NPSP and of EDA that is handed the name of an object and of a field set (rule 6). A script compared the references
  one by one against the main branch, and the code at each place where one changed was read by hand.
- The review of the pull request found that a way of a branch of no known type narrowed the records to those the other
  way names, that a call no longer chose among methods by the map of `getAll()`, and that a call that hands an empty
  text lost a name the method makes with it, which record 0091 left so and which the texts of records made worse: a
  `possible` reference became nothing. Each is fixed, with a test. It also listed what is not read, which rule 6 now
  says, and rules without a test, which have one now. A text that is known and is no name gave a `possible` reference at
  a field set and nothing at a record: it gives nothing at both now, and `values()` of the field sets gives the
  `possible` reference instead. Measured on the codebases again, the fixes changed Nebula Logger only: three `possible`
  references went, at texts that are no name, which a test hands as the name of a field set, and two came, at
  `values()`. Each was read by hand.
- The analysis takes about as long as before. On the machine of the build, which was slower than for record 0091, NPSP
  took between 8.3 and 9.1 seconds on the main branch and between 8.4 and 10.2 with this part, four runs each way, and
  its peak of memory was between 596 and 628 MiB on the main branch and between 623 and 646 with this part. EDA took 3.0
  and 3.2 seconds on the main branch, and 3.0 and 3.4 with this part.
