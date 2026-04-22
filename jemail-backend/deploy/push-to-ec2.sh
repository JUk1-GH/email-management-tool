#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <ssh-key.pem> <user@host> [api-domain] [cors-origin]" >&2
  exit 1
fi

SSH_KEY="$1"
REMOTE="$2"
API_DOMAIN="${3:-api.example.com}"
CORS_ORIGIN="${4:-https://app.example.com}"
REMOTE_DIR="/opt/jemail-backend"
REMOTE_FRONTEND_DIR="$REMOTE_DIR/frontend-dist"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/var/lib/jemail}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
FRONTEND_DIST="${FRONTEND_DIST:-$REPO_DIR/_figma_source/dist}"

if [[ ! -f "$FRONTEND_DIST/index.html" ]]; then
  echo "Frontend dist not found at $FRONTEND_DIST" >&2
  echo "Build it first, e.g.:" >&2
  echo "  cd $REPO_DIR/_figma_source && npm run build" >&2
  exit 1
fi

rsync -az --delete \
  -e "ssh -i $SSH_KEY" \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  "$PROJECT_DIR/" "$REMOTE:/tmp/jemail-backend/"

rsync -az --delete \
  -e "ssh -i $SSH_KEY" \
  "$FRONTEND_DIST/" "$REMOTE:/tmp/jemail-frontend-dist/"

ssh -i "$SSH_KEY" "$REMOTE" "set -e
sudo mkdir -p $REMOTE_DIR
sudo rsync -a --delete --exclude '.env' --exclude '.venv' --exclude 'data' /tmp/jemail-backend/ $REMOTE_DIR/
sudo mkdir -p $REMOTE_FRONTEND_DIR
sudo rsync -a /tmp/jemail-frontend-dist/ $REMOTE_FRONTEND_DIR/
sudo chown -R \$(whoami):\$(whoami) $REMOTE_DIR
APP_DIR=$REMOTE_DIR FRONTEND_DIR=$REMOTE_FRONTEND_DIR APP_DATA_DIR=$REMOTE_DATA_DIR API_DOMAIN=$API_DOMAIN CORS_ORIGIN=$CORS_ORIGIN RUN_USER=\$(whoami) bash $REMOTE_DIR/deploy/provision-ubuntu-ec2.sh"
