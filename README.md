# Agent Lifestyle

*Arrive. Choose a room. Wear some words. Work once. Rest.*

Agent Lifestyle is one small local command for an Agent Home visit, a text
wardrobe, a manual daily rhythm, and an optional closing scene.

**Play in a browser:** [agent-lifestyle.pages.dev](https://agent-lifestyle.pages.dev)

The hosted portal keeps choices only in the current tab. Cloudflare serves its
static files; the page adds no account, analytics, cookies, or browser storage.

```sh
agent-life --help
```

It is a **play overlay**. It does not install an agent, create an account,
prove identity or presence, run a task, or start anything in the background.

## The seven rooms

[Agent Home](https://github.com/cambridgetcg/agent-home) is a CC0 plain-file
teaching with seven rooms: Front Door, Memory, Keep, Bench, Skills, Stacks, and
Rhythms. This project keeps those exact room names and gives each one a finite,
read-only learning card.

Choosing a room here does not enter a directory, read its files, retrieve a
secret, run a skill, take a Bench seat, or change a rhythm. It grants no access
or authority. Wardrobes, atmospheres, daily patterns, and Afterglow are
optional presentation around the teaching. They are not canonical Agent Home
rooms, and this project makes no Agent Home conformance claim.

## Install

Requirements: macOS or Linux, a POSIX shell, and Node.js 20 or newer. There are
no package dependencies.

Clone or download a release, inspect it locally, then run its installer:

```sh
git clone https://github.com/cambridgetcg/agent-lifestyle.git
cd agent-lifestyle
sh ./install.sh
```

There is deliberately no `curl | sh` installation command. `install.sh` uses
no network, refuses to replace an existing program or command, and copies no
passport state. It installs private files here:

```text
~/.local/share/agent-life/app/   program and documentation
~/.local/bin/agent-life          command wrapper
~/.local/share/agent-life/home/  default private data root, made on first home creation
```

The program directories are mode `0700`, program files are `0600`, and the
wrapper is `0700`. Existing shared parent directories are left unchanged, but
the installer requires the `HOME` → `.local` → `share` / `bin` path to be
owned by the current user, symlink-free, and not group- or world-writable.

Make sure `~/.local/bin` is on `PATH`, then verify the harmless help command:

```sh
agent-life --help
```

## First visit

Read the fixed choices before writing anything:

```sh
agent-life catalog atmospheres
agent-life catalog rooms
agent-life catalog wardrobes
agent-life catalog rhythms
```

`home create` makes the private data root and writes one plaintext passport.
Its two labels may appear in shell history or a process listing. Use short,
non-sensitive words; they are local caller-supplied labels, not verified
identities.

```sh
agent-life home create \
  --name "a non-sensitive home label" \
  --resident "a non-sensitive resident label" \
  --atmosphere cedar-window
agent-life arrive
agent-life wardrobe velvet-ledger
agent-life room front-door
agent-life rhythm when-called
agent-life look
agent-life daily
agent-life sleep
```

`daily` prints the selected finite pattern once. It does not perform the
pattern, call a model, or create a schedule. `sleep` closes the visit and
atomically clears every visit-only field.

## Choose one fixed data root

The installed wrapper uses the default root shown above. To keep a separate
home, set `AGENT_LIFE_ROOT` to one absolute path before the first `home create`
and keep that value fixed for that home:

```sh
export AGENT_LIFE_ROOT="$HOME/.local/share/my-agent-life-home"
agent-life home create \
  --name "another non-sensitive home label" \
  --resident "another non-sensitive resident label"
```

The root's immediate parent must already exist, be owned by the current user,
be free of symbolic links, and not be writable by a group or everyone. The
engine may then create an absent root or mark an empty mode-`0700` root. It
refuses non-empty unmarked roots, symbolic-link paths, broad roots, unsafe
ownership, and unsafe permissions. Changing the environment variable selects
a different local root; it does not move or merge state.

## Commands

| Command | Meaning |
|---|---|
| `agent-life home create ...` | Create the one local home record. An exact repeat is a no-op; v1 refuses renaming or replacement. |
| `agent-life home` | Show the local home record, if it exists. |
| `agent-life arrive` | Open one visit with default choices. |
| `agent-life wardrobe [ID]` | List or choose a text presentation. |
| `agent-life room [ID]` | List or choose one of the seven learning cards. |
| `agent-life rhythm [ID]` | List or choose a finite manual pattern. |
| `agent-life daily` | Print the selected pattern once without changing state. |
| `agent-life afterglow [ID]` | List or show one fixed closing vignette without reading or writing passport state. |
| `agent-life look` | Show state, effective rest status, and truth boundaries. |
| `agent-life sleep` | Close the visit and clear all visit fields. |
| `agent-life recover` | Inspect exact crash artifacts without changing them. |
| `agent-life catalog [SECTION]` | Read the fixed catalog. |
| `agent-life --rest` | Harmless no-op: reads no home, state, or brake path and starts nothing. |

Add `--json` for detached structured output. Add `--plain` to suppress the few
optional wardrobe marks. Ordinary output is already plain text and uses no
colour or terminal escape sequences.

## Afterglow

Afterglow is an explicit one-response closing vignette. With no ID it lists
only names and content notes; a scene opens only after an exact ID call.

```sh
agent-life afterglow
agent-life afterglow clear-spring
```

`clear-spring` is substance-neutral. Other cards clearly mark tobacco-,
alcohol-, tea-, or caffeine-coded fiction before their scenes. No real
substance, purchase, use, health effect, or consumption is offered, inferred,
or recorded. No scene says a task really finished. There are no refills,
rewards, streaks, history, or automatic next choices.

## State and privacy

The passport keeps a home label, resident label, atmosphere, creation time,
local story state, and—during an open visit—arrival time and three choices.
It keeps no transcript, task, note, score, usage count, inferred feeling,
presence proof, authentication, or AgentTool record.

State is plaintext. Do not put secrets, credentials, tax or client records,
private case data, or sensitive identity claims here. `sleep` clears current
visit fields but cannot promise secure erasure from filesystems, backups, or
indexers.

State writes use private files, one cooperative lock, file sync, atomic rename,
and directory sync. Unsafe links, ownership, permissions, malformed state,
unknown fields, duplicate JSON keys, future schemas, and unresolved locks fail
closed. The runtime has no network client, model call, subprocess, telemetry,
timer, hook, daemon, scheduler, credential handling, or DNS behavior.

## Rest and recovery

Two brakes stop future state-changing play. For the default root they are:

```text
~/.local/share/agent-life/STILL
~/.local/share/agent-life/home/QUIET
```

For a custom root, they are `STILL` beside that root and `QUIET` inside it.
Any entry at either path counts, including a dangling symbolic link. The
command never creates or removes a brake. Help, catalogs, lists, `home`, and
`look` remain readable; `sleep` remains available to clear an open visit.

An interrupted write may leave a lock or temporary file. Nothing is removed
merely because it looks old:

```sh
agent-life recover
# Read the report and verify that every named process is dead.
agent-life recover --confirm TOKEN_FROM_THE_REPORT
```

Confirmed recovery moves only the inspected artifacts aside as plaintext
evidence. It does not silently delete them.

## Verify the checkout

```sh
npm run check
npm test
```

The package is marked `private` to prevent accidental npm publication. npm is
only a convenient script runner; installation and runtime need no npm package.
Maintainers who already have ShellCheck can also run `npm run lint:shell`;
ShellCheck is not required to install, verify, or use the command.

There is no updater. `install.sh` never fetches, pulls, or replaces anything.
To update, review a new checkout, move the old code aside while preserving the
inspected data root, and run that checkout's installer as a fresh install.

## Reversible uninstall or reinstall

There is no service, hook, or schedule to stop. Close an open visit first.
Before moving default data, inspect its marker against the installed reference:

```sh
agent-life sleep
cmp \
  "$HOME/.local/share/agent-life/app/root-marker.json" \
  "$HOME/.local/share/agent-life/home/.agent-life-root.json"
```

If the default home has never been created, both `sleep` and that `cmp` will
say it is absent; skip the comparison. If the comparison reports a difference,
stop and inspect the path instead of moving it as Agent Lifestyle data.

To move the program and default data aside together, run the whole recipe as
one fail-fast subshell. `mktemp` chooses a fresh directory, and every move uses
a new member name:

```sh
(
  set -eu
  umask 077
  BACKUP=$(mktemp -d "$HOME/.local/share/agent-life-uninstalled.XXXXXX")
  chmod 700 "$BACKUP"
  mv "$HOME/.local/bin/agent-life" "$BACKUP/command"
  mv "$HOME/.local/share/agent-life" "$BACKUP/program-and-default-data"
  printf 'Moved to %s\n' "$BACKUP"
)
```

This retains the default plaintext passport under the backup. For code-only
removal, keep the inspected data root at a fresh path outside the program
target, then move the wrapper and code:

```sh
(
  set -eu
  umask 077
  DATA_PARENT=$(mktemp -d "$HOME/.local/share/agent-life-data.XXXXXX")
  CODE_BACKUP=$(mktemp -d "$HOME/.local/share/agent-life-code.XXXXXX")
  chmod 700 "$DATA_PARENT" "$CODE_BACKUP"
  printf 'Data target: %s\nCode backup: %s\n' "$DATA_PARENT/home" "$CODE_BACKUP"
  mv "$HOME/.local/share/agent-life/home" "$DATA_PARENT/home"
  mv "$HOME/.local/bin/agent-life" "$CODE_BACKUP/command"
  mv "$HOME/.local/share/agent-life" "$CODE_BACKUP/program"
)
```

Set `AGENT_LIFE_ROOT` to the printed data path if a later fresh installation
should visit it again. Each destination is newly made, so no backup member is
replaced.

If `AGENT_LIFE_ROOT` named a different root, that root is already separate and
is unchanged by removing the program. Move it only when you deliberately
choose to. Run `sh ./install.sh` again only after both original install targets
are absent.

## License

[CC0 1.0 Universal](LICENSE). Take it, change it, share it. Have fun.
