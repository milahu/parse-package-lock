// parse-package-lock.js
// parse lockfile to deep tree of dependencies

// cycles are handled by passing `isCycle: true|false` to the callback function
// recursion stops when `isCycle == true`

// TODO unify interface: `type` and `isDev`

// TODO abstract more? factor-out `lockData` and `walk`

import fs from "fs";
import path from "path";

const pnpm_version = "6.32.3"; // TODO update

//var installPeerDependencies = true;
var installPeerDependencies = false;
// since npmv7, missing peerDependencies are installed
// https://docs.npmjs.com/cli/v7/configuring-npm/package-json#peerdependencies
// pnpm does *not* install peerDependencies by default
// https://github.com/pnpm/pnpm/discussions/3995

export const packageLockFilenames = [
  "package-lock.json", // highest precedence
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
];

export const ErrorCode = {
  NotResolved: 1,
  NoMeta: 2,
};

export async function parsePackageLock({ packagePath, lockfilePath, onPackage, onError, onInfo, peerDependencies, devDependencies }) {

  // find lockfile
  if (!lockfilePath) {
    const packageLockFilenames_set = new Set(packageLockFilenames);

    var lockfile_set = new Set(fs.readdirSync(packagePath).filter(filename => packageLockFilenames_set.has(filename)));
    const lockfileName = packageLockFilenames.find(filename => lockfile_set.has(filename));
    if (!lockfileName) {
      throw new Error("not found lockfile in " + packagePath);
    }
    lockfilePath = path.join(packagePath, lockfileName);
    //console.log(`found lockfile ${lockfilePath}`)
  }

  const lockfileName = path.basename(lockfilePath);

  const packageMeta = JSON.parse(
    fs.readFileSync(
      path.join(packagePath, "package.json"),
      "utf8"
    )
  );
  /*
  const lockfile_type_map = {
    "package-lock.json": "npm",
    "npm-shrinkwrap.json": "npm",
    "yarn.lock": "yarn",
    "pnpm-lock.yaml": "pnpm",
  };
  const lockfile_type = lockfile_type_map[lockfileName];
  console.log(`found lockfile type ${lockfile_type}`);
  */
  const lockfile_parser_map = {
    "package-lock.json": parsePackageLockNpm,
    "npm-shrinkwrap.json": parsePackageLockNpm,
    "yarn.lock": parsePackageLockYarn2,
    "pnpm-lock.yaml": parsePackageLockPnpm,
  };
  const lockfile_parser = lockfile_parser_map[lockfileName];

  const dependenciesSpec = [
    {
      object: packageMeta.dependencies,
      required: true,
    },
  ];

  // peerDependencies, devDependencies
  // false -> dont resolve
  // null | undefined -> try to resolve, ignore errors (default)
  // true -> must resolve, or error

  if (peerDependencies != false) { // null or true
    dependenciesSpec.push({
      object: packageMeta.peerDependencies,
      required: peerDependencies == true,
    });
  }

  if (devDependencies != false) { // null or true
    dependenciesSpec.push({
      object: packageMeta.devDependencies,
      required: devDependencies == true,
    });
  }

  await lockfile_parser({ packagePath, lockfilePath, dependenciesSpec, onPackage, onError, onInfo });
}



export async function parsePackageLockNpm({ packagePath, lockfilePath, dependenciesSpec, onPackage, onError, onInfo }) {

  const npm = await import("@npmcli/arborist");
  // https://www.npmjs.com/package/@npmcli/arborist

  // TODO min or max?
  const minSatisfyingModule = await import('semver/ranges/min-satisfying.js');
  const minSatisfying = minSatisfyingModule.default;
  const resolveVersion = minSatisfying;

  const arb = new npm.Arborist({ path: path.dirname(lockfilePath) });

  //var lockData = await arb.loadVirtual(); // load virtual tree
  var lockData = await arb.buildIdealTree({
    legacyBundling: true,
    // Nest every dep under the node requiring it, npm v2 style.
    // No unnecessary deduplication.
  });
  //console.log("lockData", lockData); // ArboristNode
  //console.log("lockData.edgesOut.get('@isaacs/string-locale-compare')", lockData.edgesOut.get('@isaacs/string-locale-compare'));
  //console.log("lockData.meta", lockData.meta); // Shrinkwrap
  //console.log("lockData.meta.data", lockData.meta.data);
  /*
    {
      lockfileVersion: 2,
      requires: true,
      packages: { '': [Object] },
      dependencies: {}
    },
  */
  //console.log("lockData.meta.data.packages", lockData.meta.data.packages);
  /*
    {
      ...
      'node_modules/@babel/code-frame': {
        version: '7.16.7',
        resolved: 'https://registry.npmjs.org/@babel/code-frame/-/code-frame-7.16.7.tgz',
        integrity: 'sha512-iAXqUn8IIeBTNd72xsFlgaXHkMBMt6y4HJp1tIaK465CWLT/fG1aqB7ykr95gHHmlBdGbFeWWfyB4NJJ0nmeIg==',
        dev: true,
        dependencies: { '@babel/highlight': '^7.16.7' },
        engines: { node: '>=6.9.0' },
        name: '@babel/code-frame',
        _id: '@babel/code-frame@7.16.7'
      },
      ...
    }
  */

  function walk({ lockData, name, spec, required, onPackage, onError, onInfo, depth, parents, parentNames, rootNode }) {
    if (!lockData.children) return;
    if (!depth) depth = 1;
    if (!parents) parents = [];
    if (!parentNames) parentNames = new Set();
    if (!rootNode) rootNode = lockData; // only rootNode has lockData.meta
    for (const [depName, edge] of lockData.edgesOut.entries()) {
      if (depth == 1) {
        // filter by name and spec only on the first call
        // note: when depth > 1, name and spec are null
        if (depName != name) continue;
        if (resolveVersion([edge.to.version], spec) == null) {
          if (required) {
            const error = new Error(`cannot resolve version for package ${name}. specified ${spec}. locked ${edge.to.version}`);
            error.code = ErrorCode.NotResolved;
            onError(error);
          }
          continue;
        }
      }
      const dep = edge.to;
      if (!dep) {
        /*
          example: ./test/tmp/test/workspace-npm/npm/package-lock.json
            dep = {
              "name": "utf-8-validate",
              "spec": "^5.0.2",
              "type": "peerOptional",
              "from": "node_modules/tap/node_modules/ws"
            }
        */
        if (edge.type == "peerOptional" || required == false) {
          continue;
        }
        const error = new Error(`edge.to is ${edge.to} for edge ${JSON.stringify(edge, null, 2)}`);
        error.code = ErrorCode.NoMeta;
        onError(error);
        //onInfo(`edge.to is ${edge.to} for edge ${JSON.stringify(edge, null, 2)} -> ignore this node`);
        onInfo(`ignoring optional peer-dependency ${dep.location}.`);
        continue;
      }
      //console.log("edge", edge);
      //console.log("dep", dep);
      var meta = rootNode.meta.data.packages[dep.location];
      if (!meta.integrity) {
        //onInfo(`meta ${JSON.stringify(meta, null, 2)}. dep ${JSON.stringify(dep, null, 2)}`);
        //onInfo(`meta ${JSON.stringify(meta, null, 2)}`);
        if (meta.inBundle) {
          // TODO what exactly means `meta.inBundle == true`?
          // = package is bundled by a parent package
          // but then, why is it in the lockfile?
          onInfo(`ignoring integrity-less bundled dependency ${dep.location}`);
          continue;
        }
        if (dep.dev) {
          onInfo(`ignoring integrity-less dev-dependency ${dep.location}`);
          continue;
        }
        onInfo(`ignoring integrity-less dependency ${dep.location}`);
        // TODO why is `dep.bundler` sometimes undefined, sometimes string?
        continue;
      }
      /*
      if (meta.inBundle) {
        onInfo(`ignoring bundled dependency ${dep.location}`);
        // TODO why is `dep.bundler` sometimes undefined, sometimes string?
        continue;
      }
      */
      //console.log("meta", meta);
      if (!meta) {
        if (required) {
          const error = new Error(`no meta for dep.location ${dep.location}`);
          error.code = ErrorCode.NoMeta;
          onError(error);
        }
      }
      var isCycle = parentNames.has(dep.name); // FIXME this does not stop recursion. why? wrong name? (alias name)
      // note: `type` is not portable
      const packageData = { name: dep.name, version: dep.version, spec: edge.spec, type: edge.type, resolved: meta.resolved, integrity: meta.integrity, parents, isCycle, depth, edge, dep };
      //console.log(`name ${name} + dep.name ${dep.name} + path ` + [...parentNames, packageData.name].join(" ")) // debug recursion
      if (depth > 100) {
        // exit early
        throw new RangeError("reached depth 100. infinite recursion?");
      }
      onPackage(packageData);
      if (isCycle == false && dep.edgesOut.size > 0) {
        // recurse
        walk({ lockData: dep, name: null, spec: null, required, onPackage, onError, onInfo, depth: depth + 1, parents: [...parents, packageData], parentNames: new Set([...parentNames, packageData.name]), rootNode });
      }
    }
  }
  for (const ds of dependenciesSpec) {
    if (!ds.object) continue;
    for (const [name, spec] of Object.entries(ds.object)) {
      walk({ lockData, name, spec, required: ds.required, onPackage, onError, onInfo });
    }
  }
}



export async function parsePackageLockYarn2({ packagePath, lockfilePath, dependenciesSpec, onPackage, onError, onInfo }) {

  // @yarnpkg/parsers is part of yarn2 = https://github.com/yarnpkg/berry
  // TODO can this parse yarn1 lockfiles? (i guess no)
  const yarn = await import("@yarnpkg/parsers");
  //console.log(`lockfilePath = ${lockfilePath}`)
  /*
    berry/packages/yarnpkg-core/sources/Project.ts

      const content = await xfs.readFilePromise(lockfilePath, `utf8`);

      // We store the salted checksum of the lockfile in order to invalidate the install state when needed
      this.lockFileChecksum = makeLockfileChecksum(content);

      const parsed: any = parseSyml(content);
  */
  var lockfileContent = fs.readFileSync(lockfilePath, "utf8");
  var lockData = yarn.parseSyml(lockfileContent);
  //console.log(lockData); // verbose
  // lockData.__metadata == { version: '6', cacheKey: '9' }
  function walk({ lockData, name, spec, required, onPackage, onError, onInfo, depth, parents, parentNames, versionCache }) {
    if (!depth) depth = 1; // TODO why is depth still undefined
    if (!parents) parents = [];
    if (!parentNames) parentNames = new Set();
    if (!versionCache) {
      versionCache = {};
      for (const [specList, pkgData] of Object.entries(lockData)) {
        // example specList: 'camelcase@npm:^5.0.0, camelcase@npm:^5.3.1'
        // example spec: ^5.3.1
        specList.split(", ").forEach(spec => {
          versionCache[spec] = pkgData;
        });
      }
    }
    //console.log(`walk: name@spec = ${name}@${spec}, required = ${required}, depth = ${depth}`)
    if (spec.startsWith("workspace:")) {
      onInfo(`TODO implement yarn workspace protocol. name@spec = ${name}@${spec}`);
      return;
    }
    const dep = versionCache[`${name}@npm:${spec}`]; // || versionCache[`${name}@${spec}`] || versionCache[`${name}`];
    //console.log("dep", dep);
    if (!dep) {
      if (required && depth == 1) {
        const error = new Error(`cannot resolve version for package ${name}. specified ${spec}`);
        error.code = ErrorCode.NotResolved;
        onError(error);
      }
      return;
    }
    var isCycle = parentNames.has(name);
    var packageData = { name, spec, version: dep.version, resolved: dep.resolution, integrity: dep.checksum, parentNames, parents };
    onPackage(packageData);
    if (isCycle == false && dep.dependencies) {
      for (const [depName, depSpec] of Object.entries(dep.dependencies)) {
        // recurse
        walk({ lockData, name: depName, spec: depSpec, required, onPackage, onError, onInfo, depth: depth + 1, parents: [...parents, packageData], parentNames: new Set([...parentNames, packageData.name]), versionCache });
      }
    }
  }
  for (const ds of dependenciesSpec) {
    if (!ds.object) continue;
    //console.log(ds);
    for (const [name, spec] of Object.entries(ds.object)) {
      walk({ lockData, name, spec, required: ds.required, onPackage, onError, onInfo });
    }
  }
}



export async function parsePackageLockYarn1({ packagePath, lockfilePath, dependenciesSpec, onPackage, onError, onInfo }) {

  // @yarnpkg/lockfile is part of yarn1 = https://github.com/yarnpkg/yarn
  // fails to parse lockfiles of yarn2 = https://github.com/yarnpkg/berry
  const yarnModule = await import("@yarnpkg/lockfile");
  const yarn = yarnModule.default;
  // node_modules/@yarnpkg/lockfile/index.js
  console.log(`lockfilePath = ${lockfilePath}`)
  var s = fs.readFileSync(lockfilePath, "utf8");
  var lockData = yarn.parse(s);
  if (lockData.type != 'success') {
    throw Error(`parse error in ${lockfilePath}`);
  }
  else {
    lockData = lockData.object;
  }
  function walk({ lockData, name, spec, required, onPackage, onError, onInfo, depth, parents, parentNames }) {
    if (!depth) depth = 1;
    if (!parents) parents = [];
    if (!parentNames) parentNames = new Set();
    const dep = lockData[`${name}@${spec}`];
    if (!dep) {
      if (required) {
        const error = new Error(`cannot resolve version for package ${name}. specified ${spec}`);
        error.code = ErrorCode.NotResolved;
        onError(error);
        return; // TODO continue?
      }
    }
    var isCycle = parentNames.has(name);
    /*
    // remove checksum from the `resolved` URL
    // sha1 hex = 40 chars
    var resolvedParts = dep.resolved.split("#");
    if (resolvedParts.length != 2 || resolvedParts[1].length != 40) {
      throw new Error(`parse error in dep.resolved ${dep.resolved}`);
    }
    var resolved = resolvedParts[0];
    */
    var packageData = { name, spec, version: dep.version, resolved: dep.resolved, integrity: dep.integrity, parentNames, parents };
    onPackage(packageData);
    if (isCycle == false && dep.dependencies) {
      for (const [depName, depSpec] of Object.entries(dep.dependencies)) {
        // recurse
        walk({ lockData, name: depName, spec: depSpec, required, onPackage, onError, onInfo, depth: depth + 1, parents: [...parents, packageData], parentNames: new Set([...parentNames, packageData.name]) });
      }
    }
  }
  for (const ds of dependenciesSpec) {
    if (!ds.object) continue;
    for (const [name, spec] of Object.entries(ds.object)) {
      walk({ lockData, name, spec, required: ds.required, onPackage, onError, onInfo });
    }
  }
}



export async function parsePackageLockPnpm({ packagePath, lockfilePath, dependenciesSpec, onPackage, onError, onInfo }) {

  // TODO min or max?
  const minSatisfyingModule = await import('semver/ranges/min-satisfying.js');
  const minSatisfying = minSatisfyingModule.default;
  var resolveVersion = minSatisfying;

  const pnpm = await import("@pnpm/lockfile-file");

  const lockfileDir = path.dirname(lockfilePath);
  var lockData = await pnpm.readWantedLockfile(lockfileDir, {
    wantedVersion: pnpm_version,
  });
  // node_modules/@pnpm/lockfile-file/lib/read.js
  if (lockData == null) {
    // TODO use onError?
    throw new Error("pnpm parser returned null");
  }

  var workspaceDir = null;
  var workspacePackages = null;

  async function walk({ lockData, name, spec, required, onPackage, onError, onInfo, depth, parents, parentNames, versionCache }) {
    if (!depth) depth = 1;
    if (!parents) parents = [];
    if (!parentNames) parentNames = new Set();

    if (!versionCache) {
      // build lists of version candidates
      // so we can map "spec" to "version" via resolveVersion
      versionCache = {};
      for (var nameVersion of Object.keys(lockData.packages)) {
        var nameParts = nameVersion.split("/");
        var pkgName = nameParts.slice(1, -1).join("/");
        var version = nameParts.slice(-1)[0];
        // debug
        //if (nameVersion.includes("colorize-semver-diff"))
        //  console.log("nameVersion", nameVersion, "pkgName", pkgName, "version", version);
        if (!versionCache[pkgName]) versionCache[pkgName] = []; // list of version candidates
        versionCache[pkgName].push(version);
      }
    }

    //console.log(`name ${name} spec ${spec}`);
    var version;
    var resolved = null;
    var integrity = null;
    if (spec.startsWith("workspace:")) {
      if (!workspaceDir) {
        const findWorkspaceDirModule = await import("@pnpm/find-workspace-dir");
        const findWorkspaceDir = findWorkspaceDirModule.default.default;
        //console.dir({ findWorkspaceDir, findWorkspaceDirModule, })
        const findWorkspacePackagesModule = await import("@pnpm/find-workspace-packages");
        const findWorkspacePackages = findWorkspacePackagesModule.findWorkspacePackagesNoCheck;
        workspaceDir = await findWorkspaceDir(packagePath);
        if (!workspaceDir) {
          throw new Error("failed to find workspace");
        }
        //console.log("workspaceDir", workspaceDir);
        workspacePackages = await findWorkspacePackages(workspaceDir);
        //console.log("workspacePackages", workspacePackages);
      }
      var specVersion = spec.slice(10); // remove "workspace:" prefix
      var pkgCandidates = workspacePackages.filter(p => p.manifest.name == name);
      var versionList = pkgCandidates.map(p => p.manifest.version);
      version = resolveVersion(versionList, specVersion);
      var p = pkgCandidates.find(p => p.manifest.version == version);
      var pDir = path.relative(packagePath, p.dir);
      resolved = "file:" + pDir;
    }
    else {
      if (spec.startsWith("/")) {
        /*
        example: pnpm/pnpm-lock.yaml
          dependencies:
            comver-to-semver: 1.0.0
            js-yaml: /@zkochan/js-yaml/0.0.5
        -> alias from js-yaml to @zkochan/js-yaml
        */
        var nameParts = spec.split("/");
        var name2 = nameParts.slice(1, -1).join("/");
        var spec2 = nameParts.slice(-1)[0];
        onInfo(`found alias from ${name} to ${name2} @ ${spec2}`);
        name = name2;
        spec = spec2;
      }
      if (spec.startsWith("npm:")) {
        /*
        example: pnpm/pnpm-lock.yaml
          specifiers:
            '@types/wrap-ansi': ^3.0.0
            '@types/zkochan__table': npm:@types/table@6.0.0
        -> alias from @types/zkochan__table to npm:@types/table@6.0.0
        */
        var parts = spec.slice(4).split("@");
        var name2 = parts.slice(0, -1).join("@");
        var spec2 = parts.slice(-1)[0];
        onInfo(`found alias from ${name} to ${name2} @ ${spec2}`);
        name = name2;
        spec = spec2;
      }
      var versionList = versionCache[name];
      if (!versionList) {
        const error = new Error(`not found name ${name} in versionCache`)
        // FIXME not found name @types/zkochan__table in versionCache
        // alias to npm protocol:
        //       '@types/zkochan__table': npm:@types/table@6.0.0
        error.code = ErrorCode.NotResolved;
        onError(error);
        return; // fatal error
      }
      var specVersion = spec.split("/").slice(-1)[0];
      var version;
      if (versionList.length == 1 && versionList[0] == spec) {
        // fast path
        // but also workaround for limitation in semver.
        // semver cannot parse some pnpm versions, see below (spec 1.0.9_request@2.88.0)
        version = versionList[0];
      }
      else {
        version = resolveVersion(versionList, spec);
      }
      //console.log({ name, spec, specVersion, version })
      if (version == null) {
        // TODO is this reachable?
        const error = new Error(`cannot resolve package ${name} spec ${spec} from versionList ${versionList}`);
        // FIXME cannot resolve package request-promise-native spec 1.0.9_request@2.88.0 from versionList 1.0.9_request@2.88.0
        // semver cannot parse this. what would pnpm do?
        error.code = ErrorCode.NotResolved;
        if (required) onError(error); else onInfo(error);
        return;
      }
      var pkgKey = `/${name}/${version}`;
      // note: no special handling for scoped packages, for example @pnpm/logger
      var node = lockData.packages[pkgKey];
      if (!node) {
        if (required) {
          const error = new Error(`cannot resolve package ${name} version ${version}`);
          error.code = ErrorCode.NotResolved;
          if (required) onError(error); else onInfo(error);
        }
        return;
      }
      var isCycle = parentNames.has(name);
      // note: the `resolved` URL is not stored in pnpm-lock.yaml (TODO verify)
      // note: `isDev` is not portable
      // note: devDependencies are not locked in pnpm-lock.yaml (TODO verify)
      integrity = node.resolution.integrity;
    }

    var packageData = { name, spec, version, resolved, integrity, parentNames, parents };
    // , isDev: node.dev
    onPackage(packageData);
    if (isCycle == false && node.dependencies) {
      for (const [name, spec] of Object.entries(node.dependencies)) {
        // recurse
        await walk({ lockData, name, spec, required, onPackage, onError, onInfo, depth: depth + 1, parents: [...parents, packageData], parentNames: new Set([...parentNames, packageData.name]), versionCache });
      }
    }
  }
  for (const ds of dependenciesSpec) {
    if (!ds.object) continue;
    for (const [name, spec] of Object.entries(ds.object)) {
      await walk({ lockData, name, spec, required: ds.required, onPackage, onError, onInfo });
    }
  }
}
