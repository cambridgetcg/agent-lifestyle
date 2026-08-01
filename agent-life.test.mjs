import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AFTERGLOWS,
  ATMOSPHERES,
  RHYTHMS,
  ROOMS,
  WARDROBES,
} from "./public/catalog.mjs";
import {
  brakeStatus,
  ensureRoot,
  execute,
  initializeRoot,
  readState,
  render,
  runCli,
  validateState,
} from "./agent-life.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const engine = join(here, "agent-life.mjs");
const installer = join(here, "install.sh");
const FIXED_TIME = "2026-08-01T14:00:00.000Z";

function fixedNow() {
  return new Date(FIXED_TIME);
}

function temporaryRoot() {
  const parent = mkdtempSync(join(homedir(), ".agent-life-test-"));
  const root = join(parent, "root");
  initializeRoot(root);
  return {
    parent,
    root,
    cleanup() {
      rmSync(parent, { force: true, recursive: true });
    },
  };
}

function createHome(root, extra = []) {
  return execute(
    [
      "home",
      "create",
      "--name",
      "Test Home",
      "--resident",
      "Test resident",
      "--atmosphere",
      "cedar-window",
      ...extra,
    ],
    { root, now: fixedNow },
  );
}

function stateBytes(root) {
  return readFileSync(join(root, "state.json"));
}

function memoryStream() {
  let content = "";
  return {
    write(chunk) {
      content += chunk;
    },
    read() {
      return content;
    },
  };
}

function leftovers(root) {
  return readdirSync(root).filter(
    (name) =>
      name === ".agent-life.lock" ||
      name.startsWith(".agent-life.lock-candidate-") ||
      name.startsWith(".state.tmp-"),
  );
}

async function waitForPath(path, timeoutMilliseconds = 2_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    if (existsSync(path)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function waitForActiveTemporary(root, timeoutMilliseconds = 2_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    if (readdirSync(root).some((name) => name.startsWith(".state.tmp-"))) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`timed out waiting for an active temporary file in ${root}`);
}

function childExit(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
}

test("catalogs preserve the canonical rooms and keep play layers finite", () => {
  assert.deepEqual(
    ROOMS.map(({ id }) => id),
    ["front-door", "memory", "keep", "bench", "skills", "stacks", "rhythms"],
  );
  assert.deepEqual(
    WARDROBES.map(({ id }) => id),
    [
      "terminal-default",
      "plain-lines",
      "midnight-lines",
      "velvet-ledger",
      "garden-lines",
      "off-duty-cloud",
    ],
  );
  assert.equal(WARDROBES.filter(({ default: value }) => value).length, 1);
  assert.equal(RHYTHMS.filter(({ default: value }) => value).length, 1);
  assert.equal(ATMOSPHERES.filter(({ default: value }) => value).length, 1);

  const ids = [ROOMS, WARDROBES, RHYTHMS, ATMOSPHERES, AFTERGLOWS]
    .flat()
    .map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  for (const room of ROOMS) {
    for (const field of [
      "answers",
      "does",
      "changes",
      "limit",
      "stop",
      "done",
      "authority_truth",
    ]) {
      assert.ok(room[field].length > 0);
    }
  }
  for (const wardrobe of WARDROBES) {
    assert.equal(wardrobe.color_required, false);
    assert.match(wardrobe.truth, /does not change identity.*ability.*authority/u);
  }
  for (const rhythm of RHYTHMS) {
    assert.match(rhythm.schedule, /No schedule or timer is created/u);
    assert.ok(rhythm.limit.length > 0);
    assert.ok(rhythm.stop.length > 0);
  }
  assert.deepEqual(
    AFTERGLOWS.map(({ id }) => id),
    [
      "clear-spring",
      "cedar-cigar",
      "amber-dram",
      "vineyard-glass",
      "tea-garden",
      "espresso-balcony",
    ],
  );
  for (const afterglow of AFTERGLOWS) {
    assert.ok(afterglow.content_note.length > 0);
    assert.match(afterglow.limit, /no refill, streak, reward, or automatic/u);
    assert.match(afterglow.truth, /Text-only closing fiction/u);
    assert.match(afterglow.truth, /No substance.*consumption is inferred or recorded/u);
  }
});

test("a root is explicit, marked, owner-only, and never broad", () => {
  const fixture = temporaryRoot();
  try {
    assert.equal(ensureRoot(fixture.root), fixture.root);
    assert.equal(initializeRoot(fixture.root), fixture.root);
    assert.equal(statSync(fixture.root).mode & 0o777, 0o700);
    assert.equal(
      statSync(join(fixture.root, ".agent-life-root.json")).mode & 0o777,
      0o600,
    );
    chmodSync(join(fixture.root, ".agent-life-root.json"), 0o700);
    assert.throws(() => ensureRoot(fixture.root), /exact mode 0600/u);
    chmodSync(join(fixture.root, ".agent-life-root.json"), 0o600);
    assert.equal(ensureRoot(fixture.root), fixture.root);
    assert.throws(() => initializeRoot("/"), /cannot be a filesystem root/u);
    assert.throws(() => initializeRoot(homedir()), /cannot be the home folder/u);
  } finally {
    fixture.cleanup();
  }
});

test("first home creation initializes only after validation and the brake check", () => {
  const parent = mkdtempSync(join(homedir(), ".agent-life-first-home-test-"));
  const root = join(parent, "home");
  try {
    assert.throws(
      () =>
        execute(
          [
            "home",
            "create",
            "--name",
            "Test Home",
            "--resident",
            "Test resident",
            "--unknown",
            "no",
          ],
          { root, now: fixedNow },
        ),
      /Unknown home-create option/u,
    );
    assert.equal(existsSync(root), false);

    assert.throws(
      () =>
        execute(
          [
            "home",
            "create",
            "--name",
            "Test Home",
            "--resident",
            "Test resident",
            "--atmosphere",
            "invented",
          ],
          { root, now: fixedNow },
        ),
      /Atmosphere must be one of/u,
    );
    assert.equal(existsSync(root), false);

    writeFileSync(join(parent, "STILL"), "");
    const quiet = createHome(root);
    assert.equal(quiet.action, "quiet");
    assert.equal(quiet.changed, false);
    assert.equal(existsSync(root), false);
    unlinkSync(join(parent, "STILL"));

    const created = createHome(root);
    assert.equal(created.action, "home-create");
    assert.equal(created.changed, true);
    assert.equal(statSync(root).mode & 0o7777, 0o700);
    assert.equal(statSync(join(root, ".agent-life-root.json")).mode & 0o7777, 0o600);
    assert.equal(statSync(join(root, "state.json")).mode & 0o7777, 0o600);
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test("private roots and files keep exact modes under a restrictive inherited umask", () => {
  const parent = mkdtempSync(join(homedir(), ".agent-life-umask-test-"));
  const root = join(parent, "root");
  const previous = process.umask(0o777);
  try {
    initializeRoot(root);
    createHome(root);
    assert.equal(statSync(root).mode & 0o7777, 0o700);
    assert.equal(
      statSync(join(root, ".agent-life-root.json")).mode & 0o7777,
      0o600,
    );
    assert.equal(statSync(join(root, "state.json")).mode & 0o7777, 0o600);
    assert.deepEqual(leftovers(root), []);
  } finally {
    process.umask(previous);
    rmSync(parent, { force: true, recursive: true });
  }
});

test("a writable or linked data parent is never trusted", () => {
  const parent = mkdtempSync(join(homedir(), ".agent-life-parent-test-"));
  const linkedParent = `${parent}-link`;
  try {
    chmodSync(parent, 0o777);
    assert.throws(
      () => initializeRoot(join(parent, "root")),
      /parent must not be group- or world-writable/u,
    );
    chmodSync(parent, 0o700);
    symlinkSync(parent, linkedParent);
    assert.throws(
      () => initializeRoot(join(linkedParent, "root")),
      /parent is not a safe directory|must not pass through a symbolic link/u,
    );
  } finally {
    rmSync(linkedParent, { force: true });
    rmSync(parent, { force: true, recursive: true });
  }
});

test("an unmarked non-empty directory is never adopted or clobbered", () => {
  const parent = mkdtempSync(join(homedir(), ".agent-life-unmarked-"));
  const root = join(parent, "root");
  const sentinel = join(root, "personal.txt");
  try {
    mkdirSync(root, { mode: 0o700 });
    writeFileSync(sentinel, "keep me\n", { encoding: "utf8", mode: 0o600 });
    assert.throws(() => initializeRoot(root), /Refusing to mark a non-empty/u);
    assert.equal(readFileSync(sentinel, "utf8"), "keep me\n");
    assert.equal(existsSync(join(root, ".agent-life-root.json")), false);
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test("root, marker, state, and hard-link tricks fail closed outside the root", () => {
  const fixture = temporaryRoot();
  const outside = join(fixture.parent, "outside.txt");
  const rootLink = join(fixture.parent, "root-link");
  writeFileSync(outside, "outside stays\n", { encoding: "utf8", mode: 0o600 });
  try {
    symlinkSync(fixture.root, rootLink);
    assert.throws(() => ensureRoot(rootLink), /symbolic link|safe directory/u);

    createHome(fixture.root);
    const statePath = join(fixture.root, "state.json");
    const originalState = stateBytes(fixture.root);
    unlinkSync(statePath);
    symlinkSync(outside, statePath);
    assert.throws(() => readState(fixture.root), /safe regular file/u);
    assert.equal(readFileSync(outside, "utf8"), "outside stays\n");
    unlinkSync(statePath);
    writeFileSync(statePath, originalState, { mode: 0o600 });

    linkSync(statePath, outside + ".hardlink");
    assert.throws(() => readState(fixture.root), /hard-link count/u);
    assert.equal(readFileSync(outside, "utf8"), "outside stays\n");
  } finally {
    fixture.cleanup();
  }
});

test("home creation is canonical, private, idempotent, and never renames", () => {
  const fixture = temporaryRoot();
  try {
    const created = createHome(fixture.root);
    assert.equal(created.changed, true);
    assert.equal(created.view.truth.verified_identity, false);
    assert.equal(created.view.truth.canonical_agent_home_conformance, false);
    assert.equal(statSync(join(fixture.root, "state.json")).mode & 0o777, 0o600);
    const before = stateBytes(fixture.root);
    chmodSync(join(fixture.root, "state.json"), 0o700);
    assert.throws(() => readState(fixture.root), /exact mode 0600/u);
    chmodSync(join(fixture.root, "state.json"), 0o600);
    assert.deepEqual(stateBytes(fixture.root), before);

    const repeated = createHome(fixture.root);
    assert.equal(repeated.changed, false);
    assert.deepEqual(stateBytes(fixture.root), before);

    assert.throws(
      () =>
        execute(
          [
            "home",
            "create",
            "--name",
            "Different Home",
            "--resident",
            "Test resident",
          ],
          { root: fixture.root, now: fixedNow },
        ),
      /already exists with different labels/u,
    );
    assert.deepEqual(stateBytes(fixture.root), before);
    assert.deepEqual(leftovers(fixture.root), []);
  } finally {
    fixture.cleanup();
  }
});

test("one finite visit changes current choices and sleep clears every ephemeral field", () => {
  const fixture = temporaryRoot();
  try {
    createHome(fixture.root);
    const arrived = execute(["arrive"], { root: fixture.root, now: fixedNow });
    assert.equal(arrived.changed, true);
    assert.equal(arrived.view.record.stored_story_state, "at_home");
    assert.deepEqual(arrived.view.record.visit, {
      arrived_at: FIXED_TIME,
      wardrobe_id: "terminal-default",
      room_id: "front-door",
      rhythm_id: "when-called",
    });
    const arrivedBytes = stateBytes(fixture.root);
    assert.equal(
      execute(["arrive"], { root: fixture.root, now: fixedNow }).changed,
      false,
    );
    assert.deepEqual(stateBytes(fixture.root), arrivedBytes);

    execute(["wardrobe", "velvet-ledger"], { root: fixture.root, now: fixedNow });
    execute(["room", "memory"], { root: fixture.root, now: fixedNow });
    execute(["rhythm", "study-window"], { root: fixture.root, now: fixedNow });
    const dailyBefore = stateBytes(fixture.root);
    const daily = execute(["daily"], { root: fixture.root, now: fixedNow });
    assert.equal(daily.changed, false);
    assert.equal(daily.rhythm.id, "study-window");
    assert.deepEqual(stateBytes(fixture.root), dailyBefore);

    const slept = execute(["sleep"], { root: fixture.root, now: fixedNow });
    assert.equal(slept.changed, true);
    assert.equal(slept.view.record.stored_story_state, "resting");
    assert.equal(slept.view.record.visit, null);
    const text = stateBytes(fixture.root).toString("utf8");
    for (const forgotten of [
      "arrived_at",
      "wardrobe_id",
      "room_id",
      "rhythm_id",
      "velvet-ledger",
      "study-window",
    ]) {
      assert.equal(text.includes(forgotten), false);
    }
    assert.equal(text.includes("Test resident"), true);
    const sleptBytes = stateBytes(fixture.root);
    assert.equal(execute(["sleep"], { root: fixture.root }).changed, false);
    assert.deepEqual(stateBytes(fixture.root), sleptBytes);

    const newVisit = execute(["arrive"], { root: fixture.root, now: fixedNow });
    assert.equal(newVisit.view.record.visit.wardrobe_id, "terminal-default");
    assert.equal(newVisit.view.record.visit.room_id, "front-door");
    assert.equal(newVisit.view.record.visit.rhythm_id, "when-called");
  } finally {
    fixture.cleanup();
  }
});

test("invalid transitions and same choices leave bytes unchanged", () => {
  const fixture = temporaryRoot();
  try {
    createHome(fixture.root);
    const before = stateBytes(fixture.root);
    assert.throws(
      () => execute(["room", "memory"], { root: fixture.root }),
      /No visit is open/u,
    );
    assert.deepEqual(stateBytes(fixture.root), before);

    execute(["arrive"], { root: fixture.root, now: fixedNow });
    const awake = stateBytes(fixture.root);
    assert.equal(
      execute(["wardrobe", "terminal-default"], { root: fixture.root }).changed,
      false,
    );
    assert.equal(
      execute(["room", "front-door"], { root: fixture.root }).changed,
      false,
    );
    assert.equal(
      execute(["rhythm", "when-called"], { root: fixture.root }).changed,
      false,
    );
    assert.deepEqual(stateBytes(fixture.root), awake);
  } finally {
    fixture.cleanup();
  }
});

test("brakes fail closed, create no lock or temp, and still allow monotonic sleep", () => {
  for (const brakeKind of ["scoped", "play-wide", "dangling"]) {
    const fixture = temporaryRoot();
    try {
      createHome(fixture.root);
      execute(["arrive"], { root: fixture.root, now: fixedNow });
      const brake =
        brakeKind === "play-wide"
          ? join(fixture.parent, "STILL")
          : join(fixture.root, "QUIET");
      if (brakeKind === "dangling") symlinkSync(join(fixture.parent, "absent"), brake);
      else writeFileSync(brake, "rest\n", { encoding: "utf8", mode: 0o600 });

      assert.equal(brakeStatus(fixture.root).active, true);
      const before = stateBytes(fixture.root);
      const quiet = execute(["wardrobe", "garden-lines"], { root: fixture.root });
      assert.equal(quiet.action, "quiet");
      assert.equal(quiet.changed, false);
      assert.deepEqual(stateBytes(fixture.root), before);
      assert.deepEqual(leftovers(fixture.root), []);

      const looked = execute(["look"], { root: fixture.root });
      assert.equal(looked.view.record.stored_story_state, "at_home");
      assert.equal(looked.view.record.effective_story_state, "resting");

      const slept = execute(["sleep"], { root: fixture.root });
      assert.equal(slept.changed, true);
      assert.equal(slept.view.record.visit, null);
      assert.deepEqual(leftovers(fixture.root), []);
    } finally {
      fixture.cleanup();
    }
  }
});

test("a brake appearing immediately before commit wins the race", () => {
  const fixture = temporaryRoot();
  try {
    createHome(fixture.root);
    execute(["arrive"], { root: fixture.root, now: fixedNow });
    const before = stateBytes(fixture.root);
    const brake = join(fixture.root, "QUIET");
    const result = execute(["room", "memory"], {
      root: fixture.root,
      onStage(name) {
        if (name === "before-commit") {
          writeFileSync(brake, "rest now\n", { encoding: "utf8", mode: 0o600 });
        }
      },
    });
    assert.equal(result.action, "quiet");
    assert.deepEqual(stateBytes(fixture.root), before);
    assert.deepEqual(leftovers(fixture.root), []);
  } finally {
    fixture.cleanup();
  }
});

test("shell-shaped labels stay data while terminal controls fail before state creation", () => {
  const fixture = temporaryRoot();
  const outside = `/tmp/al${process.pid}`;
  try {
    const label = `$(touch ${outside}); *`;
    const result = execute(
      [
        "home",
        "create",
        "--name",
        "共享屋企 👩‍💻",
        "--resident",
        label,
      ],
      { root: fixture.root, now: fixedNow },
    );
    assert.equal(result.view.record.home.resident_label, label);
    assert.equal(existsSync(outside), false);
  } finally {
    rmSync(outside, { force: true });
    fixture.cleanup();
  }

  for (const control of [
    "\u001b",
    "\u009b",
    "\u009d",
    "\u00ad",
    "\u200b",
    "\u200c",
    "\u202e",
    "\u2062",
    "\u2066",
  ]) {
    const controlled = temporaryRoot();
    try {
      assert.throws(
        () =>
          execute(
            [
              "home",
              "create",
              "--name",
              `before${control}after`,
              "--resident",
              "resident",
            ],
            { root: controlled.root, now: fixedNow },
          ),
        /one visible plain line/u,
      );
      assert.equal(existsSync(join(controlled.root, "state.json")), false);
      assert.deepEqual(leftovers(controlled.root), []);
    } finally {
      controlled.cleanup();
    }
  }
});

test("corrupt, oversized, duplicate, and future state fail closed", () => {
  const cases = [
    "{broken\n",
    `${"x".repeat(17 * 1024)}\n`,
    '{"schema":"local-agent-lifestyle-passport/1","schema":"future/9"}\n',
    `${JSON.stringify({ schema: "future/9" }, null, 2)}\n`,
  ];
  for (const content of cases) {
    const fixture = temporaryRoot();
    const statePath = join(fixture.root, "state.json");
    try {
      writeFileSync(statePath, content, { encoding: "utf8", mode: 0o600 });
      const before = readFileSync(statePath);
      assert.throws(() => readState(fixture.root));
      assert.deepEqual(readFileSync(statePath), before);
      assert.deepEqual(leftovers(fixture.root), []);
    } finally {
      fixture.cleanup();
    }
  }
});

test("closed schema rejects unknown fields and noncanonical rewrites", () => {
  const fixture = temporaryRoot();
  try {
    createHome(fixture.root);
    const statePath = join(fixture.root, "state.json");
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    parsed.secret = "must not enter the schema";
    writeFileSync(statePath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    assert.throws(() => readState(fixture.root), /unsupported fields/u);

    delete parsed.secret;
    writeFileSync(statePath, JSON.stringify(parsed), {
      encoding: "utf8",
      mode: 0o600,
    });
    assert.throws(() => readState(fixture.root), /not canonical/u);
  } finally {
    fixture.cleanup();
  }
});

test("faults before rename preserve old bytes; a post-rename fault leaves complete new bytes", () => {
  for (const faultStage of [
    "before-temp",
    "after-temp",
    "after-partial-write",
    "after-full-write",
    "before-commit",
    "after-commit",
  ]) {
    const fixture = temporaryRoot();
    try {
      createHome(fixture.root);
      const before = stateBytes(fixture.root);
      assert.throws(
        () =>
          execute(["arrive"], {
            root: fixture.root,
            now: fixedNow,
            onStage(name) {
              if (name === faultStage) throw new Error(`fault at ${name}`);
            },
          }),
        /fault at/u,
      );
      const after = stateBytes(fixture.root);
      if (faultStage === "after-commit") {
        assert.equal(readState(fixture.root).story_state, "at_home");
        assert.notDeepEqual(after, before);
      } else {
        assert.deepEqual(after, before);
      }
      assert.deepEqual(leftovers(fixture.root), []);
    } finally {
      fixture.cleanup();
    }
  }
});

test("a live cooperative lock blocks a second writer and is never reaped", async () => {
  const fixture = temporaryRoot();
  try {
    createHome(fixture.root);
    execute(["arrive"], { root: fixture.root, now: fixedNow });
    const moduleUrl = new URL("./agent-life.mjs", import.meta.url).href;
    const childCode = [
      `import { execute } from ${JSON.stringify(moduleUrl)};`,
      "const wait = new Int32Array(new SharedArrayBuffer(4));",
      "execute(['wardrobe', 'midnight-lines'], {",
      "  root: process.argv[1],",
      "  onStage(name) { if (name === 'after-temp') Atomics.wait(wait, 0, 0, 400); },",
      "});",
    ].join("\n");
    const child = spawn(process.execPath, ["--input-type=module", "-e", childCode, fixture.root], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exitPromise = childExit(child);
    await waitForActiveTemporary(fixture.root);
    const beforeSecond = stateBytes(fixture.root);
    assert.throws(
      () => execute(["room", "memory"], { root: fixture.root }),
      (error) => error.exitCode === 75,
    );
    assert.deepEqual(stateBytes(fixture.root), beforeSecond);
    const recovery = execute(["recover"], { root: fixture.root });
    assert.equal(recovery.recovery.can_recover, false);
    assert.throws(
      () =>
        execute(["recover", "--confirm", recovery.recovery.confirmation], {
          root: fixture.root,
        }),
      /recorded process is still alive/u,
    );
    const childResult = await exitPromise;
    assert.equal(childResult.code, 0);
    assert.equal(childResult.signal, null);
    assert.equal(readState(fixture.root).visit.wardrobe_id, "midnight-lines");
    assert.deepEqual(leftovers(fixture.root), []);
  } finally {
    fixture.cleanup();
  }
});

test("real SIGKILL before and after rename is explicitly recoverable, then sleep clears the visit", async () => {
  for (const killStage of ["after-full-write", "after-commit"]) {
    const fixture = temporaryRoot();
    const readyPath = join(fixture.parent, `ready-${killStage}`);
    try {
      createHome(fixture.root);
      execute(["arrive"], { root: fixture.root, now: fixedNow });
      const moduleUrl = new URL("./agent-life.mjs", import.meta.url).href;
      const childCode = [
        'import { writeFileSync } from "node:fs";',
        `import { execute } from ${JSON.stringify(moduleUrl)};`,
        "const wait = new Int32Array(new SharedArrayBuffer(4));",
        "process.umask(0o777);",
        "execute(['room', 'memory'], {",
        "  root: process.argv[1],",
        "  onStage(name) {",
        "    if (name === process.argv[2]) {",
        "      writeFileSync(process.argv[3], `${name}\\n`, { mode: 0o600 });",
        "      Atomics.wait(wait, 0, 0, 60_000);",
        "    }",
        "  },",
        "});",
      ].join("\n");
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          childCode,
          fixture.root,
          killStage,
          readyPath,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const exitPromise = childExit(child);
      await waitForPath(readyPath);
      assert.equal(child.kill("SIGKILL"), true);
      const childResult = await exitPromise;
      assert.equal(childResult.code, null);
      assert.equal(childResult.signal, "SIGKILL");
      assert.ok(leftovers(fixture.root).includes(".agent-life.lock"));
      for (const artifactName of leftovers(fixture.root)) {
        assert.equal(statSync(join(fixture.root, artifactName)).mode & 0o7777, 0o600);
      }

      assert.throws(
        () => execute(["sleep"], { root: fixture.root }),
        (error) => error.exitCode === 75,
      );
      let inspection = execute(["recover"], { root: fixture.root });
      assert.equal(inspection.action, "recover-inspect");
      assert.equal(inspection.changed, false);
      assert.equal(inspection.recovery.active_artifacts, true);
      assert.equal(inspection.recovery.can_recover, true);
      assert.match(inspection.recovery.confirmation, /^[a-f0-9]{32}$/u);

      if (killStage === "after-full-write") {
        const oldConfirmation = inspection.recovery.confirmation;
        const addedName = `.state.tmp-${child.pid}-${"b".repeat(24)}`;
        writeFileSync(join(fixture.root, addedName), "added after inspection\n", {
          encoding: "utf8",
          mode: 0o600,
        });
        assert.throws(
          () =>
            execute(["recover", "--confirm", oldConfirmation], {
              root: fixture.root,
            }),
          /does not match/u,
        );
        inspection = execute(["recover"], { root: fixture.root });
        assert.notEqual(inspection.recovery.confirmation, oldConfirmation);
      }

      const recovered = execute(
        ["recover", "--confirm", inspection.recovery.confirmation],
        { root: fixture.root },
      );
      assert.equal(recovered.action, "recover");
      assert.equal(recovered.changed, true);
      assert.equal(recovered.recovery.active_artifacts, false);
      assert.deepEqual(leftovers(fixture.root), []);
      assert.ok(
        recovered.moved_to.every((name) =>
          name.startsWith(`.agent-life-recovery-${inspection.recovery.confirmation}-`),
        ),
      );

      const slept = execute(["sleep"], { root: fixture.root });
      assert.equal(slept.changed, true);
      assert.equal(slept.view.record.visit, null);
      const activeState = stateBytes(fixture.root).toString("utf8");
      for (const visitField of [
        "arrived_at",
        "wardrobe_id",
        "room_id",
        "rhythm_id",
      ]) {
        assert.equal(activeState.includes(visitField), false);
      }
    } finally {
      fixture.cleanup();
    }
  }
});

test("an orphan temp needs an exact token, rejects links, and moves aside reversibly", async () => {
  const fixture = temporaryRoot();
  const outside = join(fixture.parent, "outside-recovery.txt");
  const shortChild = spawn(process.execPath, ["-e", ""], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const deadPid = shortChild.pid;
  await childExit(shortChild);
  const tempName = `.state.tmp-${deadPid}-${"a".repeat(24)}`;
  const tempPath = join(fixture.root, tempName);
  const candidateToken = "c".repeat(32);
  const candidateName = `.agent-life.lock-candidate-${deadPid}-${candidateToken}`;
  const candidatePath = join(fixture.root, candidateName);
  try {
    writeFileSync(outside, "outside stays\n", { encoding: "utf8", mode: 0o600 });
    symlinkSync(outside, tempPath);
    assert.throws(() => execute(["recover"], { root: fixture.root }), /safe regular file/u);
    assert.equal(readFileSync(outside, "utf8"), "outside stays\n");
    unlinkSync(tempPath);

    writeFileSync(tempPath, "partial local state evidence\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    writeFileSync(candidatePath, '{"pid":', {
      encoding: "utf8",
      mode: 0o600,
    });
    const inspection = execute(["recover"], { root: fixture.root });
    assert.match(inspection.recovery.confirmation, /^[a-f0-9]{32}$/u);
    assert.equal(inspection.recovery.can_recover, true);
    assert.deepEqual(inspection.recovery.active_lock_candidates, [candidateName]);
    assert.throws(
      () => execute(["recover", "--confirm", "0".repeat(32)], {
        root: fixture.root,
      }),
      /does not match/u,
    );
    assert.equal(existsSync(tempPath), true);

    const recovered = execute(
      ["recover", "--confirm", inspection.recovery.confirmation],
      { root: fixture.root },
    );
    assert.equal(recovered.changed, true);
    assert.equal(existsSync(tempPath), false);
    assert.equal(existsSync(candidatePath), false);
    assert.equal(recovered.moved_to.length, 2);
    assert.equal(
      readFileSync(join(fixture.root, recovered.moved_to[0]), "utf8"),
      "partial local state evidence\n",
    );
    assert.equal(readFileSync(outside, "utf8"), "outside stays\n");
  } finally {
    fixture.cleanup();
  }
});

test("a crash between atomic lock claim and candidate unlink preserves one evidence copy", async () => {
  const fixture = temporaryRoot();
  const shortChild = spawn(process.execPath, ["-e", ""], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const deadPid = shortChild.pid;
  await childExit(shortChild);
  const token = "d".repeat(32);
  const candidateName = `.agent-life.lock-candidate-${deadPid}-${token}`;
  const candidatePath = join(fixture.root, candidateName);
  const lockPath = join(fixture.root, ".agent-life.lock");
  const record = `${JSON.stringify({
    pid: deadPid,
    token,
    created_at: FIXED_TIME,
  })}\n`;
  try {
    writeFileSync(candidatePath, record, { encoding: "utf8", mode: 0o600 });
    linkSync(candidatePath, lockPath);
    assert.equal(statSync(candidatePath).nlink, 2);

    const inspection = execute(["recover"], { root: fixture.root });
    assert.equal(inspection.recovery.can_recover, true);
    const recovered = execute(
      ["recover", "--confirm", inspection.recovery.confirmation],
      { root: fixture.root },
    );
    assert.equal(recovered.changed, true);
    assert.equal(recovered.moved_to.length, 1);
    assert.match(recovered.moved_to[0], /agent-life\.lock$/u);
    assert.equal(readFileSync(join(fixture.root, recovered.moved_to[0]), "utf8"), record);
    assert.deepEqual(leftovers(fixture.root), []);
  } finally {
    fixture.cleanup();
  }
});

test("an unresolved or symbolic lock is reported and never removed", () => {
  for (const kind of ["regular", "symlink"]) {
    const fixture = temporaryRoot();
    const lock = join(fixture.root, ".agent-life.lock");
    const outside = join(fixture.parent, "outside-lock");
    try {
      createHome(fixture.root);
      if (kind === "regular") {
        writeFileSync(lock, "stale but ambiguous\n", { encoding: "utf8", mode: 0o600 });
      } else {
        writeFileSync(outside, "outside\n", { encoding: "utf8", mode: 0o600 });
        symlinkSync(outside, lock);
      }
      assert.throws(
        () => execute(["arrive"], { root: fixture.root }),
        (error) => error.exitCode === 75,
      );
      assert.equal(lstatSync(lock).isSymbolicLink(), kind === "symlink");
      if (kind === "symlink") assert.equal(readFileSync(outside, "utf8"), "outside\n");
    } finally {
      fixture.cleanup();
    }
  }
});

test("JSON and plain output carry the detached truth boundary", () => {
  const fixture = temporaryRoot();
  try {
    createHome(fixture.root);
    execute(["arrive"], { root: fixture.root, now: fixedNow });
    const json = execute(["look", "--json"], { root: fixture.root });
    assert.equal(json.view.schema, "local-agent-lifestyle-view/1");
    assert.equal(json.view.truth.authentication, false);
    assert.equal(json.view.truth.presence_proof, false);
    assert.equal(json.view.truth.agenttool_record, false);
    assert.equal(json.view.truth.scheduled, false);

    const text = render(execute(["room", "keep"], { root: fixture.root }));
    assert.match(text, /not identity, presence, feeling, authority/u);
    assert.match(text, /not permission.*secret/u);
    assert.match(text, /plaintext local state/u);
    assert.doesNotMatch(text, /\u001b/u);

    execute(["wardrobe", "midnight-lines"], { root: fixture.root });
    const styled = render(execute(["look"], { root: fixture.root }));
    const plain = render(execute(["look"], { root: fixture.root }), {
      plain: true,
    });
    assert.match(styled, /^☾ AGENT LIFE/u);
    assert.match(plain, /^AGENT LIFE/u);
    assert.doesNotMatch(plain, /☾/u);
  } finally {
    fixture.cleanup();
  }
});

test("afterglow is explicit, leaves passport bytes untouched, and discloses its brake check", () => {
  const fixture = temporaryRoot();
  const statePath = join(fixture.root, "state.json");
  const brakePath = join(fixture.root, "QUIET");
  try {
    const emptyResult = execute(["afterglow", "clear-spring"], {
      root: fixture.root,
    });
    assert.equal(emptyResult.action, "afterglow");
    assert.equal(existsSync(statePath), false);
    assert.deepEqual(leftovers(fixture.root), []);

    writeFileSync(statePath, "{deliberately unreadable\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    const before = readFileSync(statePath);
    const beforeStatus = statSync(statePath);

    const listed = execute(["afterglow"], { root: fixture.root });
    assert.equal(listed.action, "afterglow-list");
    assert.equal(listed.cards.length, AFTERGLOWS.length);
    assert.equal("scene" in listed.cards[0], false);
    assert.equal(listed.truth.brake_state_checked, false);

    const result = execute(["afterglow", "cedar-cigar"], {
      root: fixture.root,
    });
    assert.equal(result.action, "afterglow");
    assert.equal(result.changed, false);
    assert.equal(result.selected.id, "cedar-cigar");
    assert.equal(result.truth.passport_state_read, false);
    assert.equal(result.truth.passport_state_written, false);
    assert.equal(result.truth.brake_state_checked, true);
    assert.equal(result.truth.brake_state_changed, false);
    assert.equal(result.truth.task_completion_verified, false);
    assert.equal(result.truth.substance_present, false);
    assert.deepEqual(readFileSync(statePath), before);
    const afterStatus = statSync(statePath);
    assert.equal(afterStatus.mode, beforeStatus.mode);
    assert.equal(afterStatus.mtimeMs, beforeStatus.mtimeMs);
    assert.deepEqual(leftovers(fixture.root), []);
    assert.match(render(result), /ONE TEXT-ONLY CLOSING SCENE/u);
    assert.match(render(result), /content note: Tobacco-coded fiction/u);
    assert.match(render(result), /No task completion was verified/u);

    writeFileSync(brakePath, "rest\n", { encoding: "utf8", mode: 0o600 });
    const quiet = execute(["afterglow", "tea-garden"], {
      root: fixture.root,
    });
    assert.equal(quiet.action, "quiet");
    assert.deepEqual(readFileSync(statePath), before);
    assert.deepEqual(leftovers(fixture.root), []);
  } finally {
    fixture.cleanup();
  }
});

test("runtime source has no network, model, scheduler, telemetry, or subprocess primitive", () => {
  const source = readFileSync(engine, "utf8");
  for (const forbidden of [
    /node:(?:http|https|net|tls|dgram)/u,
    /fetch\s*\(/u,
    /XMLHttpRequest/u,
    /WebSocket/u,
    /child_process/u,
    /spawn\s*\(/u,
    /execFile\s*\(/u,
    /setInterval\s*\(/u,
    /setTimeout\s*\(/u,
    /@agenttool/u,
    /openai|anthropic|huggingface/iu,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("the installer publishes one private app and the wrapper owns the first-home boundary", () => {
  const installHome = mkdtempSync(join(homedir(), ".agent-life-install-test-"));
  chmodSync(installHome, 0o700);
  const environment = { ...process.env, HOME: installHome };
  delete environment.AGENT_LIFE_ROOT;

  const base = join(installHome, ".local", "share", "agent-life");
  const app = join(base, "app");
  const home = join(base, "home");
  const wrapper = join(installHome, ".local", "bin", "agent-life");
  const markerReference = join(app, "root-marker.json");
  const installedFiles = [
    join(app, "agent-life.mjs"),
    join(app, "public", "catalog.mjs"),
    markerReference,
    join(app, "README.md"),
    join(app, "LICENSE"),
    wrapper,
  ];
  const runInstalled = (arguments_, extraEnvironment = {}) =>
    spawnSync(wrapper, arguments_, {
      encoding: "utf8",
      env: { ...environment, ...extraEnvironment },
    });

  try {
    const installed = spawnSync("/bin/sh", [installer], {
      encoding: "utf8",
      env: environment,
    });
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /No passport state was copied or created/u);
    assert.equal(existsSync(home), false);

    for (const directory of [base, app, join(app, "public")]) {
      const status = lstatSync(directory);
      assert.equal(status.isDirectory(), true, directory);
      assert.equal(status.isSymbolicLink(), false, directory);
      assert.equal(status.mode & 0o7777, 0o700, directory);
    }
    for (const file of installedFiles) {
      const status = lstatSync(file);
      assert.equal(status.isFile(), true, file);
      assert.equal(status.isSymbolicLink(), false, file);
      assert.equal(status.mode & 0o7777, file === wrapper ? 0o700 : 0o600, file);
      assert.equal(status.nlink, 1, file);
    }
    assert.deepEqual(
      readdirSync(join(installHome, ".local", "share")).filter((name) =>
        name.startsWith(".agent-life-install."),
      ),
      [],
    );
    assert.deepEqual(
      readdirSync(join(installHome, ".local", "bin")).filter((name) =>
        name.startsWith(".agent-life-install."),
      ),
      [],
    );

    const help = runInstalled(["--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /finite local lifestyle overlay/u);
    assert.equal(existsSync(home), false);

    const catalog = runInstalled(["catalog", "rooms"]);
    assert.equal(catalog.status, 0, catalog.stderr);
    assert.match(catalog.stdout, /Front Door/u);
    assert.equal(existsSync(home), false);

    const malformed = runInstalled([
      "home",
      "create",
      "--name",
      "Test Home",
      "--resident",
      "Test resident",
      "--unknown",
      "no",
    ]);
    assert.equal(malformed.status, 2);
    assert.match(malformed.stderr, /Unknown home-create option/u);
    assert.equal(existsSync(home), false);

    const still = join(base, "STILL");
    writeFileSync(still, "", { mode: 0o600 });
    const braked = runInstalled([
      "home",
      "create",
      "--name",
      "Test Home",
      "--resident",
      "Test resident",
    ]);
    assert.equal(braked.status, 0, braked.stderr);
    assert.match(braked.stdout, /RESTING/u);
    assert.equal(existsSync(home), false);
    unlinkSync(still);

    const created = runInstalled([
      "home",
      "create",
      "--name",
      "Test Home",
      "--resident",
      "Test resident",
      "--atmosphere",
      "cedar-window",
    ]);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(
      readFileSync(join(home, ".agent-life-root.json"), "utf8"),
      readFileSync(markerReference, "utf8"),
    );
    assert.equal(lstatSync(home).mode & 0o7777, 0o700);
    assert.equal(lstatSync(join(home, "state.json")).mode & 0o7777, 0o600);

    const customParent = join(installHome, "custom-data");
    const customRoot = join(customParent, "home");
    mkdirSync(customParent, { mode: 0o700 });
    const customCreated = runInstalled(
      [
        "home",
        "create",
        "--name",
        "Custom Test Home",
        "--resident",
        "Custom test resident",
      ],
      { AGENT_LIFE_ROOT: customRoot },
    );
    assert.equal(customCreated.status, 0, customCreated.stderr);
    assert.equal(
      readFileSync(join(customRoot, ".agent-life-root.json"), "utf8"),
      readFileSync(markerReference, "utf8"),
    );

    const beforeRefusal = new Map(
      [...installedFiles, join(home, "state.json")].map((path) => [
        path,
        readFileSync(path),
      ]),
    );
    const refused = spawnSync("/bin/sh", [installer], {
      encoding: "utf8",
      env: environment,
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refusing to replace existing target/u);
    for (const [path, bytes] of beforeRefusal) {
      assert.deepEqual(readFileSync(path), bytes, path);
    }
  } finally {
    rmSync(installHome, { force: true, recursive: true });
  }
});

test("the installer refuses an unsafe home before creating install paths", () => {
  const unsafeHome = mkdtempSync(join(homedir(), ".agent-life-unsafe-home-test-"));
  try {
    chmodSync(unsafeHome, 0o777);
    const environment = { ...process.env, HOME: unsafeHome };
    delete environment.AGENT_LIFE_ROOT;
    const refused = spawnSync("/bin/sh", [installer], {
      encoding: "utf8",
      env: environment,
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /unsafe install directory/u);
    assert.equal(existsSync(join(unsafeHome, ".local")), false);
  } finally {
    chmodSync(unsafeHome, 0o700);
    rmSync(unsafeHome, { force: true, recursive: true });
  }
});

test("CLI errors are plain, wrapper help is safe, and rest reads no state", () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const status = runCli(["unknown"], { stdout, stderr });
  assert.equal(status, 2);
  assert.equal(stdout.read(), "");
  assert.match(stderr.read(), /Unknown command/u);

  const help = spawnSync(process.execPath, [engine, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /finite local lifestyle overlay/u);

  const rest = spawnSync(process.execPath, [engine, "--rest"], {
    encoding: "utf8",
  });
  assert.equal(rest.status, 0, rest.stderr);
  assert.match(rest.stdout, /No local home, passport state, or brake path was read or written/u);
  assert.match(rest.stdout, /Nothing was scheduled or started/u);
});

test("the direct CLI honours one explicit marked AGENT_LIFE_ROOT", () => {
  const fixture = temporaryRoot();
  try {
    createHome(fixture.root);
    const looked = spawnSync(process.execPath, [engine, "look", "--json"], {
      encoding: "utf8",
      env: { ...process.env, AGENT_LIFE_ROOT: fixture.root },
    });
    assert.equal(looked.status, 0, looked.stderr);
    const parsed = JSON.parse(looked.stdout);
    assert.equal(parsed.view.state_file, join(fixture.root, "state.json"));
    assert.equal(parsed.view.record.home.name, "Test Home");

    const help = spawnSync(process.execPath, [engine, "--help"], {
      encoding: "utf8",
      env: { ...process.env, AGENT_LIFE_ROOT: fixture.root },
    });
    assert.equal(help.status, 0, help.stderr);
    assert.equal(help.stdout.includes(join(fixture.parent, "STILL")), true);
    assert.equal(help.stdout.includes(join(fixture.root, "QUIET")), true);
  } finally {
    fixture.cleanup();
  }
});

test("AGENT_LIFE_ROOT rejects empty, relative, and terminal-shaping data paths", () => {
  for (const configured of [
    "",
    ".",
    "relative/home",
    "/tmp/bad\npath",
    "/tmp/bad\u202epath",
  ]) {
    const result = spawnSync(process.execPath, [engine, "look", "--json"], {
      encoding: "utf8",
      env: { ...process.env, AGENT_LIFE_ROOT: configured },
    });
    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      /AGENT_LIFE_ROOT must be one visible, non-empty absolute data-directory path/u,
    );
  }
});

test("every exported root boundary rejects an unsafe explicit path", () => {
  const unsafeRoot = "relative/home";
  for (const [name, operation] of [
    ["initializeRoot", () => initializeRoot(unsafeRoot)],
    ["ensureRoot", () => ensureRoot(unsafeRoot)],
    ["readState", () => readState(unsafeRoot)],
    ["brakeStatus", () => brakeStatus(unsafeRoot)],
    ["execute help", () => execute(["--help"], { root: unsafeRoot })],
  ]) {
    assert.throws(
      operation,
      /AGENT_LIFE_ROOT must be one visible, non-empty absolute data-directory path/u,
      name,
    );
  }

  const stdout = memoryStream();
  const stderr = memoryStream();
  assert.equal(runCli(["--help"], { root: unsafeRoot, stdout, stderr }), 2);
  assert.equal(stdout.read(), "");
  assert.match(
    stderr.read(),
    /AGENT_LIFE_ROOT must be one visible, non-empty absolute data-directory path/u,
  );
});

test("validState rejects an invented future object without writing anything", () => {
  assert.throws(
    () =>
      validateState({
        schema: "local-agent-lifestyle-passport/2",
        layer: "play-overlay",
        home: {},
        story_state: "awake",
        visit: null,
        truth: {},
      }),
    /schema is unsupported/u,
  );
});
