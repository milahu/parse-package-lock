# parse-package-lock

parse lockfiles of npm, yarn, pnpm

* only 200 lines of code: readable, hackable
* using the original code to parse lockfiles

## why

useful for

* implementing a custom `npm install`
  * example: [pnpm-install-only](https://github.com/milahu/pnpm-install-only)
* analysis of the dependency tree

## todo

* [ ] implement workspaces
  * [ ] [npm](https://docs.npmjs.com/cli/v7/using-npm/workspaces)
  * [ ] [yarn](https://yarnpkg.com/features/workspaces)
  * [x] [pnpm](https://pnpm.io/workspaces) (TODO verify)
* [ ] test cycles (cyclic dependency graphs)
* [x] convert to ESM
* [ ] add typescript declaration file `*.d.ts`
* [ ] separate code: lib vs bin
* [ ] validate lockfile: must be in sync with package.json
* [ ] tolerate missing dependencies? peerDependencies, devDependencies. just install as much as possible from the lockfile

## similar projects

* [snyk-nodejs-lockfile-parser](https://github.com/snyk/nodejs-lockfile-parser)
  * [pnpm is not supported](https://github.com/snyk/nodejs-lockfile-parser/issues/111)
  * [integrity is missing](https://github.com/snyk/nodejs-lockfile-parser/pull/112)
  * 1354 lines of code in `lib/`
