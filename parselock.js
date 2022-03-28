#! /usr/bin/env node

// parselock.js
// parse lockfile to deep tree of dependencies

// cycles are handled by passing `isCycle: true|false` to the callback function
// recursion stops when `isCycle == true`

// TODO unify interface: `type` and `isDev`

var fs = require("fs");
const path = require("path");

const pnpm_version = "6.32.3"; // TODO update

const lockfile_candidates = [
  "package-lock.json", // highest precedence
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
];



async function main() {

  // demo: print the dependency tree
  var onPkg = function(pkg) {
    console.log([...pkg.parents, pkg].map(node => `${node.name}@${node.version}`).join(" "), pkg.integrity);
  };

  if (process.argv.length < 3) {
    process.stderr.write([
      "usage:",
      `  ${path.basename(process.argv[1])} path [path...]`,
      "",
      "path can be:",
      "  path to package directory, which contains package.json and a lockfile",
      "  path to a lockfile (useful if multiple lockfile exist)",
      "",
      "lockfile can be:",
      ...lockfile_candidates.map(f => `  ${f}`)
    ].join("\n") + "\n");
    process.exit(1);
  }

  for (const argv_path of process.argv.slice(2)) {
    if (!fs.existsSync(argv_path)) {
      throw Error("not found path: " + argv_path);
    }
    var path_stats = fs.statSync(argv_path);
    const pkgPath = path_stats.isFile() ? path.dirname(argv_path) : argv_path;
    const lockfile_path = path_stats.isFile() ? argv_path : (
      (function () {
        // argv_path is directory
        // guess path of lockfile
        const lockfile_candidates_set = new Set(lockfile_candidates);

        var lockfile_set = new Set(fs.readdirSync(argv_path).filter(filename => lockfile_candidates_set.has(filename)));
        const lockfile_name = lockfile_candidates.find(filename => lockfile_set.has(filename));
        if (!lockfile_name) {
          throw new Error("not found lockfile in " + argv_path);
        }
        const lockfile_path = path.join(argv_path, lockfile_name);
        //console.log(`found lockfile ${lockfile_path}`)
        return lockfile_path;
      })()
    );

    await parse_lockfile({ pkgPath, lockfile_path, onPkg });
  }
}



async function parse_lockfile({ pkgPath, lockfile_path, onPkg }) {

  const package_json = fs.readFileSync(path.join(pkgPath, "package.json"), "utf8");
  //const lockfile_content = fs.readFileSync(lockfile_path, "utf8");
  const lockfile_name = path.basename(lockfile_path);

  var package_data = JSON.parse(package_json);
  var specObj = {
    ...package_data.peerDependencies, // since npmv7, missing peerDependencies are installed
    ...package_data.devDependencies,
    ...package_data.dependencies, // highest precedence
  };
  console.log("declared dependencies:");
  for ([name, version] of Object.entries(specObj)) {
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
  return await lockfile_parser({ pkgPath, lockfile_path, specObj, onPkg });
}



async function parse_lockfile_npm({ pkgPath, onPkg }) {

  var npm = require("@npmcli/arborist");
  // https://www.npmjs.com/package/@npmcli/arborist
  var arb = new npm({ path: pkgPath });
  //var lockData = await arb.loadVirtual(); // load virtual tree
  var lockData = await arb.buildIdealTree({
    legacyBundling: true,
    // Nest every dep under the node requiring it, npm v2 style.
    // No unnecessary deduplication.
  });
  var walk = function thisFunction(pkg, onPkg, depth = 0, parents = [], parentNames = new Set(), rootNode = null) {
    if (!pkg.children) return;
    if (!rootNode) rootNode = pkg; // only rootNode has pkg.meta
    for ([name, edge] of pkg.edgesOut.entries()) {
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



async function parse_lockfile_yarn({ pkgPath, lockfile_path, specObj, onPkg }) {

  var yarn = require("@yarnpkg/lockfile");
  // node_modules/@yarnpkg/lockfile/index.js
  var s = fs.readFileSync(lockfile_path, "utf8");
  var lockData = yarn.parse(s);
  if (lockData.type != 'success') {
    throw Error(`parse error in yarn.lock in ${pkgPath}`);
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
      for ([n, v] of Object.entries(node.dependencies)) {
        thisFunction(lockData, n, v, onPkg, depth+1, new Set([...parentNames, name]), [...parents, pkg]);
      }
    }
  }
  for ([name, version] of Object.entries(specObj)) {
    walk(lockData, name, version, onPkg);
  }
}



async function parse_lockfile_pnpm({ pkgPath, specObj, onPkg }) {

  // TODO min or max?
  const semverMinSatisfying = require('semver/ranges/min-satisfying')
  //const semverMaxSatisfying = require('semver/ranges/max-satisfying')
  var resolveVersion = semverMinSatisfying;

  var pnpm = require("@pnpm/lockfile-file");
  var lockData = await pnpm.readWantedLockfile(pkgPath, { wantedVersion: pnpm_version });
  // node_modules/@pnpm/lockfile-file/lib/read.js

  var walk = function thisFunction(lockData, name, spec, onPkg, depth = 1, parentNames = new Set(), parents = [], versionCache = null) {
    if (!versionCache) {
      // build lists of version candidates
      // so we can map "spec" to "version" via resolveVersion
      versionCache = {};
      for (var nv of Object.keys(lockData.packages)) {
        var [scope, pkgName, version] = nv.split("/");
        if (scope) pkgName = `${scope}/${pkgName}`;
        if (!versionCache[pkgName]) versionCache[pkgName] = []; // list of version candidates
        versionCache[pkgName].push(version);
      }
    }
    var resVersion = resolveVersion(versionCache[name], spec);
    var node = lockData.packages[`/${name}/${resVersion}`]; // TODO handle scoped packages, for example @pnpm/logger
    var isCycle = parentNames.has(name);
    // note: the `resolved` URL is not stored in pnpm-lock.yaml (TODO verify)
    // note: `isDev` is not portable
    var pkg = { name, spec, version: resVersion, resolved: null, integrity: node.resolution.integrity, parentNames, parents, isDev: node.dev, };
    onPkg(pkg);
    if (isCycle == false && node.dependencies) {
      for ([n, v] of Object.entries(node.dependencies)) {
        thisFunction(lockData, n, v, onPkg, depth+1, new Set([...parentNames, name]), [...parents, pkg], versionCache);
      }
    }
  }
  for ([name, version] of Object.entries(specObj)) {
    walk(lockData, name, version, onPkg);
  }
}



main();
