#!/bin/sh
set -eu

script_dir="$(CDPATH='' cd -- "$(dirname "$0")" && pwd)"
project_dir="$(CDPATH='' cd -- "$script_dir/.." && pwd)"
node_bin="$("$script_dir/select-node.sh")"
vite_bin="$project_dir/node_modules/vite/bin/vite.js"

if [ ! -f "$vite_bin" ]; then
  echo "未找到 Vite 依赖。请先运行 ./scripts/npm.sh install" >&2
  exit 1
fi

if [ "${npm_node_execpath:-}" = "/Applications/Codex.app/Contents/Resources/node" ] && [ "$node_bin" != "${npm_node_execpath:-}" ]; then
  echo "检测到 Codex 内置 Node，已切换到: $node_bin" >&2
fi

cd "$project_dir"
exec "$node_bin" "$vite_bin" "$@"
