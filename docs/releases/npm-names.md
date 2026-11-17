# Holding the names on npm

These are steps for the maintainer, once. Decision record
[0052](../adr/0052-the-project-holds-its-names-on-npm.md) says why: a pre-release is installed from GitHub, and
`npm update --global` would replace it with whatever the registry of npm holds under the names of the packages.
With these steps the project holds the names itself, with empty packages.

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

1. **An account.** Sign in at [npmjs.com](https://www.npmjs.com/), or create an account. Turn on two-factor
   sign-in for it, for sign-in and for publishing.
2. **The organization.** Create the organization `sf-orglens`, with the free plan for public packages:
   [npmjs.com/org/create](https://www.npmjs.com/org/create). If npm says the name is taken, stop here: a user
   account has it, and the scope of the engine has to be chosen again.
3. **Write the three packages**, in a clone of this repository at the newest `main`:

   ```sh
   node scripts/pre-release.mjs names ../orglens-names
   ```

   It writes the folders `sf-orglens`, `sf-orglens-engine` and `orglens` into a new folder next to the clone and
   publishes nothing. Read the eight files if you like: they are short.

4. **Sign in on the command line** with `npm login`, and check with `npm whoami`.
5. **Publish**, one package at a time. npm asks for the code of the two-factor sign-in each time.

   ```sh
   cd ../orglens-names/sf-orglens
   npm publish --access public
   cd ../sf-orglens-engine
   npm publish --access public
   cd ../orglens
   npm publish --access public
   ```

   Each ends with a line `+ <name>@0.0.0`. Leave the last two lines out to not hold `orglens`.

6. **Sign out** with `npm logout`, and delete the folder `orglens-names`.
7. **Tell the assistant.** It reads the three names from the registry, takes the mark `[open]` out of the
   release notes of the first pre-release, and asks for your word before the run that publishes it.

## What cannot be undone

A version on npm can be removed only within 72 hours, and its number can never be used again. That costs
nothing here: the packages of this repository are past `0.0.0`. The names stay with your account and the
organization. When OrgLens is released on npm, the real packages are published under the same names with a
higher version.

## Not verified

These steps were not run: the assistant has no account on npm and must not have one. What was tried is what
follows them. With the three packages in a stand-in registry on one machine, `npm update --global` puts the
empty `sf-orglens` in the place of an installed pre-release, with npm 11.19 and 12.2, and `orglens` then prints
that it is not OrgLens. The pages of npm for creating an organization may read differently from what step 2
says.
