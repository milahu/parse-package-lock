#! /usr/bin/env node

import { parsePackageLock, packageLockFilenames } from "../lib/parse-package-lock.js";

import fs from "fs";
import path from "path";

async function printPackageLock() {

  // demo: print the dependency tree
  var onPackage = function(pkg) {
    console.log([...pkg.parents, pkg].map(node => `${node.name}@${node.version}`).join(" "), pkg.integrity || pkg.resolved);
  };

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

  await parsePackageLock({ packagePath, lockfilePath, onPackage });
}

printPackageLock();
