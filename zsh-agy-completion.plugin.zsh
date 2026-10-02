# https://wiki.zshell.dev/community/zsh_plugin_standard#zero-handling
0="${ZERO:-${${0:#$ZSH_ARGZERO}:-${(%):-%N}}}"
0="${${(M)0:#/*}:-$PWD/$0}"

if (( ! ${fpath[(Ie)${0:h}]} )); then
  fpath=("${0:h}" $fpath)
fi

# Plugin managers that source plugins after compinit has run never rescan fpath.
if (( $+functions[compdef] )); then
  autoload -Uz _agy
  compdef _agy agy
fi
