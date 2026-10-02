# Sourced inside the throwaway interactive shell that scripts/test.zsh drives through a pty.
# The first TAB runs one completion, writes every offered candidate to $AGY_TEST_OUT and exits.

PROMPT=
fpath=($AGY_COMPLETION_DIR ${0:A:h} $fpath)
autoload -Uz compinit
compinit -u -d $AGY_TEST_TMP/zcompdump
bindkey '^I' complete-word

typeset -ga agy_test_output

compadd() {
  # -O, -A and -D only fill arrays for the caller and add no matches.
  if [[ ${@[1,(i)(-|--)]} == *-(O|A|D)\ * ]]; then
    builtin compadd "$@"
    return
  fi
  local -a hits
  builtin compadd -A hits "$@"
  agy_test_output+=($hits)
  builtin compadd "$@"
}

agy_test_finish() {
  # The runner treats the file appearing as "done", so it must never see it half written.
  print -rl -- $agy_test_output > $AGY_TEST_OUT.partial
  mv $AGY_TEST_OUT.partial $AGY_TEST_OUT
  exit
}
comppostfuncs=(agy_test_finish)

print ready
