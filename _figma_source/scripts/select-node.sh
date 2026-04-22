#!/bin/sh
set -eu

CODEX_NODE="/Applications/Codex.app/Contents/Resources/node"

is_executable() {
  [ -n "${1:-}" ] && [ -x "$1" ]
}

is_codex_node() {
  [ "${1:-}" = "$CODEX_NODE" ]
}

choose_node() {
  if is_executable "${JEMAIL_NODE_BIN:-}"; then
    printf '%s\n' "$JEMAIL_NODE_BIN"
    return 0
  fi

  if is_executable "${npm_node_execpath:-}" && ! is_codex_node "${npm_node_execpath:-}"; then
    printf '%s\n' "$npm_node_execpath"
    return 0
  fi

  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if is_executable "$candidate" && ! is_codex_node "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  nvm_root="${NVM_DIR:-$HOME/.nvm}/versions/node"
  if [ -d "$nvm_root" ]; then
    nvm_node="$(find "$nvm_root" -path '*/bin/node' -type f 2>/dev/null | sort | tail -n 1 || true)"
    if is_executable "$nvm_node" && ! is_codex_node "$nvm_node"; then
      printf '%s\n' "$nvm_node"
      return 0
    fi
  fi

  if is_executable "${npm_node_execpath:-}"; then
    printf '%s\n' "$npm_node_execpath"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  return 1
}

if ! choose_node; then
  echo "未找到可用的 Node.js。请先安装 Homebrew Node 或 nvm Node，或设置 JEMAIL_NODE_BIN。" >&2
  exit 1
fi
