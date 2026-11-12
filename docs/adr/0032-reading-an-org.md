# 0032. How an org is read into a snapshot

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0009](0009-one-ingestion-path.md) says that an org is read by retrieving its metadata into the form a repository
holds, so that an org and a repository are read by one path. [0007](0007-immutable-snapshots.md) says that what
was read is kept as a snapshot. [0030](0030-reading-a-git-source.md) built the path for a repository and left open
how a snapshot of an org is written. This record closes that, and decides the questions the code reviews of the
first two parts of Salesforce connectivity left for this one.

An org differs from a repository in four ways that shape the design.

- Reading it takes minutes and many requests, and any of them can fail. A laptop is closed, a session expires.
- Salesforce hands out at most 10,000 files and about 39 MB per retrieve, and says how large a retrieve is only by
  failing it.
- An org does not say what it holds in one answer. A retrieve with a wildcard leaves out standard objects and
  components of installed packages, and nothing in its answer says so.
- The retrieve of the Salesforce library (`@salesforce/source-deploy-retrieve`) does more than is wanted here: it
  writes into a project folder, it keeps the state of a job in memory only, it waits up to 30 minutes for a
  request, it follows a redirect with the session, and parts of it save the login they work with.

Everything below was built and tested against a mock org that answers the Metadata API from the fixture project.
None of it has met Salesforce itself yet. The section at the end says what that leaves open.

## Decision

**The org is read through four requests of the Metadata API that OrgLens makes itself**: which types the org has
(`describeMetadata`), which components of a type (`listMetadata`), start a retrieve (`retrieve`), and how far a
retrieve is (`checkRetrieveStatus`). They are sent with the SOAP client of the library the Salesforce libraries
use themselves (`@jsforce/jsforce-node`), on the connection the login produced. The retrieve of the Salesforce
library is not used. The library is used for one thing only: to convert the files of a retrieve into the form a
repository holds.

- Every request has a time limit for the whole answer, from sending it to its last byte: 60 seconds, and 10
  minutes for the request that fetches the files of a retrieve. A request that gets no answer, or whose answer
  breaks off, is made again twice. So is one that a gateway before the org answers (HTTP 420, 429 or 5xx without
  a fault of the API, or the fault `SERVER_UNAVAILABLE`).
- No request to the Metadata API follows a redirect. An answer that points elsewhere is a failure. The session is
  sent to the address that issued it and to no other.
- The requests are sent by OrgLens with the HTTP client the library uses (`undici`), not the way the SOAP client
  would send them. The client's own way limits only the time until an answer starts, follows redirects, and ends
  the process when a connection breaks in the middle of an answer. The connections go through the proxy the
  Salesforce libraries would use, and are closed when the snapshot ends.
- Nothing here can read a record: the Metadata API has no request that could. One thing is outside these four
  requests: when the session of a Salesforce CLI login expires during a snapshot, the Salesforce library renews
  it and asks the org about the org itself, with the requests [0031](0031-logins-and-the-home-folder.md) names.

**The inventory comes first, and the snapshot is measured against it.** Every type the org describes is listed, one
type per request and six requests at a time. Parts of a component, such as the fields of an object, are listed as
types of their own. A type whose components lie in folders is listed folder by folder. A type the org refuses to
list is recorded as failed, with what the org said, and is never taken for a type without components. A type
Salesforce describes and never lists (`StandardValueSet`) is recorded as not listed. The type of the folders of a
type, such as `ReportFolder`, is treated as that also if the org describes it as a type of its own.

A refusal that holds for the whole org is not the failure of a type: the inventory fails, and no snapshot is
stored. These are a used-up limit of requests (`REQUEST_LIMIT_EXCEEDED`), an API that is closed to the org or the
user, an org that is locked or in maintenance, and a redirect. The same holds when the org refuses more than half
of at least ten listings, whatever codes it gives: then the refusals are not about the types.

**Every component is retrieved by its name, in chunks.** No wildcard is used. A part is not asked for: it comes
with its parent. If the org lists a part and not its parent, the parent is asked for. The mock org does that for
a custom field of a standard object. Salesforce is said to list standard objects among the custom objects, which
is not verified. A chunk is filled to a weight of 3,000, where a component weighs the number of files it is
estimated to have. A chunk that fails is split in two and tried again, down to one component. That component is
then recorded as not handed out (`RETRIEVE_FAILED`). A chunk fails when Salesforce fails its job, when Salesforce
refuses to start its retrieve three times with a pause in between, or when what comes back is not a zip file that
can be read.

**What an org is stored as does not depend on where the command runs.** The Salesforce library lets a project
change the form files are written in, with settings in its `sfdx-project.json` (`sourceBehaviorOptions`,
`registryCustomizations`), and it looks for a project from the folder it writes to upwards and from the folder the
process runs in. That is often the repository of the user. So the folder a chunk is converted in gets a project
file of its own, without such settings, and the library is told to ask that one. The files of an org are always
in the standard form: one file for all custom labels, one file per permission set.

**A snapshot of an org is written in many short transactions, and the database is the journal.** A snapshot of a
Git source stays one transaction.

1. One transaction stores the snapshot with the status `running`, the inventory, a coverage row for every type,
   and the chunks.
2. For each chunk: the id of the job at Salesforce is stored as soon as the retrieve is started. When the job has
   ended, the zip file is fetched once, converted in a folder below `.orglens/tmp`, and one transaction stores the
   files, marks the components that came back, records the issues and marks the chunk as done.
3. One transaction counts what came back against the inventory and sets the status: `partial` if any issue has
   the severity `error`, else `complete`.

There is no cache of retrieved files beside the database. What an org handed out is in the database as soon as a
chunk has ended, and the work folder is emptied when a snapshot starts and when it ends.

**An interrupted snapshot is continued by the next run.** The snapshot stays `running`. The next `snapshot` of the
source finds it, asks Salesforce for the job that was running, and goes on with the chunks that are not done. It
does not take the inventory again, and it uses the API version the snapshot was begun with. It records the issue
`SNAPSHOT_RESUMED`: such a snapshot was read from the org at more than one time. A snapshot is given up, and ends
as `failed`, when the user asks for it with `--restart`, or when another version of OrgLens began it. A source
has at most one snapshot that is `running`, which an index of the database enforces.

**Failures have three sizes.**

- What costs one type or one component makes the snapshot partial and does not stop it: a listing the org
  refuses, a component Salesforce does not hand out, a component the org listed that did not come back, a file
  that cannot be read as metadata.
- What says that going on is pointless stops the command and leaves the snapshot to be continued: an org that
  does not answer, a session that is not accepted and cannot be renewed, a refusal that holds for the whole org,
  a retrieve of this run that does not end within 30 minutes, 20 failed retrieves in a row, a work folder that
  cannot be written.
- A job that gives no result is started again: one that Salesforce no longer knows or refuses to say anything
  about, one that succeeded without a zip file, and one that did not end in the run that started it and does not
  end within 30 minutes of the next run either. A chunk is started three times in all. After that all its
  components are recorded as not handed out, in one issue `RETRIEVE_FAILED`, and the snapshot goes on.

No failure that repeats itself keeps a snapshot from ending: every one of them ends, after a bounded number of
tries, in a chunk that is split or given up, or in the snapshot being stopped with the journal moved forward.

**One process takes a snapshot of a source at a time.** The lock is a file in the data folder that holds the id of
the process. It is looked at and written inside a write transaction of the database, so two processes that find
the lock of a dead process cannot both take it. A lock whose process no longer exists is taken over. A process
removes the lock at its end only if the file still holds its own id. The work folder below `.orglens/tmp` belongs
to the process that holds the lock: a command that is refused the lock does not touch it.

The lock relies on the process id, which has limits that are accepted. If the process of a stale lock has ended
and its id was given to another program, the lock is taken for held until the file is deleted by hand, as the
hint of `SNAPSHOT_RUNNING` says. Two containers that share one workspace folder do not see each other's
processes and can both take the lock. Two real processes that race for the lock are not tested: the test holds a
write transaction on a second connection and checks that the lock is not touched.

**The name of a source stands for one org.** The first snapshot stores the id of the org that answered with the
source, and a later snapshot is refused with `ORG_MISMATCH` if another org answers. This holds also for a source
that declares no `org_id`. The id is stored in the transaction that stores the snapshot, not before: a login that
works and an inventory that fails leave the database as it was.

**"The latest snapshot" is the latest that ended as `complete` or `partial`.** `status` and `coverage` do not
take a snapshot that is being taken, or one that was given up, for the latest. `status` shows an unfinished
snapshot beside it.

**The questions left by the reviews of parts one and two:**

| Question                                                          | Decision                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A snapshot does not record which file belongs to which component. | Still not stored. The components of an org are stored by name in the inventory. The link from component to files is worked out again from the files in Phase 1, which is repeatable. |
| A Git source is known to the database by name and kind only.      | Unchanged for a Git source. An org source is tied to its org id.                                                                                                                     |
| `coverage` refuses a source that is no longer declared.           | Unchanged.                                                                                                                                                                           |
| The latest snapshot could be one that is running or failed.       | Decided above.                                                                                                                                                                       |
| Taking a snapshot blocks the process.                             | A snapshot of an org waits for Salesforce without blocking, between short transactions, and reports progress. A snapshot of a Git source still blocks, for seconds.                  |
| A Git LFS pointer file is stored as the content of the file.      | Unchanged, and now a known limitation.                                                                                                                                               |
| A guard that no session of a login with a key is stored.          | The paths of the library that save a login are not used. A test takes a snapshot with a key and compares the home folder with the two files without secrets that 0031 names.         |
| Time limits for requests the library makes itself.                | Every request of a snapshot is made by OrgLens, with the limits above. The renewal of a Salesforce CLI session is still the library's own, as 0031 describes.                        |
| The HTTP client follows a redirect and sends the session along.   | No request to the Metadata API follows a redirect. The renewal of a session is the library's own, as above.                                                                          |

## Consequences

- **Profiles and permission sets are incomplete in a snapshot of an org.** Salesforce hands such a component out
  with the access to the components of the same retrieve only, and an org is retrieved in chunks. The snapshot
  says so with the warning `ACCESS_INCOMPLETE` and a note on both types. Access impact
  ([0014](0014-access-impact.md)) needs these files complete, so how they are read is a decision that has to be
  made before that work, and before an org and a repository are compared on these two types.
- The acceptance criterion "a snapshot of the fixture folder and a snapshot of an org with the same content hold
  the same files" is met against the mock org with one known difference: the mock org also hands out the standard
  object `Account` as a file, because it holds custom fields. The contents of the files were not compared, since
  the mock builds them from the same files.
- Beyond the fixture project, a mock org that holds each of the three public codebases of `fixtures/corpora.toml`
  was read, the largest with 11,707 components in five chunks. Every component and every file came back, with
  four differences that are understood: a static resource gets the file ending of its content type, labels that
  a project keeps in two files are one file in an org, the org adds the objects whose fields a project holds
  without the object, and a report, dashboard, document or email template in a folder the project has no file
  for is left out of the comparison, because the mock org does not know the folder. This test found two defects that the fixture project could not show, both fixed: custom
  labels could not be converted, and reports in folders were never asked for. It is skipped where the codebases
  are not downloaded, which includes CI. The mock converts with the same library that converts back, so this
  says nothing about what Salesforce itself hands out.
- **A Git source still follows the project of the folder the command runs in.** The same settings of a project
  decide how the files of a repository are resolved, and [0030](0030-reading-a-git-source.md) did not know about
  them. For a workspace inside the repository it reads, the library finds the right project. For a source whose
  `repo` is another folder, it asks the wrong one. A repository that uses these settings also holds its files in
  another form than a snapshot of an org, which matters when the two are compared. Both are to be decided with
  the comparison, and neither is changed here.
- The schema of the database has version 2. Migration 2 adds the job id of a chunk, two columns that say whether a
  component was listed and whether it came back, a column that says how the listing of a type went, and the index
  for one running snapshot. A database of version 1 is migrated when a command that writes opens it.
- The public report of a snapshot has two new fields, `snapshot.apiVersion` and `types[].listing`, and `status`
  has `unfinishedSnapshot`. There is a new error code, `SNAPSHOT_RUNNING`, and the reason `KIND_NOT_READABLE` of
  `SOURCE_READ_FAILED` is gone. The contract may still change before the first release
  ([0027](0027-json-envelope-and-exit-codes.md)).
- The SOAP client is imported from inside the package `@jsforce/jsforce-node` (`lib/soap.js` and the schema of the
  Metadata API beside it), which is not a documented entry of that package. The version is pinned, and the tests
  against the mock org fail if an upgrade moves or changes it. What sends its requests is handed to the class as
  an option its declaration does not name, and tests pin that the time limit, the refusal of a redirect and a
  broken answer are handled by OrgLens.
- **`undici` is a direct dependency of the engine**, at the version the Salesforce library already brings
  (8.12.4). It is the HTTP client of that library, so no code is added to an installation. It is named because
  the engine now calls it itself. The reason is the three faults of the client's own way of sending that are
  listed above.
- The codes that stand for a refusal of the whole org, and the fault `INVALID_CROSS_REFERENCE_KEY` for a job
  Salesforce no longer knows, are taken from the documentation of the API. None was seen in the answer of a real
  org yet. A code that is missing from the list costs a listing or a chunk, which the snapshot names, or stops
  the snapshot when most listings are refused. It does not block a snapshot for good.
- A start that the org refuses three times is taken for a refusal of that retrieve, and its halves are tried. If
  an org refuses every start for minutes, a few components are recorded as not handed out before the snapshot
  stops after 20 failures in a row. The snapshot then ends as partial and names them.
- A retrieve whose start got no answer is started again. If the first start did reach Salesforce, a job runs
  there whose result nobody fetches. The same holds for a job that was running when a snapshot was given up.
- A session that was opened with a key is not renewed. If it expires during a long snapshot, the command stops and
  the next run logs in again and continues. A Salesforce CLI session is renewed by the library, with the requests
  0031 names.
- The estimates of the chunk planner are guesses per type. A wrong one costs a split, which is one failed
  retrieve, and never a wrong snapshot.
- A file that comes back in two retrieves is stored as it came last, and a warning names it. No member is asked
  for twice, so this is not expected. It is recorded so that it is seen if an org does it.
- The components of an org are converted by the Salesforce library, in a folder on disk. A component the library
  cannot convert is named in an issue, and the others of its chunk are stored. When a conversion fails, the work
  folder is checked first: if it cannot be written or was changed, the snapshot stops with `WORKSPACE_IO` and
  nothing is recorded against the metadata. That a changed work folder is noticed is not tested. A component
  whose name Windows reserves for a device, such as a class `Aux`, can be converted on Linux and macOS and not on
  Windows, where it is named in an issue.
- An entry of a zip file outside the folder of the retrieve is not read and is named in an issue. Names that
  point above the work folder are made harmless by the zip library before a file is written, which a test pins.
- An unfinished snapshot is never removed by OrgLens. One that is given up stays in the database as `failed`,
  with the files it had. Removing old snapshots is not built.

**Not verified, because no real org has been read yet:**

- Whether the names in a retrieve always equal the names the org listed. A difference shows as components that
  are reported both as not retrieved and as not listed.
- Which types a real org refuses to list. Every refusal makes the snapshot partial. If orgs refuse types as a
  matter of course, a list of types that are known to be refused will be needed, and it would be a change to
  this record.
- How Salesforce words the failure of a retrieve that is too large, and whether it always fails the whole job. The
  split does not depend on the wording.
- Folders inside folders, which newer orgs have for reports and dashboards, and whether an org lists every
  folder, also those of installed packages. A component in a folder the org does not list is never asked for,
  and nothing can say so.
- What a profile holds when it is retrieved with one kind of component, and with none.
- How long the inventory and the retrieve of an org of 10,000 components take, and whether six listings at a time
  stay below the limits of an org.
- The permission a user needs. Salesforce documents that the Metadata API needs "Modify Metadata Through Metadata
  API Functions" or "Modify All Data".
- Whether Salesforce lists standard objects among the custom objects, and standard fields among the fields.
- How Salesforce answers a request it refuses for the whole org, and a job it no longer knows: the codes above.
- Documents, which an org may list with the ending of their file while the library names them without it, and
  layouts of an installed package, whose name carries the namespace twice in some answers. Both would show as
  components that are reported as not retrieved and as not listed.

**Open questions for the maintainer, not decided here:**

- A sandbox that is refreshed gets a new org id. A source of the kind `sandbox` is then refused with
  `ORG_MISMATCH` after every refresh, by the rule that a name stands for one org. Whether a sandbox source should
  follow its sandbox across a refresh is a decision about what its snapshots are compared as.
- Folders inside folders may only be found by a query on the object `Folder`, through the API for data. The
  data rule forbids such a query. If the listing of the Metadata API does not show them, the rule or the coverage of
  nested folders has to give.

The first run against the test org (work package 8 of the Phase 0 plan) is where these are measured.
