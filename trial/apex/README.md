# The Apex trial

This folder holds the trial of work package 9 of the [Phase 0 plan](../../docs/plans/phase-0.md): which parser
OrgLens builds its Apex analysis on. It is not part of the engine and is not shipped. The results are in
[docs/research/phase-0/apex-trial.md](../../docs/research/phase-0/apex-trial.md), the decision in record
[0018](../../docs/adr/0018-apex-analysis-foundation.md).

## What is here

| File                                                       | What it is                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/syntax.ts`                                            | The syntax of Apex as the resolver sees it, and the interface a parser has to offer.        |
| `src/adapters/apex-parser.ts`                              | Candidate A: `@apexdevtools/apex-parser` 5.3.0, lowered into that model.                    |
| `src/adapters/tree-sitter.ts`                              | Candidate B: `web-tree-sitter-sfapex` 3.0.2, lowered into that model.                       |
| `src/schema.ts`                                            | The custom objects and fields of a project, read from its `objects` folders.                |
| `src/resolver.ts`                                          | The resolver, written once: scopes, types, reads and writes, queries, names in text, calls. |
| `src/score.ts`                                             | The score of a run against the answer key of the fixture project.                           |
| `src/syntax-probes.ts`                                     | 48 pieces of Apex with recent or uncommon syntax.                                           |
| `src/project.ts`                                           | Reads the `.cls` and `.trigger` files under a folder.                                       |
| `src/run-fixture.ts`, `src/run-corpus.ts`, `src/sample.ts` | The commands below.                                                                         |
| `src/run-recovery.ts`                                      | Damages real files and counts what each parser still delivers.                              |
| `test/trial.test.ts`                                       | The trial as tests. They run with `pnpm run test`.                                          |

## Commands

Node.js runs the TypeScript files as they are. From the root of the repository:

```sh
# The score of one parser on the fixture project, with every difference named.
node trial/apex/src/run-fixture.ts apex-parser
node trial/apex/src/run-fixture.ts tree-sitter

# One parser on a codebase: time, peak memory in MiB, counts. One process per run, with one parser loaded. The
# third argument is optional and names a file for everything that was found.
pnpm run corpora:fetch
node trial/apex/src/run-corpus.ts tree-sitter .corpora/npsp /tmp/npsp-tree-sitter.json

# apex-parser with a smaller heap, and with its cache emptied after every 50 files.
node --max-old-space-size=1024 trial/apex/src/run-corpus.ts apex-parser .corpora/npsp
ORGLENS_TRIAL_EMPTY_CACHE=50 node trial/apex/src/run-corpus.ts apex-parser .corpora/npsp

# Both parsers on damaged files: 200 files of a codebase, each damaged in five ways, with the seed 1.
node trial/apex/src/run-recovery.ts .corpora/npsp 200 1

# A sample of the references of such a file, each with its line of source, for a check by hand.
node trial/apex/src/sample.ts /tmp/apex-recipes-tree-sitter.json .corpora/apex-recipes 100 2026
```

## Limits

- The resolver is a spike. It was written with the fixture project and its answer key in view, by the author of
  both. The score on the fixture says that the design can express what the key asks for. It is not a measure of
  how well the resolver does on code it has not seen. The runs on the public codebases and the check by hand are
  the closer measure, and they are described in the results.
- Standard objects and standard fields are known by rule, not from a list (`src/schema.ts`). No field name is
  checked against the fields a project defines. A field that does not exist is reported like one that does, at
  the tier `confirmed`. A child relationship of a standard object, such as `Contacts`, is taken for a field.
- A method is found by its name and the number of its arguments, not by the types of its arguments.
- The value of a text is followed inside one method and through constants. It is not followed through a
  parameter, a return value or a field that is set in more than one place, and a text that is put together in
  steps is read as far as its constant parts go. What is lost that way is lost without a word.
- No file of the trial is covered by the coverage gate of the repository, and none is checked by
  dependency-cruiser.
