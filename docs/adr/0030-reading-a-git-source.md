# 0030. How a Git source is read into a snapshot

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0007](0007-immutable-snapshots.md) makes every source an immutable snapshot, and [0009](0009-one-ingestion-path.md)
gives orgs and repositories one path into the engine. A Git source is the first source that is read. It comes in
two forms: the folders as they are on disk, and a commit, named by a branch, a tag or an id, that need not be
checked out.

The Salesforce source library (`@salesforce/source-deploy-retrieve`) knows which files make up which component,
for every metadata type. It is the same knowledge the Salesforce CLI deploys with, and writing it again would be
the largest avoidable source of errors. But the library reads from the disk: its project and `.forceignore`
handling look for files from the current folder upwards, read the global configuration, and ask the file system
what a path is. A commit that is not checked out has no place on the disk, and checking it out would change the
repository of the user.

Four questions had to be settled: how a commit is read without touching the repository, how much of the library
is used, which files a snapshot holds, and when a snapshot may claim to hold a commit.

## Decision

**Every source becomes a tree of files first.** A tree is a sorted list of paths with forward slashes and a
function that returns the bytes of one of them. A folder on disk and a commit both become one. Everything after
that, from finding the components to storing them, works on the tree and does not know where it came from. A
retrieve from an org will produce the same shape.

**A commit is read from the object database of Git, by the `git` program.** `ls-tree` lists the files and
`cat-file --batch` returns their content in batches of bounded size. What is read is exactly what the commit
holds: no checkout, no line-ending conversion, no filters. Only commands that read are used. Git is told not to
prompt, not to take optional locks, not to honour replacement objects, not to fetch missing objects, and not to
run a file-system monitor of the repository. The name of the commit is passed as one argument after the end of
the options. A source without `ref` is read from disk and needs no Git.

**The library resolves components, on our tree.** Its resolver accepts a tree in place of the disk, and gets ours
under a made-up absolute root. Only the resolver and the registry of metadata types are used. The library is
loaded on first use, and its log file in the home folder of the user is switched off before it loads.

**`sfdx-project.json` and `.forceignore` are read by OrgLens.** The project file is parsed as JSON, and only for
its package directories. A package directory that lies in another one is read with that one. The folder of the
file itself (`"path": "."`) is refused as a package directory. `.forceignore` is evaluated with the library the
Salesforce library uses, and with a copy of its default rules that a test compares with the installed version.
Files it excludes are removed before the resolver sees the tree. Without a `.forceignore`, nothing is excluded.
One thing differs from the Salesforce CLI: the file is searched from a package directory upwards to the root of
the repository, and not above it.

**Symbolic links are not followed.** A link can point outside the source, and a snapshot must hold nothing that
the source does not. The same goes for submodules and special files. Each one that was left out is reported.

**A snapshot holds the files of components, and nothing else.** A file belongs to the smallest component that
claims it: a field owns its file, not the object. A file in a package directory that belongs to no component is
not stored. It is counted in an issue: an error if it is an Apex file, because that means a class is missing from
the picture, and a warning otherwise.

**Paths are relative to the repository.** A file is stored under the path it has in the repository, with forward
slashes. Two sources are never compared by path. They are compared by component, because an org has no folders.

**A snapshot names a commit only if it holds exactly that commit.** For a source with `ref` that is the commit
the name resolved to at that moment. For folders on disk, every file that decides the snapshot is compared with
the commit that is checked out, by the id Git gives its content: the files of the folders that `.forceignore`
does not exclude, the project file, and every place a `.forceignore` can be at. If one of them differs or is on
one side only, or if Git cannot tell which commit is checked out, the snapshot names no commit and an issue says
why. Git is not asked whether the working tree is clean, because its answer is about something else: it calls a
file unchanged whose line endings it converted on checkout, a file it was told to assume unchanged, and a file
that a sparse checkout left out.

**A snapshot is written in one transaction.** The source is read first. A source that cannot be read at all
(no repository, no project file, an unknown name of a commit, none of the folders) fails before the database is
opened. Otherwise the snapshot is stored with all its files, its coverage and its issues, or not at all. It is
`partial` if any issue has the severity `error`, and `complete` otherwise.

## Consequences

- `@salesforce/source-deploy-retrieve` and `ignore` are runtime dependencies of the engine. The first brings
  `@salesforce/core` and its dependencies with it, which is most of the installed size. It is imported only by
  the `sources` layer, and only when a snapshot is taken, so commands that take none do not pay for it at
  start-up.
- Reading a commit needs the `git` program. Reading folders from disk does not: without Git, the snapshot is
  taken and names no commit.
- A shallow or partial clone that lacks a file of the commit fails with a message that says so. Nothing is
  fetched.
- A file that Git converts on checkout (line endings, filters) is stored as the commit holds it when a commit is
  read, and as it is on disk when the folders are read. On a machine that converts line endings, which is the
  default of Git for Windows, a snapshot of the folders therefore names no commit. Its issue says that line
  endings are the only difference, and that a source with `ref` reads the commit itself. The component lists are
  the same either way.
- Comparing the folders with the commit reads every file once more, to compute its id. On NPSP this is not
  noticeable beside the reading itself.
- The copy of the default ignore rules has to follow the library. The test that compares them fails when an
  upgrade of the library changes them.
- A `.forceignore` above the repository is not honoured. This is deliberate: a snapshot must not depend on files
  outside its source.
- On NPSP (11,707 components in 12,056 files) reading and resolving takes about 3 seconds from disk and from a
  commit on the development machine, and the database grows by about 22 MB. These numbers were measured once by
  hand and are not a benchmark that CI holds.
- Component sets were compared with the library's own reading from disk on the three public codebases of
  `fixtures/corpora.toml` and are equal. The test that does this is skipped where the codebases are not
  downloaded, which includes CI.
- Not decided here: whether a comparison of two snapshots treats files that differ only in line endings as equal.
  That belongs to the comparison engine.
- Not decided here: how a snapshot of an org is written (it cannot be one transaction, because a retrieve is
  resumed), and which files the Salesforce libraries touch in the home folder when they log in. Both belong to
  the second part of Salesforce connectivity.
