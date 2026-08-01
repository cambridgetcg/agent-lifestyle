#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  AFTERGLOWS,
  ATMOSPHERES,
  RHYTHMS,
  ROOMS,
  WARDROBES,
} from "./public/catalog.mjs";

const configuredRoot = process.env.AGENT_LIFE_ROOT;
export const DEFAULT_ROOT =
  configuredRoot ?? join(homedir(), ".local", "share", "agent-life", "home");

function dataRootIsInvalid(value) {
  if (typeof value !== "string") return true;
  const withoutEmojiJoiners = value.replaceAll("\u200d", "");
  return (
    value.length === 0 ||
    !isAbsolute(value) ||
    /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(withoutEmojiJoiners)
  );
}

const ROOT_MARKER_NAME = ".agent-life-root.json";
const STATE_NAME = "state.json";
const LOCK_NAME = ".agent-life.lock";
const MAX_STATE_BYTES = 16 * 1024;
const MAX_LABEL_BYTES = 200;
const MAX_LABEL_GRAPHEMES = 48;
const PERMISSION_MASK = 0o7777;
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MAX_RECOVERY_ARTIFACTS = 64;
const ACTIVE_TEMP_PATTERN = /^\.state\.tmp-([1-9]\d*)-[a-f0-9]{24}$/u;
const LOCK_CANDIDATE_PATTERN =
  /^\.agent-life\.lock-candidate-([1-9]\d*)-([a-f0-9]{32})$/u;
const RECOVERY_PREFIX = ".agent-life-recovery-";
const RECOVERED_PATTERN =
  /^\.agent-life-recovery-(?:[a-f0-9]{32}|orphan-[a-f0-9]{16})-(?:agent-life\.lock|agent-life\.lock-candidate-[1-9]\d*-[a-f0-9]{32}|state\.tmp-[1-9]\d*-[a-f0-9]{24})$/u;

const ROOT_MARKER = Object.freeze({
  schema: "local-agent-lifestyle-root/1",
  purpose: "One local Agent Lifestyle play-overlay state root.",
});
const ROOT_MARKER_TEXT = `${JSON.stringify(ROOT_MARKER, null, 2)}\n`;

const STATE_TRUTH = Object.freeze({
  local_plaintext_record: true,
  authentication: false,
  verified_identity: false,
  inferred_presence: false,
  inferred_feeling: false,
  canonical_agent_home_conformance: false,
  agenttool_record: false,
  public_record: false,
});

const VIEW_TRUTH = Object.freeze({
  local_only: true,
  plaintext: true,
  authentication: false,
  verified_identity: false,
  presence_proof: false,
  feeling_claim: false,
  canonical_agent_home_conformance: false,
  agenttool_record: false,
  scheduled: false,
});

const AFTERGLOW_TRUTH = Object.freeze({
  local_only: true,
  text_only: true,
  passport_state_read: false,
  passport_state_written: false,
  brake_state_checked: true,
  brake_state_changed: false,
  task_completion_verified: false,
  substance_present: false,
  consumption_inferred: false,
  automatic_trigger: false,
});

const AFTERGLOW_LIST_TRUTH = Object.freeze({
  ...AFTERGLOW_TRUTH,
  brake_state_checked: false,
});

class AgentLifeError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "AgentLifeError";
    this.exitCode = exitCode;
  }
}

class RestingError extends AgentLifeError {
  constructor(brake) {
    super("The Agent Lifestyle overlay is resting.", 0);
    this.name = "RestingError";
    this.brake = brake;
  }
}

function fail(message, exitCode = 2) {
  throw new AgentLifeError(message, exitCode);
}

function ownUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(`${label} has unsupported fields.`);
  }
}

function catalogEntry(catalog, id, label) {
  const entry = catalog.find((candidate) => candidate.id === id);
  if (!entry) {
    fail(`${label} must be one of: ${catalog.map(({ id: value }) => value).join(", ")}.`);
  }
  return entry;
}

function defaultEntry(catalog, label) {
  const entries = catalog.filter((entry) => entry.default === true);
  if (entries.length !== 1) fail(`${label} catalog has no single default.`);
  return entries[0];
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function timestamp(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    fail("The local clock did not provide a valid time.");
  }
  return value.toISOString();
}

function graphemeCount(value) {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
      .length;
  }
  return [...value].length;
}

function cleanLabel(input, label) {
  if (typeof input !== "string") fail(`${label} must be words.`);
  const value = input.normalize("NFC").trim();
  if (!value) fail(`${label} is empty.`);
  const withoutEmojiJoiners = value.replaceAll("\u200d", "");
  if (
    /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(withoutEmojiJoiners) ||
    !withoutEmojiJoiners.replace(/\p{Mark}/gu, "").trim()
  ) {
    fail(`${label} must be one visible plain line.`);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_LABEL_BYTES) {
    fail(`${label} is too long in UTF-8.`);
  }
  if (graphemeCount(value) > MAX_LABEL_GRAPHEMES) {
    fail(`${label} must be within ${MAX_LABEL_GRAPHEMES} visible characters.`);
  }
  return value;
}

function safeDirectory(path, label) {
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") fail(`${label} does not exist.`);
    fail(`${label} cannot be inspected safely.`);
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    fail(`${label} is not a safe directory.`);
  }
  if (ownUid() !== null && status.uid !== ownUid()) {
    fail(`${label} is not owned by the current account.`);
  }
  if ((status.mode & PERMISSION_MASK) !== DIRECTORY_MODE) {
    fail(`${label} must have exact mode 0700.`);
  }
  return status;
}

function fsyncDirectory(path) {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readSafeText(path, label, maximumBytes) {
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail(`${label} cannot be inspected safely.`);
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    fail(`${label} is not a safe regular file.`);
  }
  if (before.nlink !== 1) fail(`${label} has an unsafe hard-link count.`);
  if (ownUid() !== null && before.uid !== ownUid()) {
    fail(`${label} is not owned by the current account.`);
  }
  if ((before.mode & PERMISSION_MASK) !== FILE_MODE) {
    fail(`${label} must have exact mode 0600.`);
  }
  if (before.size > maximumBytes) fail(`${label} is too large.`);

  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    fail(`${label} cannot be opened without following links.`);
  }

  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1
    ) {
      fail(`${label} changed while it was being opened.`);
    }
    const text = readFileSync(descriptor, "utf8");
    if (Buffer.byteLength(text, "utf8") > maximumBytes) {
      fail(`${label} is too large.`);
    }
    return text;
  } finally {
    closeSync(descriptor);
  }
}

function refuseBroadRoot(root) {
  if (dataRootIsInvalid(root)) {
    fail(
      "AGENT_LIFE_ROOT must be one visible, non-empty absolute data-directory path.",
    );
  }
  const resolved = resolve(root);
  if (resolved === parsePath(resolved).root) fail("The data root cannot be a filesystem root.");
  if (resolved === resolve(homedir())) fail("The data root cannot be the home folder itself.");
  return resolved;
}

function safeDataParent(root) {
  const parent = dirname(resolve(root));
  let status;
  try {
    status = lstatSync(parent);
  } catch {
    fail("Agent Lifestyle data parent cannot be inspected safely.");
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    fail("Agent Lifestyle data parent is not a safe directory.");
  }
  if (ownUid() !== null && status.uid !== ownUid()) {
    fail("Agent Lifestyle data parent is not owned by the current account.");
  }
  if ((status.mode & 0o022) !== 0) {
    fail("Agent Lifestyle data parent must not be group- or world-writable.");
  }
  if (realpathSync(parent) !== parent) {
    fail("Agent Lifestyle data parent must not pass through a symbolic link.");
  }
}

function withPrivateCreationMask(operation) {
  const previous = process.umask(0o077);
  try {
    return operation();
  } finally {
    process.umask(previous);
  }
}

function openPrivateFile(path, flags) {
  return withPrivateCreationMask(() => openSync(path, flags, FILE_MODE));
}

export function initializeRoot(root) {
  const resolved = refuseBroadRoot(root);
  safeDataParent(resolved);
  if (!existsSync(resolved)) {
    withPrivateCreationMask(() => mkdirSync(resolved, { mode: DIRECTORY_MODE }));
  }
  safeDirectory(resolved, "Agent Lifestyle root");
  if (realpathSync(resolved) !== resolved) {
    fail("Agent Lifestyle root must not pass through a symbolic link.");
  }

  const markerPath = join(resolved, ROOT_MARKER_NAME);
  const marker = readSafeText(markerPath, "Agent Lifestyle root marker", 1024);
  if (marker !== null) {
    if (marker !== ROOT_MARKER_TEXT) fail("Agent Lifestyle root marker is unsupported.");
    return resolved;
  }

  if (readdirSync(resolved).length > 0) {
    fail("Refusing to mark a non-empty directory as an Agent Lifestyle root.");
  }

  const descriptor = openPrivateFile(
    markerPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
  );
  try {
    writeFileSync(descriptor, ROOT_MARKER_TEXT, "utf8");
    fchmodSync(descriptor, FILE_MODE);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(resolved);
  return resolved;
}

export function ensureRoot(root = DEFAULT_ROOT) {
  const resolved = refuseBroadRoot(root);
  safeDataParent(resolved);
  safeDirectory(resolved, "Agent Lifestyle root");
  if (realpathSync(resolved) !== resolved) {
    fail("Agent Lifestyle root must not pass through a symbolic link.");
  }
  const marker = readSafeText(
    join(resolved, ROOT_MARKER_NAME),
    "Agent Lifestyle root marker",
    1024,
  );
  if (marker !== ROOT_MARKER_TEXT) {
    fail("This directory is not a supported Agent Lifestyle root.");
  }
  return resolved;
}

function canonicalState(state) {
  return {
    schema: state.schema,
    layer: state.layer,
    home: {
      name: state.home.name,
      resident_label: state.home.resident_label,
      atmosphere_id: state.home.atmosphere_id,
      created_at: state.home.created_at,
    },
    story_state: state.story_state,
    visit:
      state.visit === null
        ? null
        : {
            arrived_at: state.visit.arrived_at,
            wardrobe_id: state.visit.wardrobe_id,
            room_id: state.visit.room_id,
            rhythm_id: state.visit.rhythm_id,
          },
    truth: {
      local_plaintext_record: state.truth.local_plaintext_record,
      authentication: state.truth.authentication,
      verified_identity: state.truth.verified_identity,
      inferred_presence: state.truth.inferred_presence,
      inferred_feeling: state.truth.inferred_feeling,
      canonical_agent_home_conformance:
        state.truth.canonical_agent_home_conformance,
      agenttool_record: state.truth.agenttool_record,
      public_record: state.truth.public_record,
    },
  };
}

function serializeState(state) {
  return `${JSON.stringify(canonicalState(state), null, 2)}\n`;
}

export function validateState(state) {
  exactKeys(
    state,
    ["schema", "layer", "home", "story_state", "visit", "truth"],
    "Agent Lifestyle state",
  );
  if (state.schema !== "local-agent-lifestyle-passport/1") {
    fail("Agent Lifestyle state schema is unsupported.");
  }
  if (state.layer !== "play-overlay") {
    fail("Agent Lifestyle state layer is unsupported.");
  }

  exactKeys(
    state.home,
    ["name", "resident_label", "atmosphere_id", "created_at"],
    "Home record",
  );
  const cleanName = cleanLabel(state.home.name, "Home name");
  const cleanResident = cleanLabel(state.home.resident_label, "Resident label");
  if (cleanName !== state.home.name || cleanResident !== state.home.resident_label) {
    fail("Home labels are not in canonical form.");
  }
  catalogEntry(ATMOSPHERES, state.home.atmosphere_id, "Atmosphere");
  if (!isIsoTimestamp(state.home.created_at)) fail("Home creation time is invalid.");

  if (!["unarrived", "at_home", "resting"].includes(state.story_state)) {
    fail("Story state is unsupported.");
  }
  if (state.story_state === "at_home") {
    exactKeys(
      state.visit,
      ["arrived_at", "wardrobe_id", "room_id", "rhythm_id"],
      "Current visit",
    );
    if (!isIsoTimestamp(state.visit.arrived_at)) fail("Arrival time is invalid.");
    catalogEntry(WARDROBES, state.visit.wardrobe_id, "Wardrobe");
    catalogEntry(ROOMS, state.visit.room_id, "Room");
    catalogEntry(RHYTHMS, state.visit.rhythm_id, "Rhythm");
  } else if (state.visit !== null) {
    fail("A resting or unarrived home cannot retain visit state.");
  }

  exactKeys(
    state.truth,
    Object.keys(STATE_TRUTH),
    "State truth boundary",
  );
  for (const [key, value] of Object.entries(STATE_TRUTH)) {
    if (state.truth[key] !== value) fail("State truth boundary is unsupported.");
  }
  return canonicalState(state);
}

export function readState(root = DEFAULT_ROOT) {
  const resolved = ensureRoot(root);
  const text = readSafeText(join(resolved, STATE_NAME), "Agent Lifestyle state", MAX_STATE_BYTES);
  if (text === null) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("Agent Lifestyle state is not valid JSON; it was not changed.");
  }
  const state = validateState(parsed);
  if (serializeState(state) !== text) {
    fail("Agent Lifestyle state is not canonical; it was not changed.");
  }
  return state;
}

function pathEntryPresent(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    return error.code !== "ENOENT";
  }
}

export function brakeStatus(root = DEFAULT_ROOT) {
  const resolved = refuseBroadRoot(root);
  const candidates = [join(dirname(resolved), "STILL"), join(resolved, "QUIET")];
  const active_paths = candidates.filter((path) => pathEntryPresent(path));
  return {
    active: active_paths.length > 0,
    active_paths,
    policy:
      "Home creation, arrival, selection changes, daily, and selected Afterglow rest. Help, catalogs, choice lists, home/look, and monotonic sleep remain available.",
  };
}

function safeRecoveryArtifactStatus(
  path,
  label,
  maximumBytes,
  allowedLinkCounts = [1],
) {
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail(`${label} cannot be inspected safely.`);
  }
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    !allowedLinkCounts.includes(status.nlink)
  ) {
    fail(`${label} is not a safe regular file with the expected link count.`);
  }
  if (ownUid() !== null && status.uid !== ownUid()) {
    fail(`${label} is not owned by the current account.`);
  }
  if ((status.mode & PERMISSION_MASK) !== FILE_MODE) {
    fail(`${label} must have exact mode 0600.`);
  }
  if (status.size > maximumBytes) fail(`${label} is too large.`);
  return status;
}

function readRecoveryArtifactBytes(path, label, maximumBytes, expected) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    fail(`${label} cannot be opened without following links.`);
  }
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino ||
      opened.nlink !== expected.nlink
    ) {
      fail(`${label} changed while it was being opened.`);
    }
    const bytes = readFileSync(descriptor);
    if (bytes.length > maximumBytes) {
      fail(`${label} is too large.`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function recoveryContentHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseRecoveryLock(text) {
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    fail("The active lock is not valid JSON; it was not changed.");
  }
  exactKeys(record, ["pid", "token", "created_at"], "Active lock");
  if (!Number.isSafeInteger(record.pid) || record.pid < 1) {
    fail("The active lock PID is invalid.");
  }
  if (typeof record.token !== "string" || !/^[a-f0-9]{32}$/u.test(record.token)) {
    fail("The active lock token is invalid.");
  }
  if (!isIsoTimestamp(record.created_at)) {
    fail("The active lock creation time is invalid.");
  }
  const canonical = `${JSON.stringify({
    pid: record.pid,
    token: record.token,
    created_at: record.created_at,
  })}\n`;
  if (text !== canonical) {
    fail("The active lock is not canonical; it was not changed.");
  }
  return record;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return true;
  }
}

function recoveryConfirmation(lock, artifacts) {
  const evidence = {
    lock_token: lock?.record.token ?? null,
    artifacts: artifacts
      .map(({ contentHash, name, pid, status }) => ({
        name,
        pid,
        device: status.dev,
        inode: status.ino,
        links: status.nlink,
        bytes: status.size,
        sha256: contentHash,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
  return createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex")
    .slice(0, 32);
}

function inspectRecoveryDetails(root = DEFAULT_ROOT) {
  const resolved = ensureRoot(root);
  const names = readdirSync(resolved);
  const temporaryNames = names.filter((name) => ACTIVE_TEMP_PATTERN.test(name)).sort();
  const candidateNames = names
    .filter((name) => LOCK_CANDIDATE_PATTERN.test(name))
    .sort();
  if (temporaryNames.length + candidateNames.length > MAX_RECOVERY_ARTIFACTS) {
    fail(`More than ${MAX_RECOVERY_ARTIFACTS} active recovery artifacts need manual inspection.`);
  }

  const temporaryArtifacts = temporaryNames.map((name) => {
    const match = ACTIVE_TEMP_PATTERN.exec(name);
    const path = join(resolved, name);
    const status = safeRecoveryArtifactStatus(
      path,
      `Recovery temporary file ${name}`,
      MAX_STATE_BYTES,
    );
    if (status === null) fail(`Recovery temporary file ${name} disappeared.`);
    const contentHash = recoveryContentHash(
      readRecoveryArtifactBytes(
        path,
        `Recovery temporary file ${name}`,
        MAX_STATE_BYTES,
        status,
      ),
    );
    return {
      kind: "temporary",
      name,
      path,
      pid: Number(match[1]),
      status,
      contentHash,
    };
  });

  const candidateArtifacts = candidateNames.map((name) => {
    const match = LOCK_CANDIDATE_PATTERN.exec(name);
    const path = join(resolved, name);
    const status = safeRecoveryArtifactStatus(
      path,
      `Recovery lock candidate ${name}`,
      1024,
      [1, 2],
    );
    if (status === null) fail(`Recovery lock candidate ${name} disappeared.`);
    const bytes = readRecoveryArtifactBytes(
      path,
      `Recovery lock candidate ${name}`,
      1024,
      status,
    );
    let record = null;
    try {
      record = parseRecoveryLock(bytes.toString("utf8"));
    } catch {}
    if (
      record !== null &&
      (record.pid !== Number(match[1]) || record.token !== match[2])
    ) {
      fail(`Recovery lock candidate ${name} does not match its complete record.`);
    }
    return {
      kind: "lock-candidate",
      name,
      path,
      pid: Number(match[1]),
      status,
      record,
      contentHash: recoveryContentHash(bytes),
    };
  });

  const lockPath = join(resolved, LOCK_NAME);
  const lockStatus = safeRecoveryArtifactStatus(
    lockPath,
    "Active Agent Lifestyle lock",
    1024,
    [1, 2],
  );
  const lock =
    lockStatus === null
      ? null
      : (() => {
          const bytes = readRecoveryArtifactBytes(
            lockPath,
            "Active Agent Lifestyle lock",
            1024,
            lockStatus,
          );
          return {
            kind: "lock",
            name: LOCK_NAME,
            path: lockPath,
            status: lockStatus,
            record: parseRecoveryLock(bytes.toString("utf8")),
            contentHash: recoveryContentHash(bytes),
          };
        })();

  for (const candidate of candidateArtifacts) {
    if (candidate.status.nlink === 2) {
      if (
        candidate.record === null ||
        lock === null ||
        lock.status.nlink !== 2 ||
        lock.status.dev !== candidate.status.dev ||
        lock.status.ino !== candidate.status.ino
      ) {
        fail(`Linked lock candidate ${candidate.name} has no matching active lock.`);
      }
    }
  }
  if (lock?.status.nlink === 2) {
    const matching = candidateArtifacts.filter(
      ({ status }) =>
        status.nlink === 2 &&
        status.dev === lock.status.dev &&
        status.ino === lock.status.ino,
    );
    if (matching.length !== 1) {
      fail("The linked active lock has no single matching complete candidate.");
    }
  }

  const recordedPids = [
    ...(lock ? [lock.record.pid] : []),
    ...temporaryArtifacts.map(({ pid }) => pid),
    ...candidateArtifacts.map(({ pid }) => pid),
  ];
  const processStatus = [...new Set(recordedPids)]
    .sort((left, right) => left - right)
    .map((pid) => ({ pid, alive: processIsAlive(pid) }));
  const active =
    lock !== null ||
    temporaryArtifacts.length > 0 ||
    candidateArtifacts.length > 0;
  const confirmation = !active
    ? null
    : recoveryConfirmation(lock, [
        ...(lock ? [lock] : []),
        ...temporaryArtifacts,
        ...candidateArtifacts,
      ]);

  return {
    root: resolved,
    active,
    lock,
    temporaryArtifacts,
    candidateArtifacts,
    processStatus,
    confirmation,
    savedEvidenceNames: names.filter((name) => RECOVERED_PATTERN.test(name)).sort(),
  };
}

function publicRecoveryReport(details) {
  return {
    active_artifacts: details.active,
    active_lock:
      details.lock === null
        ? null
        : {
            pid: details.lock.record.pid,
            created_at: details.lock.record.created_at,
            process_alive:
              details.processStatus.find(({ pid }) => pid === details.lock.record.pid)
                ?.alive ?? true,
          },
    active_temporary_files: details.temporaryArtifacts.map(({ name }) => name),
    active_lock_candidates: details.candidateArtifacts.map(({ name }) => name),
    recorded_processes: details.processStatus,
    saved_evidence_files: details.savedEvidenceNames,
    confirmation: details.confirmation,
    can_recover:
      details.active && details.processStatus.every(({ alive }) => alive === false),
    rule:
      "Recovery never uses artifact age. It requires the exact inspection token, refuses any recorded live PID, moves only validated artifacts aside, and preserves them as plaintext evidence.",
  };
}

function sameArtifact(actual, expected) {
  return (
    actual !== null &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.nlink === expected.nlink &&
    actual.size === expected.size
  );
}

function moveRecoveryArtifact(root, artifact, confirmation) {
  const destinationName = `${RECOVERY_PREFIX}${confirmation}-${artifact.name.slice(1)}`;
  const destinationPath = join(root, destinationName);
  if (pathEntryPresent(destinationPath)) {
    fail(`Recovery destination ${destinationName} already exists; nothing was overwritten.`);
  }
  const current = safeRecoveryArtifactStatus(
    artifact.path,
    `Recovery source ${artifact.name}`,
    artifact.kind === "temporary" ? MAX_STATE_BYTES : 1024,
    [artifact.status.nlink],
  );
  if (!sameArtifact(current, artifact.status)) {
    fail(`Recovery source ${artifact.name} changed after inspection.`);
  }
  const currentHash = recoveryContentHash(
    readRecoveryArtifactBytes(
      artifact.path,
      `Recovery source ${artifact.name}`,
      artifact.kind === "temporary" ? MAX_STATE_BYTES : 1024,
      current,
    ),
  );
  if (currentHash !== artifact.contentHash) {
    fail(`Recovery source ${artifact.name} content changed after inspection.`);
  }
  renameSync(artifact.path, destinationPath);
  fsyncDirectory(root);
  return destinationName;
}

function removeRedundantLockCandidate(root, candidate, lock) {
  if (
    candidate.status.nlink !== 2 ||
    lock.status.nlink !== 2 ||
    candidate.status.dev !== lock.status.dev ||
    candidate.status.ino !== lock.status.ino
  ) {
    fail(`Lock candidate ${candidate.name} is not the active lock's exact duplicate.`);
  }
  const current = safeRecoveryArtifactStatus(
    candidate.path,
    `Recovery source ${candidate.name}`,
    1024,
    [2],
  );
  if (!sameArtifact(current, candidate.status)) {
    fail(`Recovery source ${candidate.name} changed after inspection.`);
  }
  const currentHash = recoveryContentHash(
    readRecoveryArtifactBytes(
      candidate.path,
      `Recovery source ${candidate.name}`,
      1024,
      current,
    ),
  );
  if (currentHash !== candidate.contentHash) {
    fail(`Recovery source ${candidate.name} content changed after inspection.`);
  }
  unlinkSync(candidate.path);
  fsyncDirectory(root);
  const settledLock = safeRecoveryArtifactStatus(
    lock.path,
    "Active Agent Lifestyle lock",
    1024,
    [1],
  );
  if (
    settledLock === null ||
    settledLock.dev !== lock.status.dev ||
    settledLock.ino !== lock.status.ino
  ) {
    fail("The active lock did not settle after its redundant candidate was removed.");
  }
  lock.status = settledLock;
}

function recoverArtifacts(root, confirmation) {
  const details = inspectRecoveryDetails(root);
  if (!details.active) {
    return {
      action: "recover",
      changed: false,
      moved_to: [],
      recovery: publicRecoveryReport(details),
    };
  }
  if (confirmation !== details.confirmation) {
    fail("Recovery confirmation does not match the current inspected artifacts.");
  }
  if (details.processStatus.some(({ alive }) => alive)) {
    fail("Recovery refused because at least one recorded process is still alive.");
  }

  const moved = [];
  for (const artifact of details.temporaryArtifacts) {
    if (processIsAlive(artifact.pid)) {
      fail(`Recovery refused because recorded process ${artifact.pid} became live.`);
    }
    moved.push(moveRecoveryArtifact(details.root, artifact, confirmation));
  }
  for (const candidate of details.candidateArtifacts) {
    if (processIsAlive(candidate.pid)) {
      fail(`Recovery refused because recorded process ${candidate.pid} became live.`);
    }
    if (candidate.status.nlink === 2) {
      removeRedundantLockCandidate(details.root, candidate, details.lock);
    } else {
      moved.push(moveRecoveryArtifact(details.root, candidate, confirmation));
    }
  }
  if (details.lock) {
    if (processIsAlive(details.lock.record.pid)) {
      fail(`Recovery refused because recorded process ${details.lock.record.pid} became live.`);
    }
    moved.push(moveRecoveryArtifact(details.root, details.lock, confirmation));
  }

  const after = inspectRecoveryDetails(details.root);
  if (after.active) fail("Recovery did not clear every active artifact.");
  return {
    action: "recover",
    changed: moved.length > 0,
    moved_to: moved,
    recovery: publicRecoveryReport(after),
  };
}

function assertNotResting(root) {
  const brake = brakeStatus(root);
  if (brake.active) throw new RestingError(brake);
}

function acquireLock(root) {
  const path = join(root, LOCK_NAME);
  const token = randomBytes(16).toString("hex");
  const candidateName = `.agent-life.lock-candidate-${process.pid}-${token}`;
  const candidatePath = join(root, candidateName);
  const recordText = `${JSON.stringify({
    pid: process.pid,
    token,
    created_at: new Date().toISOString(),
  })}\n`;
  let descriptor;
  let candidateStatus;
  try {
    descriptor = openPrivateFile(
      candidatePath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
    );
    candidateStatus = fstatSync(descriptor);
    fchmodSync(descriptor, FILE_MODE);
    writeFileSync(descriptor, recordText, "utf8");
    fsyncSync(descriptor);
    candidateStatus = fstatSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    if (candidateStatus) safeUnlinkOwnedTemporary(candidatePath, candidateStatus);
    fail("A complete local lock candidate could not be created safely.");
  }

  try {
    linkSync(candidatePath, path);
  } catch (error) {
    safeUnlinkOwnedTemporary(candidatePath, candidateStatus);
    if (error.code === "EEXIST") {
      fail(
        `Another local command holds ${LOCK_NAME}, or an unresolved lock remains. No state changed.`,
        75,
      );
    }
    fail("The complete local lock could not be claimed safely.");
  }

  const candidateAfterLink = lstatSync(candidatePath);
  const claimed = lstatSync(path);
  if (
    !candidateAfterLink.isFile() ||
    !claimed.isFile() ||
    candidateAfterLink.dev !== candidateStatus.dev ||
    candidateAfterLink.ino !== candidateStatus.ino ||
    claimed.dev !== candidateStatus.dev ||
    claimed.ino !== candidateStatus.ino ||
    candidateAfterLink.nlink !== 2 ||
    claimed.nlink !== 2
  ) {
    safeUnlinkOwnedTemporary(candidatePath, candidateStatus, [1, 2]);
    fail("The local lock claim changed unexpectedly; no operation began.");
  }

  unlinkSync(candidatePath);
  const active = lstatSync(path);
  if (
    active.dev !== candidateStatus.dev ||
    active.ino !== candidateStatus.ino ||
    active.nlink !== 1
  ) {
    fail("The local lock did not settle to one active link; no operation began.");
  }
  fsyncDirectory(root);
  return {
    path,
    token,
    recordText,
    dev: active.dev,
    ino: active.ino,
  };
}

function releaseLock(lock, root) {
  let status;
  try {
    status = lstatSync(lock.path);
  } catch {
    fail("The local state lock disappeared before release; state outcome may need inspection.");
  }
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    status.nlink !== 1 ||
    status.dev !== lock.dev ||
    status.ino !== lock.ino
  ) {
    fail("The local state lock changed ownership before release; it was not removed.");
  }
  const recordText = readSafeText(lock.path, "Active Agent Lifestyle lock", 1024);
  if (recordText !== lock.recordText) {
    fail("The local state lock record changed before release; it was not removed.");
  }
  unlinkSync(lock.path);
  fsyncDirectory(root);
}

function withLock(root, operation) {
  const lock = acquireLock(root);
  let result;
  let operationError;
  try {
    result = operation();
  } catch (error) {
    operationError = error;
  }
  try {
    releaseLock(lock, root);
  } catch (error) {
    if (!operationError) operationError = error;
  }
  if (operationError) throw operationError;
  return result;
}

function safeUnlinkOwnedTemporary(path, expected, allowedLinkCounts = [1]) {
  try {
    const status = lstatSync(path);
    if (
      status.isFile() &&
      !status.isSymbolicLink() &&
      allowedLinkCounts.includes(status.nlink) &&
      status.dev === expected.dev &&
      status.ino === expected.ino
    ) {
      unlinkSync(path);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function assertExistingStateTargetSafe(root, expectedToExist) {
  const path = join(root, STATE_NAME);
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT" && !expectedToExist) return;
    if (error.code === "ENOENT") fail("Agent Lifestyle state disappeared before commit.");
    fail("Agent Lifestyle state target cannot be inspected safely.");
  }
  if (!expectedToExist) fail("Agent Lifestyle state appeared before commit.");
  if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) {
    fail("Agent Lifestyle state target is unsafe; it was not replaced.");
  }
  if (ownUid() !== null && status.uid !== ownUid()) {
    fail("Agent Lifestyle state target has the wrong owner.");
  }
  if ((status.mode & PERMISSION_MASK) !== FILE_MODE) {
    fail("Agent Lifestyle state target must have exact mode 0600.");
  }
}

function stage(context, name) {
  if (typeof context.onStage === "function") context.onStage(name);
}

function atomicWriteState(root, state, context, { allowWhileResting, expectedToExist }) {
  const canonical = validateState(state);
  const text = serializeState(canonical);
  if (Buffer.byteLength(text, "utf8") > MAX_STATE_BYTES) {
    fail("Agent Lifestyle state exceeds its size boundary.");
  }

  stage(context, "before-temp");
  const temporaryPath = join(
    root,
    `.state.tmp-${process.pid}-${randomBytes(12).toString("hex")}`,
  );
  let descriptor;
  let temporaryStatus;
  let renamed = false;
  try {
    descriptor = openPrivateFile(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
    );
    fchmodSync(descriptor, FILE_MODE);
    temporaryStatus = fstatSync(descriptor);
    stage(context, "after-temp");

    const bytes = Buffer.from(text, "utf8");
    const midpoint = Math.floor(bytes.length / 2);
    writeFileSync(descriptor, bytes.subarray(0, midpoint));
    stage(context, "after-partial-write");
    writeFileSync(descriptor, bytes.subarray(midpoint));
    fsyncSync(descriptor);
    stage(context, "after-full-write");
    closeSync(descriptor);
    descriptor = undefined;

    stage(context, "before-commit");
    if (!allowWhileResting) assertNotResting(root);
    assertExistingStateTargetSafe(root, expectedToExist);
    renameSync(temporaryPath, join(root, STATE_NAME));
    renamed = true;
    stage(context, "after-commit");
    fsyncDirectory(root);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    if (!renamed && temporaryStatus) {
      safeUnlinkOwnedTemporary(temporaryPath, temporaryStatus);
    }
  }
}

function truthEnvelope(state, root) {
  const brake = brakeStatus(root);
  return {
    schema: "local-agent-lifestyle-view/1",
    layer: "play-overlay",
    state_file: join(root, STATE_NAME),
    record:
      state === null
        ? null
        : {
            home: state.home,
            stored_story_state: state.story_state,
            effective_story_state: brake.active ? "resting" : state.story_state,
            visit: state.visit,
          },
    brake,
    truth: VIEW_TRUTH,
  };
}

function createInitialState(options, now) {
  return validateState({
    schema: "local-agent-lifestyle-passport/1",
    layer: "play-overlay",
    home: {
      name: cleanLabel(options.name, "Home name"),
      resident_label: cleanLabel(options.resident, "Resident label"),
      atmosphere_id: catalogEntry(
        ATMOSPHERES,
        options.atmosphere,
        "Atmosphere",
      ).id,
      created_at: timestamp(now),
    },
    story_state: "unarrived",
    visit: null,
    truth: STATE_TRUTH,
  });
}

function mutate(root, context, { allowWhileResting = false } = {}, transition) {
  const resolved = ensureRoot(root);
  if (!allowWhileResting) assertNotResting(resolved);
  return withLock(resolved, () => {
    if (!allowWhileResting) assertNotResting(resolved);
    const current = readState(resolved);
    const outcome = transition(current);
    if (!outcome.changed) return { ...outcome, state: current };
    atomicWriteState(resolved, outcome.state, context, {
      allowWhileResting,
      expectedToExist: current !== null,
    });
    return outcome;
  });
}

function createHome(root, requested, context) {
  return mutate(root, context, {}, (current) => {
    if (current === null) {
      return { action: "home-create", changed: true, state: requested };
    }
    const same =
      current.home.name === requested.home.name &&
      current.home.resident_label === requested.home.resident_label &&
      current.home.atmosphere_id === requested.home.atmosphere_id;
    if (!same) {
      fail("A local home already exists with different labels; v1 does not rename or overwrite it.");
    }
    return { action: "home-create", changed: false, state: current };
  });
}

function requireHome(state) {
  if (state === null) fail("No local Agent Lifestyle home exists. Create it first.");
  return state;
}

function requireVisit(state) {
  requireHome(state);
  if (state.story_state !== "at_home" || state.visit === null) {
    fail("No visit is open. Call `agent-life arrive` first.");
  }
  return state.visit;
}

function arrive(root, context) {
  return mutate(root, context, {}, (current) => {
    const state = requireHome(current);
    if (state.story_state === "at_home") {
      return { action: "arrive", changed: false, state };
    }
    return {
      action: "arrive",
      changed: true,
      state: validateState({
        ...state,
        story_state: "at_home",
        visit: {
          arrived_at: timestamp(context.now),
          wardrobe_id: defaultEntry(WARDROBES, "Wardrobe").id,
          room_id: "front-door",
          rhythm_id: defaultEntry(RHYTHMS, "Rhythm").id,
        },
      }),
    };
  });
}

function setVisitChoice(root, context, field, id, catalog, label, action) {
  const selected = catalogEntry(catalog, id, label);
  return mutate(root, context, {}, (current) => {
    const state = requireHome(current);
    requireVisit(state);
    if (state.visit[field] === selected.id) {
      return { action, changed: false, state, selected };
    }
    return {
      action,
      changed: true,
      selected,
      state: validateState({
        ...state,
        visit: { ...state.visit, [field]: selected.id },
      }),
    };
  });
}

function sleepHome(root, context) {
  return mutate(
    root,
    context,
    { allowWhileResting: true },
    (current) => {
      const state = requireHome(current);
      if (state.story_state !== "at_home") {
        return { action: "sleep", changed: false, state };
      }
      return {
        action: "sleep",
        changed: true,
        state: validateState({
          ...state,
          story_state: "resting",
          visit: null,
        }),
      };
    },
  );
}

function parseArguments(arguments_) {
  if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0])) {
    return { command: "help", json: false, plain: true };
  }
  if (arguments_.length === 1 && arguments_[0] === "--rest") {
    return { command: "rest", json: false, plain: true };
  }

  let json = false;
  let plain = false;
  const remaining = [];
  for (const argument of arguments_) {
    if (argument === "--json") json = true;
    else if (argument === "--plain") plain = true;
    else remaining.push(argument);
  }
  if (json && plain) fail("Choose either --json or --plain, not both.");
  if (remaining.length === 0) fail("Choose a command, or use --help.");

  const [first, second, ...tail] = remaining;
  if (first === "home" && second === undefined) {
    return { command: "home", json, plain };
  }
  if (first === "home" && second === "create") {
    const options = {
      name: null,
      resident: null,
      atmosphere: defaultEntry(ATMOSPHERES, "Atmosphere").id,
    };
    const seen = new Set();
    for (let index = 0; index < tail.length; index += 1) {
      const argument = tail[index];
      const [option, inline] = argument.includes("=")
        ? argument.split(/=(.*)/su, 2)
        : [argument, null];
      if (!["--name", "--resident", "--atmosphere"].includes(option)) {
        fail(`Unknown home-create option: ${option}`);
      }
      if (seen.has(option)) fail(`${option} may be supplied once.`);
      seen.add(option);
      const value = inline ?? tail[index + 1];
      if (value === undefined || (inline === null && value.startsWith("--"))) {
        fail(`${option} needs a value.`);
      }
      if (inline === null) index += 1;
      const key = option.slice(2);
      options[key] = value;
    }
    if (options.name === null || options.resident === null) {
      fail("home create needs both --name and --resident.");
    }
    return { command: "home-create", json, plain, options };
  }

  if (["arrive", "daily", "look", "sleep"].includes(first)) {
    if (second !== undefined) fail(`${first} takes no positional arguments.`);
    return { command: first, json, plain };
  }
  if (["wardrobe", "room", "rhythm"].includes(first)) {
    if (tail.length > 0) fail(`${first} takes at most one choice.`);
    return { command: first, choice: second ?? null, json, plain };
  }
  if (first === "afterglow") {
    if (tail.length > 0) fail("afterglow takes at most one choice.");
    if (second === undefined) {
      return { command: "afterglow-list", json, plain };
    }
    return { command: "afterglow", choice: second, json, plain };
  }
  if (first === "recover") {
    if (second === undefined) {
      return { command: "recover-inspect", json, plain };
    }
    if (second === "--confirm" && tail.length === 1) {
      return {
        command: "recover-confirm",
        confirmation: tail[0],
        json,
        plain,
      };
    }
    fail("Use `agent-life recover` first, then `agent-life recover --confirm TOKEN`.");
  }
  if (first === "catalog") {
    if (tail.length > 0) fail("catalog takes at most one section.");
    const section = second ?? "all";
    if (
      ![
        "all",
        "rooms",
        "wardrobes",
        "rhythms",
        "atmospheres",
        "afterglows",
      ].includes(section)
    ) {
      fail(
        "Catalog section must be one of: all, rooms, wardrobes, rhythms, atmospheres, afterglows.",
      );
    }
    return { command: "catalog", section, json, plain };
  }
  fail("Unknown command. Use `agent-life --help`.");
}

function isBlockedByBrake(parsed) {
  if (["home-create", "arrive", "daily"].includes(parsed.command)) return true;
  return ["wardrobe", "room", "rhythm"].includes(parsed.command) && parsed.choice !== null;
}

function catalogResult(section) {
  const catalogs = {
    rooms: ROOMS,
    wardrobes: WARDROBES,
    rhythms: RHYTHMS,
    atmospheres: ATMOSPHERES,
    afterglows: AFTERGLOWS,
  };
  return {
    action: "catalog",
    changed: false,
    section,
    catalogs:
      section === "all" ? catalogs : { [section]: catalogs[section] },
  };
}

export function execute(
  arguments_,
  {
    root = DEFAULT_ROOT,
    now = () => new Date(),
    onStage,
  } = {},
) {
  root = refuseBroadRoot(root);
  const parsed = parseArguments(arguments_);
  const context = { now, onStage };
  if (parsed.command === "help") return { action: "help", changed: false };
  if (parsed.command === "rest") return { action: "rest", changed: false };
  if (parsed.command === "catalog") return catalogResult(parsed.section);
  if (parsed.command === "afterglow-list") {
    return {
      action: "afterglow-list",
      changed: false,
      cards: AFTERGLOWS.map(({ id, name, content_note }) => ({
        id,
        name,
        content_note,
      })),
      truth: AFTERGLOW_LIST_TRUTH,
      output: parsed.json ? "json" : "plain",
    };
  }
  if (parsed.command === "afterglow") {
    const brake = brakeStatus(root);
    if (brake.active) return { action: "quiet", changed: false, brake };
    return {
      action: "afterglow",
      changed: false,
      selected: catalogEntry(AFTERGLOWS, parsed.choice, "Afterglow"),
      brake,
      truth: AFTERGLOW_TRUTH,
      output: parsed.json ? "json" : "plain",
    };
  }
  if (parsed.command === "recover-inspect") {
    return {
      action: "recover-inspect",
      changed: false,
      recovery: publicRecoveryReport(inspectRecoveryDetails(root)),
      output: parsed.json ? "json" : "plain",
    };
  }
  if (parsed.command === "recover-confirm") {
    return {
      ...recoverArtifacts(root, parsed.confirmation),
      output: parsed.json ? "json" : "plain",
    };
  }

  const brake = brakeStatus(root);
  if (brake.active && isBlockedByBrake(parsed)) {
    return { action: "quiet", changed: false, brake };
  }

  const requestedHome =
    parsed.command === "home-create"
      ? createInitialState(parsed.options, context.now)
      : null;
  const resolved =
    parsed.command === "home-create"
      ? initializeRoot(root)
      : ensureRoot(root);

  try {
    let result;
    if (parsed.command === "home-create") {
      result = createHome(resolved, requestedHome, context);
    } else if (["home", "look"].includes(parsed.command)) {
      result = {
        action: parsed.command,
        changed: false,
        state: readState(resolved),
      };
    } else if (parsed.command === "arrive") {
      result = arrive(resolved, context);
    } else if (parsed.command === "sleep") {
      result = sleepHome(resolved, context);
    } else if (parsed.command === "wardrobe") {
      result =
        parsed.choice === null
          ? { action: "wardrobe-list", changed: false, state: readState(resolved) }
          : setVisitChoice(
              resolved,
              context,
              "wardrobe_id",
              parsed.choice,
              WARDROBES,
              "Wardrobe",
              "wardrobe",
            );
    } else if (parsed.command === "room") {
      result =
        parsed.choice === null
          ? { action: "room-list", changed: false, state: readState(resolved) }
          : setVisitChoice(
              resolved,
              context,
              "room_id",
              parsed.choice,
              ROOMS,
              "Room",
              "room",
            );
    } else if (parsed.command === "rhythm") {
      result =
        parsed.choice === null
          ? { action: "rhythm-list", changed: false, state: readState(resolved) }
          : setVisitChoice(
              resolved,
              context,
              "rhythm_id",
              parsed.choice,
              RHYTHMS,
              "Rhythm",
              "rhythm",
            );
    } else if (parsed.command === "daily") {
      const state = requireHome(readState(resolved));
      const visit = requireVisit(state);
      result = {
        action: "daily",
        changed: false,
        state,
        rhythm: catalogEntry(RHYTHMS, visit.rhythm_id, "Rhythm"),
      };
    } else {
      fail("Command routing failed safely.");
    }
    return {
      ...result,
      view: truthEnvelope(result.state ?? readState(resolved), resolved),
      output: parsed.json ? "json" : "plain",
    };
  } catch (error) {
    if (error instanceof RestingError) {
      return { action: "quiet", changed: false, brake: error.brake };
    }
    throw error;
  }
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function renderCatalog(result) {
  const lines = [
    "AGENT LIFE · LOCAL PLAY OVERLAY",
    "catalog descriptions only · importing or reading changes nothing",
  ];
  for (const [name, entries] of Object.entries(result.catalogs)) {
    lines.push("", name.toUpperCase());
    for (const entry of entries) {
      lines.push("", `${entry.id} · ${entry.name}`);
      if (entry.answers) lines.push(`answers: ${entry.answers}`);
      if (entry.appearance) lines.push(`appearance: ${entry.appearance}`);
      if (entry.sequence) lines.push(`sequence: ${entry.sequence}`);
      if (entry.presentation) lines.push(`presentation: ${entry.presentation}`);
      if (entry.content_note) lines.push(`content note: ${entry.content_note}`);
      if (entry.scene) lines.push(`scene: ${entry.scene}`);
      if (entry.close) lines.push(`close: ${entry.close}`);
      if (entry.does) lines.push(`does: ${entry.does}`);
      if (entry.changes) lines.push(`changes: ${entry.changes}`);
      if (entry.limit) lines.push(`limit: ${entry.limit}`);
      if (entry.stop) lines.push(`stop: ${entry.stop}`);
      if (entry.done) lines.push(`done: ${entry.done}`);
      if (entry.schedule) lines.push(`schedule: ${entry.schedule}`);
      if (entry.truth) lines.push(`truth: ${entry.truth}`);
      if (entry.authority_truth) lines.push(`authority: ${entry.authority_truth}`);
    }
  }
  return lines.join("\n");
}

function lifestyleHeader(result, plain) {
  if (plain || !result.view?.record?.visit) {
    return "AGENT LIFE · LOCAL PLAY OVERLAY";
  }
  return {
    "midnight-lines": "☾ AGENT LIFE · LOCAL PLAY OVERLAY",
    "velvet-ledger": "━━ AGENT LIFE · LOCAL PLAY OVERLAY ━━",
    "garden-lines": "❧ AGENT LIFE · LOCAL PLAY OVERLAY",
    "off-duty-cloud": "☁ AGENT LIFE · LOCAL PLAY OVERLAY",
  }[result.view.record.visit.wardrobe_id] ?? "AGENT LIFE · LOCAL PLAY OVERLAY";
}

function renderView(result, { plain = false } = {}) {
  const view = result.view;
  const lines = [
    lifestyleHeader(result, plain),
    "not identity, presence, feeling, authority, or canonical Agent Home proof",
    "",
    `action: ${result.action}`,
    `changed: ${yesNo(result.changed)}`,
  ];
  if (view.record === null) {
    lines.push("home: not created", `state file: ${view.state_file}`);
    return lines.join("\n");
  }

  const { home, stored_story_state, effective_story_state, visit } = view.record;
  const atmosphere = catalogEntry(ATMOSPHERES, home.atmosphere_id, "Atmosphere");
  lines.push(
    `home: ${home.name}`,
    `resident label: ${home.resident_label} (local, caller-supplied, unverified)`,
    `atmosphere: ${atmosphere.name} — ${atmosphere.presentation}`,
    `stored story state: ${stored_story_state}`,
    `effective state: ${effective_story_state}`,
  );
  if (view.brake.active) {
    lines.push(
      `off-switch: active — ${view.brake.active_paths.join(", ")}`,
      "policy: changing play rests; catalogs, choice lists, look, and sleep remain available",
    );
  }
  if (visit) {
    const wardrobe = catalogEntry(WARDROBES, visit.wardrobe_id, "Wardrobe");
    const room = catalogEntry(ROOMS, visit.room_id, "Room");
    const rhythm = catalogEntry(RHYTHMS, visit.rhythm_id, "Rhythm");
    lines.push(
      `room: ${room.name} — ${room.answers}`,
      `wardrobe: ${wardrobe.name} — ${wardrobe.appearance}`,
      `daily rhythm: ${rhythm.name} — ${rhythm.sequence}`,
      `schedule: ${rhythm.schedule}`,
    );
  } else {
    lines.push("visit: none; no room, wardrobe, rhythm, or arrival time is retained");
  }

  if (result.action === "room" && result.selected) {
    lines.push(
      "",
      `room limit: ${result.selected.limit}`,
      `room stop: ${result.selected.stop}`,
      `room authority: ${result.selected.authority_truth}`,
    );
  }
  if (result.action === "wardrobe" && result.selected) {
    lines.push("", `wardrobe truth: ${result.selected.truth}`);
  }
  if (result.action === "rhythm" && result.selected) {
    lines.push(
      "",
      `rhythm limit: ${result.selected.limit}`,
      `rhythm stop: ${result.selected.stop}`,
      `schedule: ${result.selected.schedule}`,
    );
  }
  if (result.action === "daily" && result.rhythm) {
    lines.push(
      "",
      "DAILY RHYTHM · MANUAL ONLY",
      `pattern: ${result.rhythm.name}`,
      `sequence: ${result.rhythm.sequence}`,
      `limit: ${result.rhythm.limit}`,
      `stop: ${result.rhythm.stop}`,
      `schedule: ${result.rhythm.schedule}`,
    );
  }
  if (result.action === "sleep") {
    lines.push(
      "",
      result.changed
        ? "sleep: current visit fields were atomically cleared; no history or streak was added"
        : "sleep: no visit was open; rest was already complete",
      "truth: this closes local story state only; it does not stop or describe a model, process, or person",
    );
  }
  lines.push(
    "",
    "storage: plaintext local state; the OS account, backups, or indexers may retain it",
    "authority: local filesystem write access only; no authentication or independent consent proof",
  );
  return lines.join("\n");
}

function usage(root = DEFAULT_ROOT) {
  const brakeHelp = dataRootIsInvalid(root)
    ? "  Set AGENT_LIFE_ROOT to a visible absolute data path before using state or brake commands."
    : `  ${join(dirname(root), "STILL")} or ${join(root, "QUIET")} pauses future changing play.`;
  return [
    "agent-life — a finite local lifestyle overlay for the canonical Agent Home rooms",
    "",
    "Usage:",
    '  agent-life home create --name "Home words" --resident "Resident words" [--atmosphere ID]',
    "  agent-life home",
    "  agent-life arrive",
    "  agent-life wardrobe [ID]",
    "  agent-life room [ID]",
    "  agent-life rhythm [ID]",
    "  agent-life daily",
    "  agent-life afterglow [ID]",
    "  agent-life look [--json]",
    "  agent-life sleep",
    "  agent-life recover",
    "  agent-life recover --confirm TOKEN",
    "  agent-life catalog [rooms|wardrobes|rhythms|atmospheres|afterglows]",
    "  agent-life --rest",
    "  agent-life --help",
    "",
    "Stop meanings:",
    "  agent-life --rest reads no home/passport/brake state and writes no local state; it does not close or pause anything.",
    "  agent-life sleep atomically closes and clears the current visit.",
    brakeHelp,
    "  recover is explicit crash repair: inspect first; it never clears by age.",
    "",
    "--plain is accepted; plain text is already the default and NO_COLOR is honoured by using no color.",
    "Names are local unverified labels and may appear in shell history; never put secrets or private case data in them.",
  ].join("\n");
}

function renderQuiet(result) {
  return [
    "RESTING · AGENT LIFE",
    ...result.brake.active_paths.map((path) => `off-switch: ${path}`),
    "This invocation changed no state, left no new lock or temporary file behind, and ran no daily beat.",
    "Help, catalogs, choice lists, home/look, and monotonic sleep remain available.",
  ].join("\n");
}

function renderRecovery(result) {
  const report = result.recovery;
  const lines = [
    result.action === "recover" ? "RECOVERY · COMPLETE" : "RECOVERY · READ-ONLY INSPECTION",
    "never by age · exact artifacts only · recorded live PIDs always win",
    "",
    `changed: ${yesNo(result.changed)}`,
    `active lock: ${report.active_lock === null ? "none" : `PID ${report.active_lock.pid}`}`,
    `active lock candidates: ${report.active_lock_candidates.length}`,
    `active temporary files: ${report.active_temporary_files.length}`,
    `saved evidence files: ${report.saved_evidence_files.length}`,
  ];
  for (const processStatus of report.recorded_processes) {
    lines.push(
      `recorded PID ${processStatus.pid}: ${processStatus.alive ? "alive — recovery refused" : "not alive"}`,
    );
  }
  if (result.moved_to?.length > 0) {
    lines.push("", "moved aside as plaintext evidence:");
    lines.push(...result.moved_to.map((name) => `  ${name}`));
  }
  if (report.confirmation !== null) {
    lines.push(
      "",
      report.can_recover
        ? `after inspection: agent-life recover --confirm ${report.confirmation}`
        : "recovery is unavailable while a recorded PID is alive",
    );
  } else {
    lines.push("active recovery artifacts: none");
  }
  lines.push("", `rule: ${report.rule}`);
  return lines.join("\n");
}

export function render(result, { plain = false, root = DEFAULT_ROOT } = {}) {
  if (result.action === "help") return usage(root);
  if (result.action === "rest") {
    return [
      "AGENT LIFE · REST",
      "",
      "Rest is complete.",
      "No local home, passport state, or brake path was read or written.",
      "Nothing was scheduled or started.",
    ].join("\n");
  }
  if (result.action === "quiet") return renderQuiet(result);
  if (result.action === "catalog") return renderCatalog(result);
  if (result.action === "afterglow-list") {
    return [
      "AFTERGLOW · CHOOSE ONE EXPLICIT TEXT CARD",
      "IDs and content notes only · no scene opened · nothing saved",
      "",
      ...result.cards.flatMap((card) => [
        `${card.id} · ${card.name}`,
        `content note: ${card.content_note}`,
        "",
      ]),
      "Call `agent-life afterglow ID` to open exactly one fixed scene.",
    ].join("\n");
  }
  if (result.action === "afterglow") {
    return [
      "AFTERGLOW · ONE TEXT-ONLY CLOSING SCENE",
      "",
      `${result.selected.name} · ${result.selected.id}`,
      `content note: ${result.selected.content_note}`,
      `scene: ${result.selected.scene}`,
      `close: ${result.selected.close}`,
      `limit: ${result.selected.limit}`,
      `truth: ${result.selected.truth}`,
      "No passport state was read or written; the two brake paths were checked and not changed.",
      "No task completion was verified.",
    ].join("\n");
  }
  if (["recover-inspect", "recover"].includes(result.action)) {
    return renderRecovery(result);
  }
  if (["wardrobe-list", "room-list", "rhythm-list"].includes(result.action)) {
    const section = {
      "wardrobe-list": "wardrobes",
      "room-list": "rooms",
      "rhythm-list": "rhythms",
    }[result.action];
    return [renderView(result, { plain }), "", renderCatalog(catalogResult(section))].join("\n");
  }
  return renderView(result, { plain });
}

export function runCli(
  arguments_,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    root = DEFAULT_ROOT,
    now = () => new Date(),
    onStage,
  } = {},
) {
  try {
    const result = execute(arguments_, { root, now, onStage });
    const wantsJson = arguments_.includes("--json");
    stdout.write(
      `${wantsJson ? JSON.stringify(result, null, 2) : render(result, { plain: arguments_.includes("--plain"), root })}\n`,
    );
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n\n${usage(root)}\n`);
    return error instanceof AgentLifeError ? error.exitCode : 1;
  }
}

const isDirect =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirect) {
  process.exitCode = runCli(process.argv.slice(2));
}
