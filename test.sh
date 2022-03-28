#! /usr/bin/env bash

set -e # exit on error
set -x # xtrace

parselock="$(readlink -f parselock.js)"

mkdir tmp || true
(
  cd tmp
  mkdir test || true
  (
    cd test

    if false
    then
      # t = test name
      t=workspace-pnpm
      rm -rf $t || true # remove old files
      mkdir $t
      (
        cd workspace-pnpm
        # TODO find a smaller test case
        # 40 MB tgz file ...
        curl -L -o pnpm.tgz https://github.com/pnpm/pnpm/archive/cfe345b6d6efaa9ea196ff009e2404f07d79d54a.tar.gz
        tar xf pnpm.tgz
        mv pnpm-* pnpm
        cd pnpm
        #cd packages/plugin-commands-installation
        "$parselock" ./packages/plugin-commands-installation/ ./pnpm-lock.yaml >parselock.out
        hash___actual=$(sha1sum parselock.out | cut -d' ' -f1)
        hash_expected="ce7521224c002e36d1845bd737230ec9e5834186"
        [ "$hash___actual" = "$hash_expected" ] && echo ok
      ) # cd $t
    fi

    # t = test name
    t="cowsay@1.5.0"
    rm -rf $t || true # remove old files
    mkdir $t
    (
      cd $t

      # m = manager of packages
      for m in npm yarn pnpm
      do
        echo "m = $m"
        mkdir $m
        (
          cd $m
          #run_test $t $m
          $m init -y
          $m add $t
          rm -rf node_modules
          "$parselock" ./ >parselock.out
        ) # cd $m
      done # for m

      # now all the parselock.out files should be same
      find . -name parselock.out -print0 | xargs -0 diff --from-file && echo ok

      hash___actual=$(sha1sum npm/parselock.out | cut -d' ' -f1)
      hash_expected="96e83e0d312649edd4f852e154622d524710dd7a"
      [ "$hash___actual" = "$hash_expected" ] && echo ok

    ) # cd $t
  ) # cd test
) # cd temp
