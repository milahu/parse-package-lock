#! /usr/bin/env bash

set -e # exit on error
set -o pipefail # exit on error
set -x # xtrace

cd "$(dirname "$0")"/../

printPackageLock="./bin/print-package-lock.js"

dir="$(dirname "$0")"/tmp/test

if true
then
  # t = test name
  t=workspace-pnpm
  #rm -rf $t || true # remove old files
  mkdir -p "$dir/$t" || true

    # TODO remove indent
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
    hash_expected="9e80c55f828bbb101692b6261b6767eebb4f8fcf"
    [ "$hash___actual" = "$hash_expected" ]
    echo ok
fi

if true
then
  # t = test name
  t=workspace-npm
  #rm -rf $t || true # remove old files
  mkdir -p "$dir/$t" || true
  if [ -d "$dir/$t/npm" ]
  then
    echo using existing download of npm
  else
    # TODO find a smaller test case
    # 90 MB tgz file ...
    echo downloading npm
    curl -L -o "$dir/$t/npm.tgz" https://github.com/npm/cli/archive/b48a2bfde3745fa21ea4fc18d6f562fd82f82545.tar.gz
    tar xf "$dir/$t/npm.tgz" -C "$dir/$t/"
    mv "$dir/$t"/cli-* "$dir/$t/npm"
  fi
  "$printPackageLock" "$dir/$t/npm/workspaces/arborist/" "$dir/$t/npm/package-lock.json" >"$dir/$t/printPackageLock.out"
  hash___actual=$(sha1sum "$dir/$t/printPackageLock.out" | cut -d' ' -f1)
  hash_expected="881f096b6e7f83db06a8f2f525e6879366b1e443"
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

for f in "$dir/$t"/*/printPackageLock.out
do
  [ "$(dirname "$f")" = "$dir/$t/npm" ] && continue
  diff -q "$dir/$t/npm/printPackageLock.out" "$f" || {
    # print command for manual inspection
    echo "diff -u $f $dir/$t/npm/printPackageLock.out --color=always | less -S"
  }
done

# now all the printPackageLock.out files should be same
diff -q --from-file "$dir/$t/npm/printPackageLock.out" "$dir/$t"/*/printPackageLock.out
echo ok

hash___actual=$(sha1sum "$dir/$t/npm/printPackageLock.out" | cut -d' ' -f1)
hash_expected="523657547e8c214c19dfae92af4b58ab84cecfa5"
[ "$hash___actual" = "$hash_expected" ]
echo ok

