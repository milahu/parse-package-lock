#! /usr/bin/env node

// parse-package-lock.js
// parse lockfile to deep tree of dependencies

// cycles are handled by passing `isCycle: true|false` to the callback function
// recursion stops when `isCycle == true`

// TODO unify interface: `type` and `isDev`

import fs from "fs";
import path from "path";

const pnpm_version = "6.32.3"; // TODO update

//var installPeerDependencies = true;
var installPeerDependencies = false;
// since npmv7, missing peerDependencies are installed
// pnpm does *not* install peerDependencies by default
// https://github.com/pnpm/pnpm/discussions/3995

const lockfile_candidates = [
  "package-lock.json", // highest precedence
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
];



async function main() {

  // demo: print the dependency tree
  var onPkg = function(pkg) {
    console.log([...pkg.parents, pkg].map(node => `${node.name}@${node.version}`).join(" "), pkg.integrity || pkg.resolved);
  };

  if (process.argv.length < 3 || 4 < process.argv.length) {
    process.stderr.write([
      "usage:",
      `  ${path.basename(process.argv[1])} path/to/package/ [path/to/lockfile]`,
      "",
      "lockfile can be:",
      ...lockfile_candidates.map(f => `  ${f}`)
    ].join("\n") + "\n");
    process.exit(1);
  }

  // all arguments are paths
  for (const argv_path of process.argv.slice(2)) {
    if (!fs.existsSync(argv_path)) {
      throw Error("not found path: " + argv_path);
    }
  }

  const pkgPath = process.argv[2];
  
  const lockfilePath = process.argv[3] || (
    (function () {
      const lockfile_candidates_set = new Set(lockfile_candidates);

      var lockfile_set = new Set(fs.readdirSync(pkgPath).filter(filename => lockfile_candidates_set.has(filename)));
      const lockfile_name = lockfile_candidates.find(filename => lockfile_set.has(filename));
      if (!lockfile_name) {
        throw new Error("not found lockfile in " + pkgPath);
      }
      const lockfilePath = path.join(pkgPath, lockfile_name);
      //console.log(`found lockfile ${lockfilePath}`)
      return lockfilePath;
    })()
  );

  await parse_lockfile({ pkgPath, lockfilePath, onPkg });
}



async function parse_lockfile({ pkgPath, lockfilePath, onPkg }) {

  const pkgJsonPath = path.join(pkgPath, "package.json");
  const package_json = fs.readFileSync(pkgJsonPath, "utf8");
  //const lockfile_content = fs.readFileSync(lockfilePath, "utf8");
  const lockfile_name = path.basename(lockfilePath);

  var package_data = JSON.parse(package_json);
  var specObj = {
    ...(installPeerDependencies ? package_data.peerDependencies : []),
    //...package_data.devDependencies,
    ...package_data.dependencies, // highest precedence
  };
  console.log("declared dependencies:");
  for (const [name, version] of Object.entries(specObj)) {
    console.log(`${name}@${version}`);
  }
  const lockfile_type_map = {
    "package-lock.json": "npm",
    "npm-shrinkwrap.json": "npm",
    "yarn.lock": "yarn",
    "pnpm-lock.yaml": "pnpm",
  };
  const lockfile_parser_map = {
    "package-lock.json": parse_lockfile_npm,
    "npm-shrinkwrap.json": parse_lockfile_npm,
    "yarn.lock": parse_lockfile_yarn,
    "pnpm-lock.yaml": parse_lockfile_pnpm,
  };
  const lockfile_type = lockfile_type_map[lockfile_name];
  const lockfile_parser = lockfile_parser_map[lockfile_name];
  //console.log(`found lockfile type ${lockfile_type}`);
  console.log(`resolved dependencies:`);
  return await lockfile_parser({ pkgPath, lockfilePath, specObj, onPkg });
}



async function parse_lockfile_npm({ pkgPath, onPkg }) {

  const npm = await import("@npmcli/arborist");
  // https://www.npmjs.com/package/@npmcli/arborist
  const arb = new npm.Arborist({ path: pkgPath });
  //var lockData = await arb.loadVirtual(); // load virtual tree
  var lockData = await arb.buildIdealTree({
    legacyBundling: true,
    // Nest every dep under the node requiring it, npm v2 style.
    // No unnecessary deduplication.
  });
  var walk = function thisFunction(pkg, onPkg, depth = 0, parents = [], parentNames = new Set(), rootNode = null) {
    if (!pkg.children) return;
    if (!rootNode) rootNode = pkg; // only rootNode has pkg.meta
    for (const [name, edge] of pkg.edgesOut.entries()) {
      var pkg = edge.to;
      var meta = rootNode.meta.data.packages[pkg.location];
      if (!meta) {
        throw new Error(`no meta for pkg.location ${pkg.location}`);
      }
      var isCycle = parentNames.has(name);
      // note: `type` is not portable
      const resultPkg = { name, version: pkg.version, spec: edge.spec, type: edge.type, resolved: pkg.resolved, integrity: meta.integrity, parents, isCycle, depth, edge, pkg, };
      onPkg(resultPkg);
      if (isCycle == false && pkg.edgesOut.size > 0) {
        // recurse
        thisFunction(pkg, onPkg, depth+1, [...parents, pkg], new Set([...parents, pkg.name]), rootNode);
      }
    }
  }
  walk(lockData, onPkg);
}



async function parse_lockfile_yarn({ lockfilePath, specObj, onPkg }) {

  const yarnModule = await import("@yarnpkg/lockfile");
  const yarn = yarnModule.default;
  // node_modules/@yarnpkg/lockfile/index.js
  var s = fs.readFileSync(lockfilePath, "utf8");
  var lockData = yarn.parse(s);
  if (lockData.type != 'success') {
    throw Error(`parse error in ${lockfilePath}`);
  }
  else {
    lockData = lockData.object;
  }
  var walk = function thisFunction(lockData, name, spec, onPkg, depth = 1, parentNames = new Set(), parents = []) {
    var node = lockData[`${name}@${spec}`];
    var isCycle = parentNames.has(name);
    var pkg = { name, spec, version: node.version, resolved: node.resolved, integrity: node.integrity, parentNames, parents, };
    onPkg(pkg);
    if (isCycle == false && node.dependencies) {
      for (const [n, v] of Object.entries(node.dependencies)) {
        thisFunction(lockData, n, v, onPkg, depth+1, new Set([...parentNames, name]), [...parents, pkg]);
      }
    }
  }
  for (const [name, version] of Object.entries(specObj)) {
    walk(lockData, name, version, onPkg);
  }
}



async function parse_lockfile_pnpm({ pkgPath, lockfilePath, specObj, onPkg }) {

  // TODO min or max?
  const minSatisfyingModule = await import('semver/ranges/min-satisfying.js');
  const minSatisfying = minSatisfyingModule.default;
  var resolveVersion = minSatisfying;

  const pnpm = await import("@pnpm/lockfile-file");
  // patched version of @pnpm/lockfile-file
  // https://github.com/pnpm/pnpm/pull/4494
  // patches/@pnpm+lockfile-file+5.0.0.patch

  var lockData = await pnpm.readWantedLockfile(pkgPath, {
    wantedVersion: pnpm_version,
    lockfilePath, // patched version of @pnpm/lockfile-file
  });
  // node_modules/@pnpm/lockfile-file/lib/read.js
  if (lockData == null) {
    throw new Error("pnpm parser returned null");
  }

  var workspaceDir = null;
  var workspacePackages = null;

  var walk = async function thisFunction(lockData, name, spec, onPkg, depth = 1, parentNames = new Set(), parents = [], versionCache = null) {
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
    //var version = resolveVersion(versionCache[name], spec);

    /*
    tmp/test/workspace-pnpm/pnpm/packages/plugin-commands-installation/package.json
      "dependencies": {
        "@pnpm/colorize-semver-diff": "^1.0.1",

    tmp/test/workspace-pnpm/pnpm/pnpm-lock.yaml
      /@pnpm/colorize-semver-diff/1.0.1:
      resolution: {integrity: sha512-qP4E7mzmCBhB4so6szszeIdVDrcKGTTCxBazCKoiPUG34xLha6r57zJuFBkTmD65i3TB7++lf3BwpQruUwf/BQ==}
      engines: {node: '>=10'}
      dependencies:
        chalk: 4.1.2
      dev: false
    */

    var version;
    var resolved = null;
    var integrity = null;
    if (spec.startsWith("workspace:")) {
      // TODO npm-resolver/src/index.ts
      // tryResolveFromWorkspace
      // tryResolveFromWorkspacePackages
      // -> workspacePackages
      // plugin-commands-rebuild/src/recursive.ts
      // import { arrayOfWorkspacePackagesToMap } from '@pnpm/find-workspace-packages'
      // pnpm/src/main.ts:    const allProjects = await findWorkspacePackages(wsDir, {
      if (!workspaceDir) {
        var findWorkspaceDir = require("@pnpm/find-workspace-dir").default;
        var findWorkspacePackages = require("@pnpm/find-workspace-packages").findWorkspacePackagesNoCheck;
        workspaceDir = await findWorkspaceDir();
        //console.log("workspaceDir", workspaceDir);
        workspacePackages = await findWorkspacePackages(workspaceDir);
        //console.log("workspacePackages", workspacePackages);
      }
      var specVersion = spec.slice(10); // remove "workspace:" prefix
      var pkgCandidates = workspacePackages.filter(p => p.manifest.name == name);
      var versionList = pkgCandidates.map(p => p.manifest.version);
      version = resolveVersion(versionList, specVersion);
      var p = pkgCandidates.find(p => p.manifest.version == version);
      var pDir = path.relative(pkgPath, p.dir);
      resolved = "file:" + pDir;
    }
    else {
      var versionList = versionCache[name];
      try {
        version = resolveVersion(versionList, spec);
      }
      catch (e) {
        console.log(`failed to resolve version. name: ${name}. spec: ${spec}. versionList: ${versionList}`)
        console.log(e);
        throw e;
      }
      var pkgKey = `/${name}/${version}`;
      // note: no special handling for scoped packages, for example @pnpm/logger
      var node = lockData.packages[pkgKey];
      var isCycle = parentNames.has(name);
      // note: the `resolved` URL is not stored in pnpm-lock.yaml (TODO verify)
      // note: `isDev` is not portable
      // note: devDependencies are not locked in pnpm-lock.yaml (TODO verify)
      integrity = node.resolution.integrity;
    }

    var pkg = { name, spec, version, resolved, integrity, parentNames, parents, };
    // , isDev: node.dev
    onPkg(pkg);
    if (isCycle == false && node.dependencies) {
      for (const [n, v] of Object.entries(node.dependencies)) {
        thisFunction(lockData, n, v, onPkg, depth+1, new Set([...parentNames, name]), [...parents, pkg], versionCache);
      }
    }
  }
  for (const [name, version] of Object.entries(specObj)) {
    await walk(lockData, name, version, onPkg);
  }
}



main();
