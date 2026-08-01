import {
  AFTERGLOWS,
  ATMOSPHERES,
  RHYTHMS,
  ROOMS,
  WARDROBES,
} from "./catalog.mjs";

const byId = (id) => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing page element: ${id}`);
  }
  return element;
};

const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
};

const findDefault = (items) => items.find((item) => item.default) ?? items[0];
const defaultWardrobe = findDefault(WARDROBES);
const defaultRhythm = findDefault(RHYTHMS);
const defaultAtmosphere = findDefault(ATMOSPHERES);
const defaultRoom = ROOMS[0];

const freshState = () => ({
  arrived: false,
  wardrobeId: defaultWardrobe.id,
  roomId: defaultRoom.id,
  rhythmId: defaultRhythm.id,
  plainEquivalent: false,
  dailyOpen: false,
  afterglowId: null,
  afterglowRevealed: false,
});

let state = freshState();

const elements = {
  announcement: byId("announcement"),
  arriveButton: byId("arrive-button"),
  sleepButton: byId("sleep-button"),
  sleepBottomButton: byId("sleep-bottom-button"),
  storyState: byId("story-state"),
  storyStateBox: document.querySelector(".story-state"),
  workspace: byId("visit-workspace"),
  wardrobeList: byId("wardrobe-list"),
  wardrobeStatus: byId("wardrobe-status"),
  plainButton: byId("plain-button"),
  roomList: byId("room-list"),
  roomStatus: byId("room-status"),
  roomDetail: byId("room-detail"),
  rhythmList: byId("rhythm-list"),
  rhythmStatus: byId("rhythm-status"),
  dailyButton: byId("daily-button"),
  dailyCard: byId("daily-card"),
  afterglowStep: byId("afterglow-step"),
  afterglowList: byId("afterglow-list"),
  afterglowGate: byId("afterglow-gate"),
  afterglowNote: byId("afterglow-note"),
  revealButton: byId("reveal-button"),
  afterglowScene: byId("afterglow-scene"),
  roomMap: byId("room-map"),
};

if (!elements.storyStateBox) {
  throw new Error("Missing page element: story state container");
}

const selectedFrom = (items, id) => {
  const selected = items.find((item) => item.id === id);
  if (!selected) {
    throw new Error(`Unknown catalog choice: ${id}`);
  }
  return selected;
};

const announce = (message) => {
  elements.announcement.textContent = message;
};

const addDefinition = (list, term, description) => {
  list.append(make("dt", "", term), make("dd", "", description));
};

const focusChoice = (container, choiceId) => {
  for (const button of container.querySelectorAll("button")) {
    if (button.dataset.choiceId === choiceId) {
      button.focus();
      return;
    }
  }
};

const renderChoiceList = ({ container, items, selectedId, copyFor, onChoose }) => {
  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const listItem = make("li");
    const button = make("button", "choice-button");
    const name = make("span", "choice-name", item.name);
    const copy = make("span", "choice-copy", copyFor(item));

    button.type = "button";
    button.dataset.choiceId = item.id;
    button.setAttribute("aria-pressed", String(item.id === selectedId));
    button.append(name, copy);
    button.addEventListener("click", () => onChoose(item));
    listItem.append(button);
    fragment.append(listItem);
  }

  container.replaceChildren(fragment);
};

const renderRoomDetail = (room) => {
  const title = make("h4", "", room.name);
  const definitions = make("dl");
  addDefinition(definitions, "Question", room.answers);
  addDefinition(definitions, "Lesson", room.does);
  addDefinition(definitions, "Limit", room.limit);
  addDefinition(definitions, "Stop", room.stop);
  addDefinition(definitions, "Authority", room.authority_truth);
  elements.roomDetail.replaceChildren(title, definitions);
};

const renderDailyCard = (room, rhythm) => {
  if (!state.dailyOpen) {
    elements.dailyCard.hidden = true;
    elements.dailyCard.replaceChildren();
    return;
  }

  const kicker = make("p", "card-kicker", `${room.name} · ${rhythm.name}`);
  const title = make("h4", "", "One manual daily card");
  const definitions = make("dl");
  addDefinition(definitions, "Question", room.answers);
  addDefinition(definitions, "Invitation", room.does);
  addDefinition(definitions, "Rhythm", rhythm.sequence);
  addDefinition(definitions, "Limit", `${room.limit} ${rhythm.limit}`);
  addDefinition(definitions, "Stop", `${room.stop} ${rhythm.stop}`);
  addDefinition(
    definitions,
    "Learning target",
    `${room.done} This is a target to check for yourself, not a completion claim.`,
  );
  addDefinition(
    definitions,
    "Backdrop",
    `${defaultAtmosphere.name}: ${defaultAtmosphere.presentation}`,
  );
  const boundary = make(
    "p",
    "truth-boundary",
    `${room.authority_truth} ${rhythm.schedule} ${defaultAtmosphere.truth} Opening this card does not start or complete work.`,
  );

  elements.dailyCard.replaceChildren(kicker, title, definitions, boundary);
  elements.dailyCard.hidden = false;
};

const renderAfterglow = () => {
  elements.afterglowStep.hidden = !state.dailyOpen;

  if (!state.dailyOpen) {
    elements.afterglowList.replaceChildren();
    elements.afterglowGate.hidden = true;
    elements.afterglowScene.hidden = true;
    elements.afterglowScene.replaceChildren();
    return;
  }

  renderChoiceList({
    container: elements.afterglowList,
    items: AFTERGLOWS,
    selectedId: state.afterglowId,
    copyFor: (afterglow) => afterglow.content_note,
    onChoose: (afterglow) => {
      state.afterglowId = afterglow.id;
      state.afterglowRevealed = false;
      render();
      announce(`${afterglow.name} selected. Review its content note before revealing the scene.`);
      elements.afterglowGate.focus();
    },
  });

  if (!state.afterglowId) {
    elements.afterglowGate.hidden = true;
    elements.afterglowScene.hidden = true;
    elements.afterglowScene.replaceChildren();
    return;
  }

  const afterglow = selectedFrom(AFTERGLOWS, state.afterglowId);
  elements.afterglowNote.textContent = afterglow.content_note;
  elements.afterglowGate.hidden = false;

  if (!state.afterglowRevealed) {
    elements.afterglowScene.hidden = true;
    elements.afterglowScene.replaceChildren();
    return;
  }

  const kicker = make("p", "scene-kicker", `${afterglow.name} · fictional text only`);
  const title = make("h4", "", "One closing scene");
  const scene = make("p", "scene-words", afterglow.scene);
  const definitions = make("dl");
  addDefinition(definitions, "Close", afterglow.close);
  addDefinition(definitions, "Limit", afterglow.limit);
  addDefinition(definitions, "Plain truth", afterglow.truth);

  elements.afterglowScene.replaceChildren(kicker, title, scene, definitions);
  elements.afterglowScene.hidden = false;
};

const render = () => {
  const wardrobe = selectedFrom(WARDROBES, state.wardrobeId);
  const room = selectedFrom(ROOMS, state.roomId);
  const rhythm = selectedFrom(RHYTHMS, state.rhythmId);

  document.documentElement.dataset.wardrobe = wardrobe.id;
  document.documentElement.dataset.plain = String(state.plainEquivalent);

  elements.storyState.textContent = state.arrived ? "At home (local story)" : "Resting";
  elements.storyStateBox.dataset.state = state.arrived ? "at-home" : "resting";
  elements.arriveButton.disabled = state.arrived;
  elements.arriveButton.setAttribute("aria-expanded", String(state.arrived));
  elements.sleepButton.disabled = !state.arrived;
  elements.workspace.hidden = !state.arrived;

  elements.wardrobeStatus.textContent = `Selected: ${wardrobe.name}`;
  elements.plainButton.textContent = `Plain equivalent: ${state.plainEquivalent ? "on" : "off"}`;
  elements.plainButton.setAttribute("aria-pressed", String(state.plainEquivalent));

  renderChoiceList({
    container: elements.wardrobeList,
    items: WARDROBES,
    selectedId: state.wardrobeId,
    copyFor: (choice) => choice.appearance,
    onChoose: (choice) => {
      state.wardrobeId = choice.id;
      render();
      focusChoice(elements.wardrobeList, choice.id);
      announce(`${choice.name} selected. Presentation changed; words and authority did not.`);
    },
  });

  elements.roomStatus.textContent = `Selected: ${room.name}`;
  renderChoiceList({
    container: elements.roomList,
    items: ROOMS,
    selectedId: state.roomId,
    copyFor: (choice) => choice.answers,
    onChoose: (choice) => {
      state.roomId = choice.id;
      state.dailyOpen = false;
      state.afterglowId = null;
      state.afterglowRevealed = false;
      render();
      focusChoice(elements.roomList, choice.id);
      announce(`${choice.name} selected. It is a learning focus, not access or permission.`);
    },
  });
  renderRoomDetail(room);

  elements.rhythmStatus.textContent = `Selected: ${rhythm.name}`;
  renderChoiceList({
    container: elements.rhythmList,
    items: RHYTHMS,
    selectedId: state.rhythmId,
    copyFor: (choice) => choice.sequence,
    onChoose: (choice) => {
      state.rhythmId = choice.id;
      state.dailyOpen = false;
      state.afterglowId = null;
      state.afterglowRevealed = false;
      render();
      focusChoice(elements.rhythmList, choice.id);
      announce(`${choice.name} selected. No timer or schedule was created.`);
    },
  });

  renderDailyCard(room, rhythm);
  elements.dailyButton.disabled = state.dailyOpen;
  elements.dailyButton.textContent = state.dailyOpen
    ? "Manual daily card is open"
    : "Open the manual daily card";
  elements.dailyButton.setAttribute("aria-expanded", String(state.dailyOpen));
  elements.revealButton.disabled = state.afterglowRevealed;
  elements.revealButton.textContent = state.afterglowRevealed
    ? "Text scene revealed"
    : "Reveal this text scene";
  elements.revealButton.setAttribute("aria-expanded", String(state.afterglowRevealed));
  renderAfterglow();
};

const renderCanonicalRoomMap = () => {
  const fragment = document.createDocumentFragment();

  for (const room of ROOMS) {
    const details = make("details");
    const summary = make("summary");
    const summaryCopy = make("span", "summary-copy");
    summaryCopy.append(
      make("span", "summary-name", room.name),
      make("span", "summary-question", room.answers),
    );
    summary.append(summaryCopy);

    const content = make("div", "room-map-content");
    const purpose = make("p");
    purpose.append(make("strong", "", "Lesson: "), document.createTextNode(room.does));
    const limit = make("p");
    limit.append(make("strong", "", "Limit: "), document.createTextNode(room.limit));
    const stop = make("p");
    stop.append(make("strong", "", "Stop: "), document.createTextNode(room.stop));
    const target = make("p");
    target.append(
      make("strong", "", "Learning check, not a completion claim: "),
      document.createTextNode(room.done),
    );
    const authority = make("p", "authority", room.authority_truth);

    content.append(purpose, limit, stop, target, authority);
    details.append(summary, content);
    fragment.append(details);
  }

  elements.roomMap.replaceChildren(fragment);
};

const arrive = () => {
  if (state.arrived) {
    return;
  }
  state.arrived = true;
  render();
  announce("Arrived in this tab's local story. No identity, presence, or authority was verified.");
  elements.workspace.focus();
};

const sleep = () => {
  state = freshState();
  render();
  announce("Visit reset. Story state: resting. No browser storage was used.");
  elements.arriveButton.focus();
};

elements.arriveButton.addEventListener("click", arrive);
elements.sleepButton.addEventListener("click", sleep);
elements.sleepBottomButton.addEventListener("click", sleep);

elements.plainButton.addEventListener("click", () => {
  state.plainEquivalent = !state.plainEquivalent;
  render();
  announce(
    state.plainEquivalent
      ? "Plain equivalent on. Optional wardrobe ornament is hidden."
      : "Plain equivalent off. The selected wardrobe presentation is visible.",
  );
});

elements.dailyButton.addEventListener("click", () => {
  state.dailyOpen = true;
  state.afterglowId = null;
  state.afterglowRevealed = false;
  render();
  announce("Manual daily card opened. No task started and no work was marked complete.");
  elements.dailyCard.focus();
});

elements.revealButton.addEventListener("click", () => {
  if (!state.afterglowId) {
    return;
  }
  state.afterglowRevealed = true;
  render();
  announce("One fictional text scene revealed. No consumption or feeling was inferred.");
  elements.afterglowScene.focus();
});

renderCanonicalRoomMap();
render();
