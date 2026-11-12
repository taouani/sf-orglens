# 0029. The fixture project and its hand-written answer key

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0021](0021-correctness-proof.md) makes a fixture project with a hand-written answer key the first level of the
proof that OrgLens is correct, and the research of Phase 0 found that the cross-checks Salesforce offers may be
weaker than hoped. The key therefore has to stand on its own. It is also the measure of the Apex trial
([0018](0018-apex-analysis-foundation.md)): two parsers are scored against it with fixed pass marks.

A key that is wrong, or that can be read in two ways, makes every later number meaningless. Three questions had to be
settled before the first analyser is written: how a place in a file is named, what exactly counts as a reference, and
how the key is kept in step with the files.

## Decision

**The fixture is written for the purpose.** `fixtures/billing-sfdx` is a small Salesforce project in source format,
with one file for each case an analyser can get wrong. Nothing in it comes from a real org or from another project.
Files that do not compile are kept outside the project, in `fixtures/parser-negative`, so that the project stays
deployable.

**The key is written by hand, in YAML, and never by an analyser.** `fixtures/expected/answer-key.v0.yaml` lists the
components of the project, the expected references, the negatives (places where a reference to a named target must
never be reported) and the unknowns (places where the target cannot be known, and an analyser must say so). The
format is described in [fixtures/README.md](../../fixtures/README.md).

**A place is a line and a word.** An entry names the line and the word the reference stands at, and which
occurrence of the word if the line has several. The column is worked out from the file. Nobody counts columns by
hand, and a wrong place is found by a check, not by a reader.

**References use the engine's own vocabulary.** Both ends are component keys as `buildKey` writes them, the start
at the level of the member (a method, a property, a rule). Kinds and tiers are those of `core/references.ts`. A name
that stands in text is at most `probable`. A reference whose field is decided at run time points at the object and
is `possible`.

**The rules of what is keyed are written down, and within them the key is complete.** The README lists what is
keyed and what is not. Version 0 leaves out the field `Id`, the use of an object as a type, calls between methods and
global variables in formulas. Completeness is what makes precision measurable: a reported reference of a keyed kind
that the key does not have counts as wrong.

**Hard cases are marked, not left out.** A reference that needs more than version 0 of an analyser can be expected
to do, such as a list of field names joined into a query, is marked `stretch`: missing it costs no recall and
finding it costs no precision. The check limits how many entries may carry the mark.

**A check keeps key and project in step.** A test resolves the project with the Salesforce source library and
compares the components, finds every place in the text, and verifies the rules the key sets for itself. It runs on
every system with the other tests and needs no analyser.

**Public codebases are pinned, not copied.** `fixtures/corpora.toml` names three public codebases with their
licence and a full commit id, and a script downloads them into a folder Git ignores. They serve measurements of
robustness and speed. No test depends on them.

## Consequences

- When a line of the fixture moves, the check fails and names the entry. Fixture files are not formatted by
  Prettier and keep LF line endings everywhere.
- The check proves that the key is consistent with the text. It cannot prove that the key is right. That rests on a
  second reading and on review, and on the deployment below.
- The Apex of the fixture has not been compiled by Salesforce when this record is written. The live-org workflow of
  Phase 0 deploys the project. A file that does not compile is corrected, and the key with it.
- The key grows by versions. Flows, custom metadata, components, permissions and calls are added with the phases
  that read them, each as a new version file, so that old scores stay comparable.
- How recall, precision and the accuracy of read and write are computed from the key is fixed with the scoring
  harness of the Apex trial, before either parser is run, and recorded in 0018.
- `@salesforce/source-deploy-retrieve` and `yaml` are development dependencies of the engine. The first becomes a
  runtime dependency with Salesforce connectivity. The second is only used to read the key.
