# 0083. The engine parses Apex with `web-tree-sitter-sfapex` and loads its grammar only for Apex

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (it builds record 0018 in work package 2 of the Phase 3 plan, with the choices of the author,
  which the maintainer can strike)
- Changed by: [0084](0084-the-members-of-a-class-are-components.md), in points 6 and 7: a class whose code is `(hidden)` has the warning `APEX_NO_CODE`, and the analysis has the row `parser:apex` but does not list `ApexClass` and `ApexTrigger` as read while it reads them in part

## Context

Record [0018](0018-apex-analysis-foundation.md) chose `web-tree-sitter-sfapex` after the Apex trial of Phase 0 and
said that it joins the engine in Phase 3. Work package 2 of the [Phase 3 plan](../plans/phase-3.md) builds that:
the parser as a dependency of the engine, the model of the syntax, the reader that lowers the tree of the parser
into it, the second adapter as code of the tests, the loading of the grammar, and an error for a file that does
not parse. Nothing of what a class refers to is read yet. That starts with work package 3.

Risk 9 of the plan names what makes this more than an import. The parser is WebAssembly: its grammar is loaded
with one `await`, and every tree it builds must be freed by hand. `analyseSource` is synchronous, and a command
such as `impact` or `--version` should not start slower because the engine can parse Apex.

The model of the trial (`trial/apex/src/syntax.ts`) lacks three things that its list "What the resolver does not
do" names: the interfaces a class implements, the interfaces an interface extends, and the values of a `when`.

## Decision

1. **Dependencies.** `web-tree-sitter-sfapex` 3.0.2 and `web-tree-sitter` 0.27.2 are runtime dependencies of the
   engine, pinned to the versions of the trial. Both are under the MIT licence. The first holds the grammar as a
   WebAssembly file and depends on the second at the same version. The engine names the second too, because it
   imports its types (`Node`, `Parser`), and they must be those of the version the grammar is built for.
   `@apexdevtools/apex-parser` 5.3.0 (BSD-3-Clause, with `antlr4`) is a development dependency of the engine.
2. **The model.** `extraction/apex-syntax.ts` is the model of the trial with what its list found missing: `extends`
   is a list (the class a class extends, or the interfaces an interface extends), `implements` is a list, and a
   `when` has its values as expressions beside the type it binds. `when else` has neither. The model also says
   what a reader of Apex offers (`ApexReader`): its name, `parseUnit` for a file and `parseQuery` for the text of a
   query. Neither throws because of the text it is given, and neither keeps anything of it. A problem says where
   the parser gave up and what it expected, never the text of the source, and the problems of a file are in the
   order of the text.
3. **The reader.** `extraction/apex-reader.ts` is the adapter of the trial on the corrected model. A column counts
   UTF-16 units, also behind a character of two units, and a file that starts with a byte order mark has the places
   of the text without it. Every tree is freed when its file is read, also when lowering it fails. The grammar reads
   anonymous Apex and several declarations in one file, which Salesforce deploys neither of: a file that holds
   something beside the one class, interface, enum or trigger it declares has a problem at the first such thing.
   The text of a query that closes the class it is read in is not one query. An operator is kept without white
   space, since the grammars read `a > = 0` as `a >= 0`. What throws while a file is lowered is a fault of the
   reader: the analysis reports it as `ANALYSIS_FAILED`, as for any analyser, and not as a file that does not
   parse.
4. **Loading.** `loadApexReader` imports the package with `import()` and loads the grammar once in a process. The
   analysis of a snapshot (`api/analysis.ts`) asks for it only when the snapshot holds a class or a trigger
   (`readsApex`), before `analyseSource`, which stays synchronous and takes the reader as an option. No other
   command loads it, and a snapshot without Apex does not either. A load that fails makes the analysis fail with
   `INTERNAL`, whose hint says that the installation may be incomplete. Its message holds the message of the
   failure, cut and masked. The snapshot is stored before it is analysed (record
   [0043](0043-a-snapshot-is-analysed-from-its-files.md)), so it is kept, and the next analysis tries the load
   again. Where the module of the package itself fails when it is evaluated, Node.js keeps that failure for the
   process, and only a new process tries again.
5. **A file that does not parse.** It is the error `APEX_MALFORMED` of the analysis, of the class or trigger it
   belongs to, with the file, the line and the column of the first problem in `details`. The component keeps its
   row and costs only itself. The analysis is incomplete, so `snapshot` ends with `5`. A file that is not text in
   UTF-8 is the same error, without a place. An error of the analysis counts for every impact answer about the
   snapshot (`mayMiss`, the exit code `5`), so until work package 3 reads classes such an answer ends with `5` too,
   though nothing of Apex is read yet. From work package 3 on that is right: the references of the class are
   missing then. I did not add a rule for the time between the two.
6. **Code that Salesforce hides.** A file whose text is only `(hidden)` is not parsed and gives no issue. That is
   the text an org is said to hand out for a class of a managed package. Nothing of a class is read in this work
   package, so nothing is missed by it. The warning that says that the code of such a class was not read comes with
   work package 3, which reads classes. A warning now would bear on every impact answer about what refers to a
   component (record [0074](0074-a-warning-counts-where-it-can-bear-on-the-answer.md)) while no Apex is read at
   all.
7. **Nothing is recorded yet.** `ApexClass` and `ApexTrigger` stay types that are not analysed, and the analysis has
   no row of the origin `parser:apex`. Both come with work package 3.
8. **The second parser.** The adapter of `@apexdevtools/apex-parser` is ported to the model of the engine as code
   of the tests (`test/helpers/apex-parser-adapter.ts`), with the three things the model gained. It keeps the same
   contract: its problems do not quote the source, as those of ANTLR do, and it keeps nothing of a text.
   `extraction-apex-adapters.test.ts` holds the two readers against each other on the 30 files of Apex of the
   fixture project, on the 48 pieces of recent syntax and on six more cases, name by name and place by place, and
   shows that both say where they cannot read a file without quoting it.
   No code of the engine imports `@apexdevtools/apex-parser`: it joins the packages that the code of the engine
   must never import (`layers.cjs`), and the rule of dependency-cruiser for them is now
   `engine-reads-with-its-own-readers`. The three packages of parsers join those a client must never import.
   dependency-cruiser did not see an import of a package whose entry point lies in a folder `dist/`, as that of
   `@apexdevtools/apex-parser` does, because it left out every path with `/dist/` or `/test/` in it. It now leaves
   out only those folders of the packages of this repository. The probes of `pnpm run check:boundaries` found it.
9. **The trial** stays as it was scored. Its tests run with the others.

## Consequences

- An installed OrgLens is larger by the two packages, about 6.5 MB on disk, of which the grammar is 1.6 MB and the
  source maps of `web-tree-sitter` 1.2 MB.
- `pnpm run check:startup` holds its budget: no command loads the grammar before it analyses a snapshot that holds
  Apex. `snapshot-apex.test.ts` shows that a snapshot without Apex and the commands that read it do not load it,
  that a load that fails is tried again, and that a second snapshot in the same process does not load it again.
- The smoke test of the package snapshots the fixture project and then the project with a class that does not
  parse, with the installed binary, on Linux, macOS and Windows. The grammar is a file next to the code of the
  package, which it finds by `import.meta.url`. A bundler that moves the code would break that. OrgLens is not
  bundled.
- Every class and trigger of the package folders of the eight public codebases parses: 2,074 classes and 81
  triggers (`extraction-corpora.test.ts`). 13 files of Apex outside the package folders do not, and no snapshot
  reads them: 8 scripts of anonymous Apex, which declare no class, and 5 classes of EDA that hold the token
  `%%%NAMESPACE_DOT%%%` of its build tool. Parsing every class of NPSP took about 2.4 seconds on the machine of
  the author, and of EDA about 1.5 seconds. On the 2,328 files of Apex of the codebases, in their package folders
  and outside them, that both readers read without a problem, the two give the same model. A script measured that
  for the review of this work package. No test holds it.
- A snapshot of a repository with a class that does not parse now ends with `5` where it ended with `0`. The JSON
  output keeps its shape: `APEX_MALFORMED` is a new code, and the schema says that codes can be added.
- A grammar that lags a release of Salesforce makes a class that uses the new syntax `APEX_MALFORMED`. The 48
  pieces of recent syntax are a test, and the second reader stays a way out by one import.
- Not verified: that an org hands out the code of a class of a managed package as `(hidden)` and in no other form.
  Work package 3, which gives such a class a warning, has to find out.
