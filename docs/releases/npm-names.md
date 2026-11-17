# Holding the names on npm

> **Do not follow these steps yet.** The review of the pull request that added this page found that the policy
> of npm forbids publishing a package only to reserve its name, and says that an account that does so "may be
> removed or renamed without notice" ([docs.npmjs.com/policies/disputes](https://docs.npmjs.com/policies/disputes)).
> The choice is back with the maintainer since 17 November 2026. Decision record
> [0052](../adr/0052-the-project-holds-its-names-on-npm.md) has the finding and the other ways. The steps stay
> here for the case that the maintainer chooses this way with that knowledge.

These are steps for the maintainer, once. Decision record 0052 says why: a pre-release is installed from GitHub,
and `npm update --global` would replace it with whatever the registry of npm holds under the names of the
packages. With these steps the project holds the names itself, with empty packages.

Only the maintainer can do this. It needs an account on npm, and nothing in this repository can publish there.

## What is published

Three empty packages at version `0.0.0`:

| Name                 | Why                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `sf-orglens`         | The command line package.                                                                |
| `@sf-orglens/engine` | The engine package. Its scope needs the organization `sf-orglens` on npm.                |
| `orglens`            | The name of the binary. `npx orglens` fetches the package of that name. Can be left out. |

Each holds a `package.json` and a `README.md` that says the name is held. `sf-orglens` and `orglens` also
install a command `orglens` that prints that it is not OrgLens. None has a dependency or a script.

On 17 November 2026 all three names were free on the registry, and no organization had the name `sf-orglens`.

## Steps

1. **An account.** Sign in at [npmjs.com](https://www.npmjs.com/), or create an account and confirm its email
   address. Turn on two-factor sign-in for it, for sign-in and for publishing.
2. **The organization.** Create the organization `sf-orglens`, with the free plan for public packages:
   [npmjs.com/org/create](https://www.npmjs.com/org/create). If npm says the name is taken, stop here: a user
   account has it, and the scope of the engine has to be chosen again. If your own account has the name
   `sf-orglens`, the scope is yours already and no organization is needed.
3. **Write the three packages**, in a clone of this repository at the newest `main`:

   ```sh
   node scripts/pre-release.mjs names ../orglens-names
   ```

   It writes the folders `sf-orglens`, `sf-orglens-engine` and `orglens` into a new folder next to the clone and
   publishes nothing. Read the eight files if you like: they are short. The folder above the clone must hold no
   `package.json` and no `.npmrc` of its own.

4. **Sign in on the command line** with `npm login --registry https://registry.npmjs.org/`, and check with
   `npm whoami --registry https://registry.npmjs.org/`.
5. **Publish**, one package at a time. npm asks for the second factor each time: a code, or a link it opens in
   the browser.

   ```sh
   cd ../orglens-names/sf-orglens
   npm publish --access public
   cd ../sf-orglens-engine
   npm publish --access public
   cd ../orglens
   npm publish --access public
   ```

   Before it sends anything, npm prints a line that holds `Publishing to https://registry.npmjs.org/`. Each
   package names that registry itself. If the line names another address, stop. Each publish ends with a line
   `+ <name>@0.0.0`. Leave the last two lines out to not hold `orglens`. The order does not matter.

6. **Sign out** with `npm logout`, and delete the folder `orglens-names`.
7. **Tell the assistant.** It reads the names from the registry, compares the checksum of each package with the
   one of the package the step writes, takes the mark `[open]` out of the release notes of the first
   pre-release, and asks for your word before the run that publishes it.

## What cannot be undone

Do not unpublish one of the packages. `0.0.0` is its only version, so removing the version removes the package,
and as far as I can tell the name is then free for anyone. npm allows the removal within 72 hours, and later as
well for a package nobody depends on that has few downloads and one owner. A version number that was used can
never be used again. That costs nothing here: the packages of this repository are past `0.0.0`.

The names stay with your account and the organization. When OrgLens is released on npm, the real packages are
published under the same names with a higher version. Until a version without a pre-release part is published,
`npm install --global sf-orglens` gives the empty package, also when pre-releases are on npm under another tag.

## Not verified

These steps were not run: the assistant has no account on npm and must not have one. What was tried is the
publishing to a registry on one machine, with npm 11.19 and 12.2, and what follows it: `npm update --global`
puts the empty `sf-orglens` in the place of an installed pre-release, and `orglens` then prints that it is not
OrgLens. That was tried before the packages named the public registry themselves. With that name in them
nothing was published anywhere: a try would go to the public registry.

Not known:

- Whether npm sends each package to the registry the package names when the settings of the machine name
  another one. The documentation of npm says so. Step 5 says which line to read.
- Whether npm acts against such packages, and how soon. Its policy says that it can.
- Whether the pages of npm for creating an account and an organization read as steps 1 and 2 say.
- Whether npm refuses the name `orglens` as too near to a name that exists. If it does, leave it out.
- Whether a user account has the name `sf-orglens`.
- Whether the checksums of the packages are the same when they are written on Windows or macOS. On Linux they
  were the same in two runs.
