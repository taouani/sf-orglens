# 0044. An impact answer: what refers to a component, how it is found, and what the answer does not cover

- Status: Accepted
- Date: 2026-11-16
- Decisions: none (work package 7 of the Phase 1 plan. It builds the first half of record 0013, reachability, and
  the command `impact` of record 0016 for one component)

## Context

Record [0013](0013-impact-semantics.md) says that the impact engine first answers by reachability: every
component that depends on the target, with the path of references that explains each one. Record
[0016](0016-commands-config-and-json-contract.md) names the command `impact` and leaves its flags open. Record
[0040](0040-components-and-references-in-the-database.md) holds the components and references of a snapshot
and the interface `SnapshotGraph` that reads them, and record
[0043](0043-a-snapshot-is-analysed-from-its-files.md) fills them.

Work package 7 of the [Phase 1 plan](../plans/phase-1.md) asks for the engine and the command: walk the
references that point at a component to a depth that can be set, give each result the shortest path that
explains it and the weakest confidence on that path, start from an object and everything it contains, and say
what the answer does not cover. It fixes the options of the command and three exit codes. It asks for a time
under 5 seconds on the synthetic orgs, which is the target of record
[0037](0037-performance-targets.md).

Two things were known before the work began. Asking the database one question per component takes 8 to 10
seconds from the most used field of the larger synthetic org (work package 3). And in this phase only objects,
fields and validation rules are analysed, so an answer about a real project misses everything that Apex, flows
and the other types do with a component.

The plan fixes the outline, and the maintainer approved it. The points below are choices of the author, and the
maintainer's to strike. The first one departs from a sentence of the plan and is marked.

## Decision

### The walk

`engines/impact.ts` walks the references of one snapshot, level by level. The first level holds the components
with a reference to the start, the second those with a reference to the first, and so on. Each level is one
question to the store for all its components together.

- **A component is found once**, at the level where it is first met. Its depth is the length of a shortest
  chain of references to the start.
- **Which chain is kept.** Among the shortest chains, the one whose weakest reference is the most certain. Among
  those, the one through the component whose key comes first. Between two references of the same two
  components, the first by file, line, column, kind, origin and resolution. No number of the database plays a
  part, so the same snapshot gives the same answer on every machine and with both drivers.
- **A shorter chain wins over a more certain one.** A result two references away over a `possible` reference
  is shown at depth 2 as `possible`, also when a `confirmed` chain of three references exists.
  `--min-confidence` finds the other chain, because it leaves the uncertain reference out.
- **The confidence of a result** is the weakest confidence on its chain.
- **The start is the component and everything it contains**, at any depth: an object with its fields and
  validation rules. What the start contains is never a result. The answer says how many components that are.
- **A component that is found is followed from itself only**, not from what it contains and not from what
  contains it. If a field refers to the start, the walk goes on with what refers to that field.
- **The depth is not limited by default.** `--depth` limits it, and the answer then says in `beyondDepth`
  whether references lead further. It finds that out by reading one more level.
- **`--min-confidence`** leaves out every reference that is less certain, in the statement that reads the
  references.
- **`--outgoing`** is the same walk in the other direction: what the component refers to, and what those refer
  to. A reference to a name without a key, for which no component stands, is listed in `unresolved`.

### A result holds one reference, not its whole chain

**This departs from the plan**, which says that each result carries the shortest path that explains it.

A result holds `reference`: the reference it is found by. One end of it is the result. The other end is one
reference nearer: a result of the depth before, which holds the next reference, or at depth 1 the start or
something the start contains. Whoever wants the whole chain of a result follows it from result to result. The
answer still holds a shortest chain for every result. It holds each reference of it once.

The reason is a measurement. With every chain written out, an answer grows with the number of results times
their depth. From an ordinary field of the larger synthetic org, without a limit of depth, the answer has
104,760 results up to 21 references away. Written out, that was 1,361,153 references and 443 MB of JSON, which
took 1.9 seconds to turn into text after the walk, and is close to the longest text Node.js can hold. With one
reference per result, the size grows with the number of results alone.

The text output shows the same thing: one line per result with the reference it is found by.

What this costs: a program that wants the chain of a result has to look up keys among the results. Written
out per result, a chain could be read without that.

### Naming the component

`findComponent` takes a key, a type and a name (`CustomField:Account.Industry`) or a name alone
(`Account.Industry`). Case plays no part. A name alone is looked up in every type of the snapshot and every
type the engine knows. A name that fits components of several types is the error `COMPONENT_AMBIGUOUS` with
the keys in `details.candidates`: the engine does not choose. A name that fits none is `COMPONENT_NOT_FOUND`.
Both end with the exit code `2`.

A snapshot knows a component it does not hold when something in it refers to it, such as a standard field.
Such a component can be asked about and can be a result, with `name` and `file` being `null`.

### What the answer does not cover

Every answer carries `notCovered`, with four parts:

- `notAnalysed`: the types of the snapshot that no analyser read, with what the source lists and the snapshot
  holds of each. **Every type that is not analysed counts**, whatever the component is. The plan says "the
  types that are not analysed and can refer to the target". Which type can refer to which is not written down
  anywhere yet, and leaving a type out by a guess would make an answer look more complete than it is. Work
  package 9, which judges completeness per tier, can narrow this.
- `partial`: the analysed types of which the snapshot holds less than the source lists, or whose listing
  failed.
- `readErrors`: the errors of the reading that name no type, such as a folder that could not be read.
- `analysisErrors`: the errors of the analysis.

Whether a type is analysed is read from the snapshot, from the count of analysed components per type, not from
the version of the engine that answers.

Two flags are made from it:

- `complete` is true only if all four parts are empty or zero.
- `mayMiss` is true if the answer may miss something of a type it covers: `partial` is not empty, or one of the
  two counts is not zero. A type that is not analysed yet does not make it true.

For `--outgoing`, a type that is not analysed counts only if the component or a result is of it. What a
component refers to is known once the component itself is analysed.

The text output says in its first lines whether the answer is complete, before the first result, and lists the
details below the results.

### The command, its exit codes and its errors

`orglens impact <component> [--source <name>] [--snapshot <n>] [--depth <n>] [--min-confidence <tier>]
[--outgoing]` joins the commands. It reads only.

- `--source` can be left out in a workspace with exactly one declared source. With none or several, the
  command line is refused and the message lists the sources.
- Exit code `0` for an answer, `5` if `mayMiss` is true, `2` for a component that is not found or a name that
  fits several. An answer that is not complete only because types are not analysed yet ends with `0`, as the
  plan says.
- A snapshot without an analysis is the new error `SNAPSHOT_NOT_ANALYSED`, with the exit code `1` and a hint
  that names `orglens analyse`. A snapshot that has not ended or was given up is `SNAPSHOT_NOT_FOUND`, as for
  `analyse`.
- `Workspace.impact` and the types of the answer join the API of the engine.

### How the store is read

`SnapshotGraph` gets five members for a walk: `below`, `components`, `linksTo`, `linksFrom` and `edges`. A
level reads, for all its components at once, only the two ends, the confidence and the row of every
reference. That decides what is found and how certain the way to it is. The rest of a reference is read at
the end, for the references that are kept, and for those between which only the place can choose.

The statements for many components take the ids as one JSON list and hand their rows back as one JSON text.
Handing out one row per reference through the driver cost more than everything else in the walk. Ids go into
a statement 2,000 at a time. The table order of each statement is fixed, and a test reads the query plan of
every statement: none walks a table.

## Consequences

- The answers for the fixture project are held against the answer key: a test works out, from the key alone,
  what refers to each of 96 components at which depth and with which confidence, and compares. Every reference
  of every chain is one the key holds, at the place the key gives it. Six answers are golden files.
- The time, on one Linux machine with the file in the cache of the system, for the walk and the answer in a
  database that was just opened, three runs with the default driver. At the size of Phase 0 (147,323
  components, 602,458 references): 8 to 12 milliseconds from an ordinary field to a depth of five (57
  results), and 0.9 to 1.1 seconds for each of the three large answers, which have 52,340 to 58,189 results.
  At twice that size, which the plan reads as the size of the targets: 8 to 9 milliseconds (76 results), and
  2.2 to 2.8 seconds for the large answers, which have 104,760 to 116,100 results and are 56 to 62 MB as JSON.
  Answering and turning the answer into JSON text took 2.5 to 3.0 seconds there. The target of 5 seconds is
  met in the cases that were measured. Starting Node.js, loading
  the engine and printing the answer are not in these times. Nothing was measured with a cold file cache, on
  Windows or macOS, or on a real org. [store-benchmark.md](../research/phase-1/store-benchmark.md) has the
  table.
- An index of the references in memory, which Phase 0 measured as the fastest way, was not built. The walk
  through the store meets the target as it was read, and holds nothing between two questions. If the target
  size is ten times the org of Phase 0, which is still open with the maintainer, this has to be measured
  again: that size was not run.
- An answer holds references, not consequences. It does not say what breaks when a field is deleted or its
  type changes. That is the second half of record 0013, and a later phase. The first line of the text output
  says "What refers to", not "What breaks".
- In this phase `complete` is false for every project that holds a type other than objects, fields and
  validation rules, which is every real one. The exit code stays `0` for that, so a script cannot tell from the
  exit code that Apex was not looked at. It can tell from `complete` and `notCovered`.
- One line of the answer shows one reference of a component to its target. Other places in the same component
  that name the same target are not listed. `coverage` and the database have them, and no command shows them
  yet.
- A found component is not followed from what contains it. When methods of Apex classes become components, a
  reference from a method leads on from that method and not from its class. Whether that is what a user
  expects is to be looked at again with Phase 3.
- An answer can have tens of thousands of results. No option limits their number, and the text output prints
  every line.
- A read error of the kind `RETRIEVE_FAILED` or `RESOLVE_FAILED` names no type, so it makes `mayMiss` true
  also when what failed was of a type that is not analysed. That errs on the side of the exit code `5`.
- Not verified: the command was not run on a snapshot of a real org. `orglens impact` on a snapshot that was
  never analysed is tested through the engine, with its code, message and hint, and not through the command
  line: `snapshot` always analyses, so a test of the command line cannot make such a snapshot without writing
  to the database itself.
