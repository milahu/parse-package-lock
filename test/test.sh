#! /usr/bin/env bash

set -e # exit on error
set -x # xtrace
set -o pipefail

printPackageLock="$(realpath "$(dirname "$0")"/../bin/print-package-lock.js)"

dir="$(dirname "$0")"/tmp/test

if true
then
  # t = test name
  t=workspace-pnpm
  #rm -rf $t || true # remove old files
  mkdir -p "$dir/$t" || true

    if [ -d "$dir/$t/pnpm" ]
    then
      echo using existing download of pnpm
    else
      # TODO find a smaller test case
      # 40 MB tgz file ...
      echo downloading pnpm
      curl -L -o "$dir/$t/pnpm.tgz" https://github.com/pnpm/pnpm/archive/cfe345b6d6efaa9ea196ff009e2404f07d79d54a.tar.gz
      tar xf "$dir/$t/pnpm.tgz" -C "$dir/$t/"
      mv "$dir/$t"/pnpm-* "$dir/$t/pnpm"
    fi
    "$printPackageLock" "$dir/$t/pnpm/packages/plugin-commands-installation/" "$dir/$t/pnpm/pnpm-lock.yaml" >"$dir/$t/printPackageLock.out"
    hash___actual=$(sha1sum "$dir/$t/printPackageLock.out" | cut -d' ' -f1)
    hash_expected="2c1b4441b4a488ee59d9ac26208589a9a06a5273"
    [ "$hash___actual" = "$hash_expected" ]
    echo ok
fi

# t = test name
t="cowsay@1.5.0"
#rm -rf $dir/$t || true # remove old files

# m = manager of packages
for m in npm yarn pnpm
do
  echo "m = $m"
  mkdir -p "$dir/$t/$m" || true
  #run_test $t $m
  if [ -e "$dir/$t/$m/package.json" ]
  then
    echo using existing lockfile
  else
    echo creating new lockfile
    ( cd "$dir/$t/$m" && $m init -y )
    ( cd "$dir/$t/$m" && $m add $t )
    rm -rf "$dir/$t/$m/node_modules"
  fi
  "$printPackageLock" "$dir/$t/$m/" >"$dir/$t/$m/printPackageLock.out"
done # for m

# now all the printPackageLock.out files should be same
diff --from-file "$dir/$t/npm/printPackageLock.out" "$dir/$t"/*/printPackageLock.out
echo ok

hash___actual=$(sha1sum "$dir/$t/npm/printPackageLock.out" | cut -d' ' -f1)
hash_expected="2d8367eb00dbc30bb0ba05651eeb3f8718f06a61"
[ "$hash___actual" = "$hash_expected" ]
echo ok

