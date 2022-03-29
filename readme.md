# parse-package-lock

parse lockfiles of npm, yarn, pnpm

* only 300 lines of code: readable, hackable
* using the original code to parse lockfiles

## why

useful for

* implementing a custom `npm install`
  * example: [pnpm-install-only](https://github.com/milahu/pnpm-install-only)
* analysis of the dependency tree

## todo

* [ ] workspaces
  * [x] [npm](https://docs.npmjs.com/cli/v7/using-npm/workspaces) (TODO verify)
  * [ ] [yarn](https://yarnpkg.com/features/workspaces)
  * [x] [pnpm](https://pnpm.io/workspaces) (TODO verify)
* [ ] test cycles (cyclic dependency graphs)
  * [x] fix infinite recursion: `RangeError: Maximum call stack size exceeded`
    * caused by `./bin/print-package-lock.js ./test/tmp/test/workspace-npm/npm/workspaces/arborist/ ./test/tmp/test/workspace-npm/npm/package-lock.json`
    * fix: `name` &rarr; `dep.name`
* [x] convert to ESM
* [ ] add typescript declaration file `*.d.ts`
* [x] separate code: lib vs bin
* [ ] validate lockfile: must be in sync with package.json
  * this should be covered by `ErrorCode.NotResolved` (TODO verify)
* [x] tolerate missing dependencies? peerDependencies, devDependencies. just install as much as possible from the lockfile
* [ ] alias names are needed in the result
* [ ] protocols for spec-versions
  * [ ] `npm:`
  * [ ] `file:`
    * https://docs.npmjs.com/cli/v7/configuring-npm/package-json#local-paths
  * [ ] `workspace:`
  * [ ] `github:`
    * https://docs.npmjs.com/cli/v7/configuring-npm/package-json#github-urls
  * [ ] `git:` `git+ssh:` `git+http:` `git+https:` `git+file:`
  * [ ] `https:` `ftps:`
    * https://docs.npmjs.com/cli/v7/configuring-npm/package-json#urls-as-dependencies
  * more?

## similar projects

* [snyk-nodejs-lockfile-parser](https://github.com/snyk/nodejs-lockfile-parser)
  * [pnpm is not supported](https://github.com/snyk/nodejs-lockfile-parser/issues/111)
  * [integrity is missing](https://github.com/snyk/nodejs-lockfile-parser/pull/112)
  * 1354 lines of code in `lib/`
