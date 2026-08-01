#!/bin/sh

# Install Agent Lifestyle from a local checkout. This script performs no
# network access and refuses to replace either an existing app or command.

set -eu
umask 077

say_error() {
  printf '%s\n' "agent-life install: $*" >&2
}

fail() {
  say_error "$*"
  exit 1
}

validate_private_directory() {
  candidate_directory=$1
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const candidate = process.argv[1];
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    const status = fs.lstatSync(candidate);
    if (!status.isDirectory() || status.isSymbolicLink()) process.exit(1);
    if (uid !== null && status.uid !== uid) process.exit(1);
    if ((status.mode & 0o022) !== 0) process.exit(1);
    if (fs.realpathSync(candidate) !== path.resolve(candidate)) process.exit(1);
  ' "$candidate_directory" ||
    fail "unsafe install directory: $candidate_directory"
}

if [ -z "${HOME:-}" ] || [ "$HOME" = "/" ]; then
  fail 'HOME must name a user home directory.'
fi

case $HOME in
  /*) ;;
  *) fail 'HOME must be an absolute path.' ;;
esac

case $(uname -s 2>/dev/null || true) in
  Darwin|Linux) ;;
  *) fail 'this installer supports macOS and Linux.' ;;
esac

command -v node >/dev/null 2>&1 || fail 'Node.js 20 or newer is required.'
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) ||
  fail 'Node.js could not report its version.'
case $NODE_MAJOR in
  ''|*[!0-9]*) fail 'Node.js reported an invalid version.' ;;
esac
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js 20 or newer is required; found major version $NODE_MAJOR."
fi

node -e '
  const value = process.argv[1];
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)) process.exit(1);
' "$HOME" || fail 'HOME must name one visible absolute user-home path.'

validate_private_directory "$HOME"

SCRIPT_DIR=$(
  unset CDPATH
  cd -- "$(dirname -- "$0")" && pwd -P
) ||
  fail 'the checkout directory could not be resolved.'

for REQUIRED in \
  agent-life.mjs \
  public/catalog.mjs \
  bin/agent-life \
  root-marker.json \
  README.md \
  LICENSE
do
  if [ ! -f "$SCRIPT_DIR/$REQUIRED" ] || [ -L "$SCRIPT_DIR/$REQUIRED" ]; then
    fail "required regular file is missing or unsafe: $REQUIRED"
  fi
done

node -e '
  const fs = require("node:fs");
  const expected = "{\n" +
    "  \"schema\": \"local-agent-lifestyle-root/1\",\n" +
    "  \"purpose\": \"One local Agent Lifestyle play-overlay state root.\"\n" +
    "}\n";
  if (fs.readFileSync(process.argv[1], "utf8") !== expected) process.exit(1);
' "$SCRIPT_DIR/root-marker.json" 2>/dev/null ||
  fail 'root-marker.json does not exactly match the engine root marker.'

LOCAL_DIR=$HOME/.local
SHARE_DIR=$LOCAL_DIR/share
BIN_DIR=$LOCAL_DIR/bin
BASE_DIR=$SHARE_DIR/agent-life
APP_DIR=$BASE_DIR/app
WRAPPER=$BIN_DIR/agent-life

if [ -e "$BASE_DIR" ] || [ -L "$BASE_DIR" ]; then
  fail "refusing to replace existing target: $BASE_DIR"
fi
if [ -e "$WRAPPER" ] || [ -L "$WRAPPER" ]; then
  fail "refusing to replace existing command: $WRAPPER"
fi

for DIRECTORY in "$LOCAL_DIR" "$SHARE_DIR" "$BIN_DIR"; do
  if [ -e "$DIRECTORY" ] || [ -L "$DIRECTORY" ]; then
    [ -d "$DIRECTORY" ] && [ ! -L "$DIRECTORY" ] ||
      fail "required parent is not a plain directory: $DIRECTORY"
  else
    mkdir -m 700 "$DIRECTORY" || fail "could not create: $DIRECTORY"
  fi
  validate_private_directory "$DIRECTORY"
done

APP_STAGE=
WRAPPER_STAGE=
APP_RESERVED=0
WRAPPER_PUBLISHED=0
INSTALL_COMPLETE=0

remove_if_ours() {
  installed_path=$1
  staged_path=$2
  if [ -e "$installed_path" ] && [ -e "$staged_path" ] &&
    [ "$installed_path" -ef "$staged_path" ]; then
    rm "$installed_path"
  fi
}

cleanup_install() {
  install_status=$?
  set +e

  if [ "$INSTALL_COMPLETE" -ne 1 ]; then
    if [ "$WRAPPER_PUBLISHED" -eq 1 ]; then
      remove_if_ours "$WRAPPER" "$WRAPPER_STAGE"
    fi
    if [ "$APP_RESERVED" -eq 1 ]; then
      remove_if_ours "$APP_DIR/agent-life.mjs" "$APP_STAGE/agent-life.mjs"
      remove_if_ours "$APP_DIR/public/catalog.mjs" "$APP_STAGE/public/catalog.mjs"
      remove_if_ours "$APP_DIR/root-marker.json" "$APP_STAGE/root-marker.json"
      remove_if_ours "$APP_DIR/README.md" "$APP_STAGE/README.md"
      remove_if_ours "$APP_DIR/LICENSE" "$APP_STAGE/LICENSE"
      rmdir "$APP_DIR/public" 2>/dev/null
      rmdir "$APP_DIR" 2>/dev/null
      rmdir "$BASE_DIR" 2>/dev/null
    fi
  fi

  if [ -n "$WRAPPER_STAGE" ] && [ -e "$WRAPPER_STAGE" ]; then
    rm "$WRAPPER_STAGE"
  fi
  if [ -n "$APP_STAGE" ] && [ -d "$APP_STAGE" ]; then
    if [ -e "$APP_STAGE/agent-life.mjs" ]; then rm "$APP_STAGE/agent-life.mjs"; fi
    if [ -e "$APP_STAGE/public/catalog.mjs" ]; then rm "$APP_STAGE/public/catalog.mjs"; fi
    if [ -e "$APP_STAGE/root-marker.json" ]; then rm "$APP_STAGE/root-marker.json"; fi
    if [ -e "$APP_STAGE/README.md" ]; then rm "$APP_STAGE/README.md"; fi
    if [ -e "$APP_STAGE/LICENSE" ]; then rm "$APP_STAGE/LICENSE"; fi
    rmdir "$APP_STAGE/public" 2>/dev/null
    rmdir "$APP_STAGE" 2>/dev/null
  fi

  trap - EXIT HUP INT TERM
  exit "$install_status"
}

trap cleanup_install EXIT
trap 'exit 1' HUP INT TERM

APP_STAGE=$(mktemp -d "$SHARE_DIR/.agent-life-install.XXXXXX") ||
  fail 'could not prepare a private program staging directory.'
chmod 700 "$APP_STAGE"
mkdir -m 700 "$APP_STAGE/public"

cp "$SCRIPT_DIR/agent-life.mjs" "$APP_STAGE/agent-life.mjs"
cp "$SCRIPT_DIR/public/catalog.mjs" "$APP_STAGE/public/catalog.mjs"
cp "$SCRIPT_DIR/root-marker.json" "$APP_STAGE/root-marker.json"
cp "$SCRIPT_DIR/README.md" "$APP_STAGE/README.md"
cp "$SCRIPT_DIR/LICENSE" "$APP_STAGE/LICENSE"
chmod 600 \
  "$APP_STAGE/agent-life.mjs" \
  "$APP_STAGE/public/catalog.mjs" \
  "$APP_STAGE/root-marker.json" \
  "$APP_STAGE/README.md" \
  "$APP_STAGE/LICENSE"

WRAPPER_STAGE=$(mktemp "$BIN_DIR/.agent-life-install.XXXXXX") ||
  fail 'could not prepare a private command staging file.'
cp "$SCRIPT_DIR/bin/agent-life" "$WRAPPER_STAGE"
chmod 700 "$WRAPPER_STAGE"

cmp "$SCRIPT_DIR/agent-life.mjs" "$APP_STAGE/agent-life.mjs" >/dev/null
cmp "$SCRIPT_DIR/public/catalog.mjs" "$APP_STAGE/public/catalog.mjs" >/dev/null
cmp "$SCRIPT_DIR/root-marker.json" "$APP_STAGE/root-marker.json" >/dev/null
cmp "$SCRIPT_DIR/README.md" "$APP_STAGE/README.md" >/dev/null
cmp "$SCRIPT_DIR/LICENSE" "$APP_STAGE/LICENSE" >/dev/null
cmp "$SCRIPT_DIR/bin/agent-life" "$WRAPPER_STAGE" >/dev/null
node --check "$APP_STAGE/agent-life.mjs" >/dev/null
node --check "$APP_STAGE/public/catalog.mjs" >/dev/null
sh -n "$WRAPPER_STAGE"
AGENT_LIFE_ROOT="$APP_STAGE/home" node "$APP_STAGE/agent-life.mjs" --help >/dev/null
test ! -e "$APP_STAGE/home"

if [ -e "$BASE_DIR" ] || [ -L "$BASE_DIR" ]; then
  fail "refusing to replace target created during installation: $BASE_DIR"
fi
if [ -e "$WRAPPER" ] || [ -L "$WRAPPER" ]; then
  fail "refusing to replace command created during installation: $WRAPPER"
fi

APP_RESERVED=1
if ! mkdir -m 700 "$BASE_DIR"; then
  APP_RESERVED=0
  fail "could not reserve without replacing: $BASE_DIR"
fi
mkdir -m 700 "$APP_DIR" || fail 'could not reserve the program directory.'
mkdir -m 700 "$APP_DIR/public" || fail 'could not reserve the catalog directory.'

ln "$APP_STAGE/agent-life.mjs" "$APP_DIR/agent-life.mjs"
ln "$APP_STAGE/public/catalog.mjs" "$APP_DIR/public/catalog.mjs"
ln "$APP_STAGE/root-marker.json" "$APP_DIR/root-marker.json"
ln "$APP_STAGE/README.md" "$APP_DIR/README.md"
ln "$APP_STAGE/LICENSE" "$APP_DIR/LICENSE"

node -e '
  const fs = require("node:fs");
  const expected = [
    [process.argv[1], 0o700],
    [process.argv[2], 0o700],
    [process.argv[3], 0o700],
    [process.argv[4], 0o600],
    [process.argv[5], 0o600],
    [process.argv[6], 0o600],
    [process.argv[7], 0o600],
    [process.argv[8], 0o600],
  ];
  for (const [path, mode] of expected) {
    const actual = fs.lstatSync(path);
    if (actual.isSymbolicLink() || (actual.mode & 0o7777) !== mode) process.exit(1);
  }
' \
  "$BASE_DIR" \
  "$APP_DIR" \
  "$APP_DIR/public" \
  "$APP_DIR/agent-life.mjs" \
  "$APP_DIR/public/catalog.mjs" \
  "$APP_DIR/root-marker.json" \
  "$APP_DIR/README.md" \
  "$APP_DIR/LICENSE" || fail 'the staged program did not keep exact private modes.'

WRAPPER_PUBLISHED=1
if ! ln "$WRAPPER_STAGE" "$WRAPPER"; then
  WRAPPER_PUBLISHED=0
  fail "refusing to replace command created during installation: $WRAPPER"
fi
INSTALL_COMPLETE=1

printf '%s\n' \
  'Agent Lifestyle is installed.' \
  "Command: $WRAPPER" \
  "Program: $APP_DIR" \
  "Default private data root: $BASE_DIR/home" \
  '' \
  'No passport state was copied or created.' \
  'Run agent-life --help, then create a home when you choose.'
