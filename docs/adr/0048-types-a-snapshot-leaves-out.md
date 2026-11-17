# 0048. A key in `orglens.toml` leaves metadata types out of a snapshot of an org

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (work package 9 of the Phase 1 plan. It builds the key that the plan proposes and record 0038
  leaves undecided)

## Context

A snapshot of an org reads every type the org lists (record [0038](0038-a-snapshot-reads-every-type.md)). A large
org can hold tens of thousands of reports, and nothing was measured for such an org: not how long its snapshot
takes, and not how large its database gets. Reports are listed folder by folder, so the listing alone is one
request per folder.

Record 0038 says: "Whether `orglens.toml` gets a key to leave types out is not decided." The
[Phase 1 plan](../plans/phase-1.md) proposes one in its work package 9, for types that are not of the logic tier,
as a proposal the maintainer can strike. The plan sets three conditions if the key is kept: a type it leaves out
is not retrieved, it is named in `coverage` as not read, and a type of the logic tier in the key is an error.

**What this record rests on.** The maintainer was asked on 17 November 2026 whether to keep the key, with the
recommendation to keep it. The question was "Keep the orglens.toml key that leaves types out of an org
snapshot?", and the maintainer chose the option "Keep the key" on the same day. The key was built as proposed
while the question was open, and the pull request that builds it was merged after the answer.

The answer is to that question. The choices listed under "What goes further than the plan" were not put to the
maintainer one by one, and stay the maintainer's to strike.

## Decision

### The key

A source of the kind `org` or `sandbox` can have the key `exclude_types`: a list of names of metadata types, as
the Metadata API writes them.

```toml
[sources.prod]
kind = "org"
exclude_types = ["Report", "Dashboard"]
```

- A name has letters and digits only and is in the list once. Anything else is an error of the file.
- **A type of the logic tier in the list is an error of the file** (record
  [0046](0046-complete-over-the-logic-tier.md) has the list). The file is refused before anything is read, like
  every other error in it. A snapshot is judged by the tier, so a type of it cannot be left out and the snapshot
  still be called complete.
- A source of the kind `git` has no such key. Its folders say what is read.
- `orglens source add` has no option for it. The key is written by hand.

### What a snapshot does with it

- **A type that is left out is not listed and not retrieved.** The org is asked neither for its components nor
  for those of its folders. The inventory holds the type without components, with the listing `excluded`.
- **Only a type that is retrieved by its own name can be left out.** Its parts and its folders go with it: with
  `Report` the type of its folders, with `SharingRules` the types of the rules in it.
- **A name that cannot be left out is read, with a warning.** Whether an org has a type of a name is known only
  once the org has described its types, so these are not errors of the file. The warning `TYPE_NOT_EXCLUDED`
  says which of four reasons holds: the org describes no type of the name (`unknown`), the type is a part of
  another and comes with it (`part`), it holds the folders of another (`folder`), or one of its parts is of the
  logic tier (`logic-part`). No type of Salesforce is known to be of the last kind. The rule is there so that a
  change of the tier or of the Metadata API cannot take a part of the tier out of a snapshot without a word.
- **A part or a folder type that is named beside its owner goes with the owner.** With `Report` and
  `ReportFolder` in the list both are left out, and no warning is written.
- **The reading of the org refuses a type of the tier a second time.** The file is refused for such a name. The
  code that asks the org what it holds does not rest on that: it reads the type and gives the reason `logic`.
  No snapshot shows it, because none is started with such a file. A test of that code does.
- **The list is read when a snapshot starts.** A snapshot that is continued keeps the inventory it started
  with, whatever the file says by then.
- **Leaving a type out does not make a snapshot partial**, and is no warning. The note `TYPES_EXCLUDED` names
  every type that was left out, with the parts and folders that went with it. It says that the org was not asked
  for their components. It does not say that the snapshot holds none: if Salesforce handed out a component of
  such a type with another one, it would be kept and named as not listed. No type is known to do that.

### What the reports say

- The coverage of the snapshot has a line for each type that was left out, with the listing `excluded`, zero
  listed and zero retrieved, and a note that names the type of the key. The text of `coverage` says `left out`
  in the column `LISTED`.
- An impact answer names such a type in `notCovered.notAnalysed`, like any other type no analyser has read. If
  the analysis reads a type that was left out, the type is in `notCovered.partial`, and the answer says that it
  may miss something. That cannot happen today: every analysed type is of the logic tier.
- The JSON output of `status`, `source add` and `source list` has the list of a source as `excludeTypes`. The
  text of these commands does not show it.

### The database

The coverage of a type gets a fourth value for its listing, `excluded`. SQLite cannot change the check of a
column, so migration 7 builds the table `snapshot_type_coverage` again with the rows it holds. No other table
refers to it. The database moves to schema version 7.

## What goes further than the plan

These are choices of the author of this record. The maintainer can strike any of them.

1. **The name of the key**, `exclude_types`, and that it is a key of the source and not of the workspace.
2. **A left-out type is not listed at all.** The other way, which record 0038 names, lists the type and counts
   it in the column `LISTED` without retrieving it. Listing reports is one request per folder, which is a part
   of the cost the key is there to save, and a count of components that were never read invites the reading
   that they were.
3. **The parts and folders of a type go with it**, and a part or a folder type cannot be named alone.
4. **A name the org does not know is a warning, not an error.** A mistyped name then costs time and loses
   nothing: the type is read.
5. **A value of its own for the listing, and a migration for it.** The other way was a note on a row with the
   listing `ok`, which an impact answer would not have named.
6. **No option of the command line** for the key.

## Not done

- Leaving out the components of managed packages, which the maintainer names as the goal (record 0038). The key
  works by type. How packages are left out is put to the maintainer when Phase 2 is planned.
- Leaving out single components, folders or name patterns.
- A snapshot of a Git source has no such key.
- Nothing of this was run against a real org. How much time the key saves on an org with many reports was not
  measured.

## Consequences

- The workspace database moves to schema version 7. `orglens analyse` or `orglens snapshot` migrates a database
  of an earlier version, with the coverage of its snapshots as it was.
- Two snapshots of one source can differ in the types they hold because the file changed between them. A
  comparison of two snapshots has to take the types that either left out as not compared. That is for the phase
  that builds the comparison, and the coverage of each snapshot holds what it needs.
- A reference to a component of a type that was left out keeps the name it was written with and is not
  resolved, as record 0038 asks: the target is named and never dropped. No analysed type refers to a type
  outside the logic tier today, so no test shows it.
- The cross-check with the Dependency API still asks for the rows of every type. A row from a component of a
  type that was left out is counted with the rows of the types that are not analysed, as before. A row from an
  analysed component to a component of such a type would be counted as not matched. No test shows either.
- **Leaving a type out can turn the reading of the Dependency API from `whole` to `partial`.** A type with more
  rows than one answer holds is asked for per component, with the ids the org listed. A type that was left out
  has no ids, so its rows stay cut off, and the snapshot gets the warning `CROSS_CHECK_PARTIAL`. The rows that
  are missing are from a type that is not compared, so the warning says more than is at stake. Keeping such a
  type out of the reading, or out of the warning, is not built. No test shows the case.
- The JSON output changes in three places: `listing` can be `excluded`, a source of the kind `org` or `sandbox`
  has `excludeTypes`, and two issue codes are new.
