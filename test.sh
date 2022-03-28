#! /bin/sh

set -e # exit on error
set -x # xtrace

parselock="$(readlink -f parselock.js)"

mkdir tmp || true
(
  cd tmp
  mkdir test || true
  (
    cd test

    # t = test name
    t=cowsay
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

          $m init -y
          $m add $t
          rm -rf node_modules

          "$parselock" ./ >parselock.out
        ) # cd $m
      done # for m

      # now all the parselock.out files should be same
      # expected result is in npm/parselock.out
      diff --from-file npm/parselock.out */parselock.out && echo ok

    ) # cd $t
  ) # cd test
) # cd temp
