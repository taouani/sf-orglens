# sf-orglens

## 0.1.0-next.1

The second pre-release. It changes nothing in what OrgLens does. Why it exists is in its
[release notes](https://github.com/taouani/sf-orglens/blob/main/docs/releases/v0.1.0-next.1.md).

### Patch Changes

- No command, no output and no exit code has changed since `0.1.0-next.0`: the code of both packages is the same,
  and only the version they name is new. This version exists to publish once without a token. The first
  pre-release was published with a token of the maintainer, because a package has settings on npm only once it
  exists. Every version after it is published through a trusted publisher of npm, which takes a version only from
  the workflow "Pre-release" of this repository in its environment `npm-next`. That way had not been tried, and
  npm keeps a new trusted publisher only when a version is published through it within two days.

  One thing follows from the new version alone: a snapshot of an org that was interrupted under `0.1.0-next.0` is
  not continued by this version. It is given up, and `orglens snapshot` begins a new one.

- Updated dependencies
  - @sf-orglens/engine@0.1.0-next.1

## 0.1.0-next.0

The first pre-release, on npm under the tag `next` and on GitHub. What this version does as a whole, what it
does not do and what is not verified is in its
[release notes](https://github.com/taouani/sf-orglens/blob/main/docs/releases/v0.1.0-next.0.md).

The entries are in the order in which their pull requests were merged, under each heading, and each says what
was true on that day. Where one says that something is not available yet, or was not run against a real org, a
later one may say otherwise.

### Minor Changes

- 0b2c27d: Add the workspace and the first commands. `orglens init` creates a workspace, `orglens source add|list|remove`
  declare orgs, sandboxes and repository folders in `orglens.toml`, `orglens status` shows the workspace and its
  database, and `orglens doctor` checks that OrgLens can run. Every command takes `--json` and writes one envelope,
  described by a JSON Schema that ships with the package, and ends with one of six documented exit codes.
- 897aa4c: Add snapshots of repository folders. `orglens snapshot <source>` reads a source of the kind `git`, from disk or
  from a commit, and stores its metadata files in the workspace database. `orglens coverage <source>` shows what a
  snapshot holds per metadata type and what was left out or went wrong. A snapshot that is missing something is
  stored as partial, and `snapshot` then ends with the exit code `5`. Reading a commit needs Git 2.30 or newer.
  Reading folders from disk needs no Git. Snapshots of orgs and sandboxes are not available yet.
- 795f833: Add logins. A source of the kind `org` or `sandbox` is logged in with a login of the Salesforce CLI: the one that
  `orglens source link <name> <login>` sets in the personal file, or the one login that belongs to the org the
  source declares. A job without a person logs in with a key from the variables `ORGLENS_JWT_<SOURCE>_…`, and no
  login file is written. `orglens source check <name>` connects and says which org answered, by which login and with
  which API version, and for a source of the kind `git` it reads everything a snapshot would read. Both store
  nothing. A login that fails, or that belongs to another org than the declared one, ends with the exit code `4`.
  `doctor` now also checks Git and says how each org would be logged in. Snapshots of orgs and sandboxes are not
  available yet.
- e9a44e9: Add snapshots of orgs and sandboxes. `orglens snapshot <source>` now reads a source of the kind `org` or
  `sandbox`: it asks the org which metadata it holds, retrieves every component by name in chunks, and stores the
  files in the form a repository holds them. Progress goes to the standard error stream. A snapshot that is
  interrupted is continued by the next run, and `--restart` takes a new one. What the org listed and did not hand
  out, and every type it refused to list, makes the snapshot partial and is named in `coverage`. `status` shows a
  snapshot that has not ended. Profiles and permission sets are read incompletely, and a warning says so. An issue
  about a refusal of Salesforce carries its code in `details.code`. OrgLens reads only metadata and makes no request
  for a record. When the Salesforce library renews an expired session, it asks the org about the org itself, as
  before. This has been tested against a mock org, not yet against Salesforce itself. The workspace database moves
  to schema version 2.
- b1a459b: The workspace database gets tables for components and references, and is now at schema version 3. A command
  that writes to the workspace updates an older database when it opens it, and an older version of OrgLens then
  refuses that database. No command fills the new tables yet: a snapshot is still read and not analysed.
- 258f13b: A snapshot is now analysed. `orglens snapshot` analyses the files it stored: the objects, fields and validation
  rules, with the names written in their XML and in their formulas. The new command `orglens analyse <source>`
  analyses a stored snapshot again from the files it holds, without reading the source, and migrates a database
  that an older version wrote. `coverage` shows per metadata type how many components were analysed, and per
  origin how many references were found, how many are not resolved, and how many paths were not followed.
  `status` says whether the latest snapshot of a source is analysed. `snapshot` and `analyse` end with the exit
  code 5 when the snapshot is partial or its analysis is incomplete. In the JSON output, the report of a snapshot
  gets `analysis`, every issue gets `stage` and `component`, and `status` gets `latestSnapshot.analysis`. A Git
  source is now read with the layout of files that its own `sfdx-project.json` asks for, also with `paths` and
  from the commit of a `ref`, and no longer with the project of the folder the command runs in. The snapshot keeps
  that layout, in schema version 4 of the database, and is always analysed with it. No command answers an impact
  question yet, and no snapshot of a real org was analysed.
- 69c7957: The first impact answers. The new command `orglens impact <component>` shows what refers to a component in a
  snapshot, directly or through other components: each result with its depth, the reference it is found by with
  file and line, and the weakest confidence on its chain. For an object, the answer is about everything it
  contains too. `--depth` limits how far the answer goes, `--min-confidence` leaves uncertain references out,
  `--outgoing` shows what the component refers to, and `--snapshot` asks an older snapshot. A component is named
  by its name, by its type and name, or by its key. Every answer says what it does not cover: the types of the
  snapshot that are not analysed yet, the analysed types of which the snapshot holds less than the source has,
  the errors of the reading and of the analysis, the warnings of the analysis, and for `--outgoing` the
  components the snapshot does not hold. In this pre-release only objects, fields and validation rules are
  analysed, so an answer about what refers to a component of a real project is not complete and says so in its
  first lines. The exit code is 5 when the answer may miss something of a type it covers, and 2 for a name that
  fits no component or several. The engine gets `Workspace.impact` and the error codes `SNAPSHOT_NOT_ANALYSED`,
  `COMPONENT_NOT_FOUND` and `COMPONENT_AMBIGUOUS`. An analysis now records the types it read, and the workspace
  database moves to schema version 5: `orglens analyse` or `orglens snapshot` migrates a database of an earlier
  version, and `impact` ends with `STORE_OUTDATED` until then. No snapshot of a real org was asked.
- 9aadacb: A snapshot of an org is now cross-checked. `orglens snapshot` of an org or a sandbox asks the Dependency API of
  Salesforce which component refers to which, keeps the rows with the snapshot, and holds them against what the
  analysis found. `coverage` shows the result: how many rows Salesforce reports, how many are from a type this version
  does not analyse and are not compared, how many pairs of components the analysis has as well, and the pairs it
  missed: the first 20 in text, all of them with `--json`. A reference that Salesforce reports and the analysis did
  not find is the new issue `REFERENCE_MISSED` of the analysis, with the severity `error`: the analysis is incomplete,
  `snapshot` and `analyse` end with the exit code 5, and an impact answer from that snapshot says that it may miss
  something. A reference that only the analysis has is no error. It is listed where the API is known to report that
  kind, and counted by its reason where it is not, such as a standard field or a lookup. The rows are a second opinion
  and never part of an answer: `impact` shows no row of Salesforce. `orglens analyse` compares again from the rows a
  snapshot holds, without asking the org. The reading never fails a snapshot: an org that does not answer leaves the
  warning `CROSS_CHECK_NOT_READ`, and rows that are missing because a query was cut off or failed, or that may be
  missing because the org holds more components of a type than one query can name, leave `CROSS_CHECK_PARTIAL`. The
  reading stops after 2,000 requests. `--no-cross-check` leaves the API unasked. The engine gets
  `CoverageReport.crossCheck` and the option `crossCheck` of `Workspace.snapshot`, and the JSON output of `snapshot`,
  `analyse` and `coverage` gets the field `crossCheck`. The workspace database moves to schema version 6: `orglens
analyse` or `orglens snapshot` migrates a database of an earlier version, and `coverage` and `impact` end with
  `STORE_OUTDATED` until then. Only metadata is read: one object of the Tooling API is queried,
  `MetadataComponentDependency`. The cross-check was not run against a real org when this was written.
- 64714df: A snapshot of an org is now judged over the logic tier: 21 metadata types, listed in `docs/cli.md`. What the org
  listed and did not hand out, a listing it refused, a retrieve that failed and a file that cannot be read as
  metadata make the snapshot `partial` only for a type of that tier. For any other type the same issue is a
  warning, the snapshot is `complete`, and `snapshot` ends with `0` where it ended with `5`. The first line of the
  report then says "is complete for the logic tier" and that something of other types is missing, and each of the
  four issues carries `details.tier`. The file of custom labels is not missing when the org lists no label.
  `impact` ends with `0` where it ended with `5` for a snapshot in which a file or a retrieve outside the tier
  failed: the answer does not cover that type and names it in `notCovered.notAnalysed`. A snapshot of a repository
  is not changed. The judgement was seen on one real org, where 209 components of 10 types outside the tier are
  warnings. The commands were not run against a real org, so their lines and exit codes are shown by tests only.
- 801bf9c: A snapshot of an org takes the word of the org in two places where the Salesforce library falls short. A file
  that comes back in a folder the library knows no type for is counted by the type the org describes with that
  folder, so a type the library does not know yet no longer makes every snapshot `partial`. A component of a package
  that comes back under its name without the prefix of the package counts as the component the org listed, when the
  retrieve asked for the listed name and not for the short one and Salesforce did not remark that it cannot find
  it. The note `RETRIEVED_WITHOUT_PREFIX` says so. Both were seen on one real org: three files of a type the
  library does not know became warnings, and seven bundles of a package count as retrieved.
- bdbac40: A source of the kind `org` or `sandbox` can leave metadata types out of its snapshots with the new key
  `exclude_types` in `orglens.toml`, for an org with very many components of a type nobody asks about, such as
  reports. The org is not asked for such a type, and nothing of it is read. The report of the snapshot shows the type
  as `left out`, and an impact answer names it among the types it does not cover. A type of the logic tier cannot be
  left out. The workspace database moves to schema version 7, and `orglens snapshot` or `orglens analyse` migrates an
  earlier one. Not verified on a real org.
- 79cf9d0: A snapshot of an org asks for a part by its own name when Salesforce cannot find what the part belongs to. The
  org can list a field or a record type of an object that it does not list and that Salesforce cannot find in a
  retrieve. Such parts were never asked for and counted as missing. Now they are asked for by their own names in
  one more retrieve, and the note `PARTS_ASKED_BY_NAME` says so. On the one real org this was run against,
  Salesforce could not find the parts by their own names either, and they stayed missing. A real org that hands
  such a part out was not seen.

### Patch Changes

- 20c5f72: On Windows, a command that reads or changes a configuration file tries again for up to a third of a second when
  another program has the file open at that moment, before it fails with `WORKSPACE_IO`. One run of the tests on
  Windows had failed in `orglens source add` for that reason.
- 70daa9d: A command that changes a configuration file while another one does waits longer for it. It gave up after two
  seconds in all. Now it gives up when the command in front has held the lock for ten seconds, or after thirty
  seconds in all while several commands take their turn. The error says how long the command waited
  (`details.waitedMs`) and how long the lock had been held (`details.heldMs`), and a command that waited or held
  the lock for a second or longer writes that to the log of the workspace. One run of the tests on Windows had
  failed: of eight commands, one got the lock and seven gave up after their two seconds.

  Two commands that found a lock that was left behind at the same moment could both take it over, and one of
  their changes could be lost. Now only one of them removes the old lock. A command also no longer removes a lock
  that is not its own when it ends.

- 678f7df: The cross-check of an org with more than 2,000 rows no longer asks Salesforce for the rows to standard objects by
  their type, which Salesforce refuses. A cross-check that was read that way was `partial` and lacked those rows.
  They are now left to the query for every type that is not asked for by name, and the reader checks that they come
  with it. Read that way afterwards, with every answer cut off at 30 rows, the test org of the project gave every
  row. An org with more than 2,000 rows was not read.

- Updated dependencies [79cf9d0]
- Updated dependencies [258f13b]
- Updated dependencies [64714df]
- Updated dependencies [b1a459b]
- Updated dependencies [70daa9d]
- Updated dependencies [20c5f72]
- Updated dependencies [9aadacb]
- Updated dependencies [69c7957]
- Updated dependencies [795f833]
- Updated dependencies [897aa4c]
- Updated dependencies [e9a44e9]
- Updated dependencies [678f7df]
- Updated dependencies [bdbac40]
- Updated dependencies [801bf9c]
- Updated dependencies [0b2c27d]
  - @sf-orglens/engine@0.1.0-next.0
