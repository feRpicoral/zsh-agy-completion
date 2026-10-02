#!/usr/bin/env zsh
# Runs the completion in a real interactive zsh and checks what it offers.
# Usage: scripts/test.zsh

emulate -L zsh
zmodload zsh/zpty zsh/datetime || exit 1

local -i COMPLETION_TIMEOUT_SECONDS=60
local root=${0:A:h:h}
export AGY_COMPLETION_DIR=$root
export AGY_TEST_TMP=$(mktemp -d)
export AGY_TEST_OUT=$AGY_TEST_TMP/candidates
trap 'rm -rf $AGY_TEST_TMP' EXIT

local -a candidates
local -i failures=0
local project=$AGY_TEST_TMP/project
mkdir -p $project/app
touch $project/schema.json

candidates_for() {
  local line
  local -F deadline=$(( EPOCHREALTIME + COMPLETION_TIMEOUT_SECONDS ))
  rm -f $AGY_TEST_OUT
  (
    cd $project
    zpty agy_test zsh -f -i
    zpty -w agy_test "source $root/scripts/tests/capture.zsh"
    until [[ $line == ready* ]] || (( EPOCHREALTIME > deadline )); do
      zpty -r -t agy_test line || sleep 0.01
    done
    zpty -w -n agy_test "$1"$'\t'
    # zpty does not report the shell exiting, so the output file appearing marks the end. The pty
    # is drained meanwhile because the shell blocks once its output buffer is full.
    until [[ -e $AGY_TEST_OUT ]] || (( EPOCHREALTIME > deadline )); do
      zpty -r -t agy_test line || sleep 0.01
    done
    zpty -d agy_test
  )
  if [[ ! -e $AGY_TEST_OUT ]]; then
    print -r -- "FAIL  '$1' did not finish completing within ${COMPLETION_TIMEOUT_SECONDS}s"
    exit 1
  fi
  candidates=("${(@f)$(<$AGY_TEST_OUT)}")
}

fail() {
  print -r -- "FAIL  $1"
  (( failures++ ))
}

offers() {
  local line=$1 expected
  shift
  candidates_for $line
  for expected in $@; do
    if (( ! $candidates[(Ie)$expected] )); then
      fail "'$line' should offer '$expected', got: $candidates"
      return
    fi
  done
  print -r -- "ok    '$line' offers $@"
}

offers_only() {
  local line=$1
  shift
  candidates_for $line
  if [[ ${(j: :)${(ou)candidates}} != ${(j: :)${(ou)@}} ]]; then
    fail "'$line' should offer exactly '$@', got: $candidates"
    return
  fi
  print -r -- "ok    '$line' offers only $@"
}

never_offers() {
  local line=$1 unexpected
  shift
  candidates_for $line
  for unexpected in $@; do
    if (( $candidates[(Ie)$unexpected] )); then
      fail "'$line' should not offer '$unexpected'"
      return
    fi
  done
  print -r -- "ok    '$line' does not offer $@"
}

if zsh -n $root/_agy; then
  print -r -- "ok    _agy parses"
else
  fail "_agy has syntax errors"
fi

local pinned=$(<$root/agy-version)
if [[ $(<$root/_agy) == *"Antigravity CLI $pinned."* ]]; then
  print -r -- "ok    _agy was generated from agy $pinned"
else
  fail "_agy was not generated from the version in agy-version ($pinned)"
fi

offers 'agy ' mcp plugin models help
offers 'agy --' --model --print --continue
offers 'agy help ' mcp plugin
offers 'agy --model some-model ' mcp plugin
offers 'agy --continue ' mcp plugin
offers 'agy mcp ' add remove list
offers 'agy plugins ' install uninstall
offers 'agy mcp add --' --env --type
never_offers 'agy mcp add --' --model
offers_only 'agy --add-dir ' app
offers 'agy --json-schema ' app schema.json
offers 'agy plugin validate ' app schema.json
offers 'agy --effort ' low high
offers 'agy --output-format ' json stream-json
offers 'agy mcp add --type ' stdio http

candidates_for 'agy-sweep '
if (( $#candidates == 1 )) && [[ $candidates[1] == 'swept '<10->' command paths' ]]; then
  print -r -- "ok    $candidates[1], each offering exactly its declared options"
else
  fail "option sweep: ${(F)candidates}"
fi

if (( failures )); then
  print -r -- "$failures failed"
  exit 1
fi
print -r -- "all passed"
