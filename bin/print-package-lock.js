#! /usr/bin/env node

import { parsePackageLock, packageLockFilenames } from "../lib/parse-package-lock.js";

import fs from "fs";
import path from "path";

async function printPackageLock() {

  // demo: print the dependency tree
  var onPackage = function(pkg) {
    //console.log([...pkg.parents, pkg].map(node => `${node.name}@${node.version}`).join(" "), pkg.integrity || pkg.resolved);
    //console.log([...pkg.parents, pkg].map(node => `${node.name}@${node.version}`).join(" ") + ` + integrity ${pkg.integrity} + resolved ${pkg.resolved}`);
    // resolved is different for npm/yarn/pnpm
    // example:
    //   npm:    https://registry.npmjs.org/yargs/-/yargs-15.4.1.tgz
    //   yarn: https://registry.yarnpkg.com/yargs/-/yargs-15.4.1.tgz#0d87a16de01aee9d8bec2bfbf74f67851730f4f8
    //   pnpm: null
    if (pkg.resolved && pkg.resolved.startsWith("file:")) {
      console.log([...pkg.parents, pkg].map(node => `${node.name}@${node.version}`).join(" ") + ` + integrity ${pkg.integrity} + resolved ${pkg.resolved}`);
    }
    else {
      console.log([...pkg.parents, pkg].map(node => `${node.name}@${node.version}`).join(" ") + ` + integrity ${pkg.integrity}`);
    }
  };

  var onError = error => { error.message = "failed to resolve dependency: " + error.message; throw error; };

  //var onInfo = info => process.stderr.write(info + "\n");
  var onInfo = info => console.log(info);

  if (process.argv.length < 3 || 4 < process.argv.length) {
    process.stderr.write([
      "usage:",
      `  ${path.basename(process.argv[1])} path/to/package/ [path/to/lockfile]`,
      "",
      "lockfile can be:",
      ...packageLockFilenames.map(f => `  ${f}`)
    ].join("\n") + "\n");
    process.exit(1);
  }

  // all arguments are paths
  for (const argv_path of process.argv.slice(2)) {
    if (!fs.existsSync(argv_path)) {
      throw Error("not found path: " + argv_path);
    }
  }

  const packagePath = process.argv[2];
  
  const lockfilePath = process.argv[3] || null;

  /*
  var peerDependencies = true;
  var devDependencies = true; // yarn2: no, npmv7: yes
  */
  var peerDependencies = null;
  var devDependencies = null;
  await parsePackageLock({ packagePath, lockfilePath, onPackage, onError, onInfo, peerDependencies, devDependencies });
}

printPackageLock();
