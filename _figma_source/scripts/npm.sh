#!/bin/sh
set -eu

script_dir="$(CDPATH='' cd -- "$(dirname "$0")" && pwd)"
project_dir="$(CDPATH='' cd -- "$script_dir/.." && pwd)"
node_bin="$("$script_dir/select-node.sh")"
npm_bin="$(dirname "$node_bin")/npm"

if [ ! -x "$npm_bin" ]; then
  echo "未找到与 $node_bin 配套的 npm。请设置 JEMAIL_NODE_BIN 到带 npm 的 Node 安装路径。" >&2
  exit 1
fi

cd "$project_dir"
exec "$npm_bin" "$@"
