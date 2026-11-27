# 0094. Lightning web components are read for their imports, their tags and the attributes of base components

- Status: Accepted
- Date: 2026-11-27
- Decisions: none (builds part A of work package 6 of the Phase 3 plan, with the choices the author made in it, which
  the maintainer can strike)

## Context

Record [0079](0079-lightning-components-and-visualforce-pages-in-phase-3.md) holds the answer of the maintainer to
question Q1 of the [Phase 3 plan](../plans/phase-3.md): a Lightning web component refers to the Apex it calls, the
fields and objects it imports or names in an attribute, the labels, and the components it holds. Work package 6 of the
plan says what each form names, and that the JavaScript is read for its imports and for nothing else, with a reader of
the engine, since no parser of JavaScript becomes a dependency. Record 0079 also says that the markup and the JavaScript
get origins of their own, `parser:markup` and `parser:javascript`, and that the list of origins is closed and kept by
the store as a table, so they come with a store migration and a record.

A Lightning web component (`LightningComponentBundle`) is a folder: a file of metadata, usually a module of JavaScript
of the name of the component, more modules, templates in HTML, style sheets, and files of its tests in a folder
`__tests__`. The snapshot holds every file of it, and no analyser read one until now. The fixture project holds two,
`invoiceSummary` and `invoiceBadge`, and its answer key 12 references of them and two places where none may be reported.
The eight public codebases hold 239 bundles, by the count of the Salesforce library.

The work package is built in four parts. This one, part A, holds the two origins and the Lightning web components. Part
B reads Aura components, part C Visualforce pages, with which `ApexPage` joins the logic tier, and part D callouts and
named credentials. Part B and part C use the reader of markup of this part.

## Decision

1. **Two readers of the engine.** `extraction/javascript.ts` reads what a module imports, and `extraction/markup.ts` the
   elements of a template. Neither is a parser of its language, and neither throws for anything a file can hold:
   - The reader of JavaScript cuts the text into tokens and steps over comments, strings, templates, with the code in
     their `${...}`, and regular expressions, which it tells from a division by the token before the slash. It reads
     `import ... from 'name'`, `import 'name'`, `export ... from 'name'`, also with `* as`, `default as`, names written
     as strings and an export without a semicolon, and no import where `import` or `export` is a property or `import`
     names a method, as `import(rows) { ... }` in a class. `import(...)` and a clause of no form it knows are not read,
     and it says where they start. `export { a, b }` exports what the module declares and imports nothing. A name after
     a `.` is a property, so `a.return / 2` divides. A regular expression that starts a statement after the `)` of an
     `if`, a `for` or a `while`, or after the `}` of a block, is taken for a division: the public codebases hold none,
     and where one is, the reader can stop there, which a warning says, or misread the rest of that line.
   - The reader of markup reads the name and the attributes of each element and the element around it, with values in
     quotes, in braces or bare and attributes without a value, and a tag in any case. It steps over comments, `CDATA`,
     declarations and what a `script` or a `style` holds, opens no element that has no end tag or closes itself, and an
     end tag closes those inside it that were not closed. It reads no expression and no text between the tags. A comment
     ends at `-->`, an instruction such as `<?xml ...?>` at `?>` and a declaration at `>`, as in XML, which Aura
     components and Visualforce pages are written in. HTML ends a few odd forms elsewhere, such as the empty comment
     `<!-->`, which a template has no use for.
   - Where either cannot go on, at a string, a comment, a template, a regular expression or a tag that is not closed, it
     says where it stopped, and what it read before is kept. The analysis makes that the warning `FILE_NOT_READ` of the
     component, with the place, and counts the file among the files of its reader that were not read.
2. **What a module imports.** Each file `.js` of a bundle is read, but those below a folder `__tests__` of the bundle,
   which are not part of the component in the org. With the origin `parser:javascript` and the `via` `import`:
   - `@salesforce/apex/Class.method`, also `ns.Class.method` and `@salesforce/apexContinuation/...`, calls the method of
     that name of the class. A component can import only an `@AuraEnabled` method, so where some methods of the name
     are, only those count. One method is `confirmed`, and each of several is `probable`. A class of the snapshot that
     has no method of the name, a class whose code is not read and a class the snapshot does not hold are called with
     the name of the method in `attrs.method`, as Apex calls into a class whose code is not read (record
     [0089](0089-the-resolver-of-apex-reads-calls.md)). A class of a package is `external`.
   - `@salesforce/schema/Object` refers to the object, and `@salesforce/schema/Object.Field` to the field with the kind
     `references`, since an import serves to read and to write and the JavaScript is not followed. A path across a
     relationship, `Invoice__c.Account__r.Tier__c`, refers to the lookup with the kind `references` too, and to the
     field at its end, as the resolver of names does for any path (`raw-references.ts`). `@salesforce/schema/Object.Id`
     refers to the object, since the field `Id` is no component. A standard name is `external`, and a custom one that
     nothing defines `unresolved`.
   - `@salesforce/label/c.Name` refers to the label `Name`, `@salesforce/label/ns.Name` to `ns__Name`, and
     `@salesforce/customPermission/Name` to the permission. `c/name` refers to the component `name`.
   - `lwc`, `lightning/...`, a module of the same bundle (`./name`), `@salesforce/apex`, which gives `refreshApex`, and
     `@salesforce/client`, `community`, `contentAssetUrl`, `i18n`, `messageChannel`, `resourceUrl`, `site`, `user` and
     `userPermission` give nothing, without a warning. The plan names five of these modules. The other four, and
     `@salesforce/apex` alone, name no component of the logic tier either.
   - Any other module, a name of a module that is not built of names as Salesforce allows them, a name written with an
     escape, an import while the code runs and a clause of no known form are the warning `NAME_NOT_READ`, with the
     place. None is guessed.
3. **What a template holds.** Each file `.html` of a bundle is read, but those below `__tests__`, with the origin
   `parser:markup`:
   - A tag `<c-name>` refers to the component whose name is the rest of the tag in camel case, `c-invoice-badge` to
     `invoiceBadge`, with the `via` `tag`, at the first character after `c-`. A tag is read in lower case, as HTML reads
     it. A tag of another namespace than `c` and `lightning` is `NAME_NOT_READ`: the component it names is not known.
   - The literal `object-api-name` of a base component (`lightning-...`) refers to the object, and the literal
     `field-name` of `lightning-input-field` and `lightning-output-field` to the field of the object of the nearest
     element around it that names one, also across relationships, both `probable` with the `via` `attribute`: the
     template names them as a value that the base component reads. A field whose form names its object in braces, or
     that stands in no form, is of no known object, and leaves the warning `PATH_NOT_FOLLOWED`. A literal object or
     field that is not built like a name is `NAME_NOT_READ`. A value in braces, an expression between the tags, the
     content of a comment and any other attribute give nothing.
4. **Kept and counted.** The references of every file of a bundle belong to the bundle. The work of the analysis has a
   row for each origin, `parser:javascript` and `parser:markup`, always: the components whose files of that language
   were read, and the files that were not read as a whole or not at all. A file that is not text in UTF-8 is the error
   of the reading of files, as for every reader. Migration 14 adds the two origins to the table of the vocabulary with
   the numbers 7 and 8, which follow those of migration 3. The list of origins in `core/references.ts` puts them after
   `parser:apex`, so a number of the store no longer follows the order of the list, which nothing needs.
5. **Not in the answers yet.** As for Apex (record [0084](0084-the-members-of-a-class-are-components.md)), the analysis
   does not list `LightningComponentBundle` among the types it read until the answers take these components in, in work
   package 7. An answer finds a component by its references, and still names the type among those it does not cover. The
   rows of the Dependency API from a component are not compared.
6. **Not done.**
   - The JavaScript is not followed: a value that a module builds and hands to a wire adapter, to `getRecord({ fields
})` or to a base component is not read, and neither is a name in a text, such as a field given as
     `'Invoice__c.Status__c'`.
   - An expression of a template is not read, so the fields of `lightning-record-form` given as `fields={fields}` are
     not, nor `{record.Status__c}`, as record 0079 has it.
   - The file of metadata of a bundle is not read: the objects its targets name (`<objects>` of a `targetConfig`) give
     no reference.
   - A style sheet, a file of data and an SVG of a bundle are not read.

## Consequences

- The fixture project gives the 12 references of its key for its two Lightning web components, each at its place, kind
  and tier, and none at its two forbidden places (`extraction-lightning.test.ts`). With the reader of Apex, the two
  imported methods are `confirmed` calls of `InvoiceController.recentInvoices` and `pay`. The answer key is unchanged.
  An impact answer about `Invoice__c.Amount__c` now holds `invoiceSummary`, as one about `Account.Tier__c` and about
  `Invoice__c` does, and the golden files of those three answers change with it. The test that works out the answer of
  every component from the key alone takes the 12 references in, and passes.
- On the eight public codebases (`extraction-corpora.test.ts`), every module and every template is read to its end, and
  no import and no tag is of a form the reader does not know:

  | Codebase       | Bundles | With JavaScript | With a template | References | Warnings |
  | -------------- | ------: | --------------: | --------------: | ---------: | -------: |
  | Apex Recipes   |       7 |               7 |               6 |         11 |        0 |
  | Coral Cloud    |      15 |              15 |              14 |         31 |        0 |
  | EDA            |      46 |              46 |              46 |        487 |        0 |
  | Nebula Logger  |      11 |              11 |              10 |         49 |        0 |
  | NPSP           |     122 |             122 |             104 |      1,820 |        8 |
  | Outbound Funds |       1 |               1 |               1 |          0 |        0 |
  | PMM            |      37 |              36 |              32 |        377 |        0 |
  | V4S            |       0 |               0 |               0 |          0 |        0 |

  The 8 warnings of NPSP are `PATH_NOT_FOLLOWED` at paths across a relationship of a field of a package that the
  codebase holds no file of, such as `npe03__Recurring_Donation__c.npe03__Contact__r.FirstName`. Of the 2,775
  references, 2 are `probable` calls: NPSP imports a method that has two `@AuraEnabled` overloads. Before the rule of
  `@AuraEnabled` there were 6, of three imports: two of them name a method of which only one overload is. PMM holds a
  folder `lwc/__tests__` of mocks, which the Salesforce library takes for a bundle, and of which nothing is read. 15
  references of NPSP, 22 of Coral Cloud and 10 each of EDA, PMM and Nebula Logger, drawn at random, were checked by hand
  against their code.

- Everything else the analysis gives on the eight codebases, the references, the issues and the rows of work of every
  component that is no Lightning web component, is the same as on `main`. The analysis of NPSP took 8.0 s and that of
  EDA 2.6 s, against 8.7 s and 2.9 s on `main`, each the median of five runs on one machine: the reading of the bundles
  costs less than the noise of the machine.
- Of 110 faults planted one at a time in the new code, the tests catch 109. The one they miss takes away a check that
  another check of the same line already makes, that a method of an inner class is not counted.
- The readers are held by `extraction-javascript.test.ts` and `extraction-markup.test.ts`, and the analysis by small
  components written in `extraction-lightning.test.ts`: every form of a module that is read, that gives nothing and that
  warns, the rule of `@AuraEnabled`, a class without its code, of a package and not there, a path across a relationship,
  a tag, also in upper case, a form around a field at any depth, a form of no known object, a comment, an expression,
  the files of tests, a bundle below a folder of tests, a file of each language that is not UTF-8 and a file that is not
  read to its end. A method named `import` gives no warning. The store test reads a database of schema version 13 and
  writes and reads both origins with both drivers.
- `docs/cli.md`, `packages/cli/schemas/output.schema.json` and the tests of the command line have the two rows of the
  table of origins, and `docs/cli.md` has the issue `FILE_NOT_READ`. The table of origins is wider: its first column
  fits `parser:javascript`. The workspace database moves to schema version 14. An analysis written by an older version
  has neither row and no reference of a Lightning web component until the snapshot is analysed again.
