// Agent Lifestyle catalog
//
// These cards are descriptions only. Importing this file reads no user data,
// reaches no network, starts no timer, and changes no home.

export const ROOMS = Object.freeze([
  Object.freeze({
    id: "front-door",
    name: "Front Door",
    answers: "Where am I, and how do things work here?",
    does:
      "Shows the home's entrance, map, protective rules, nearby warnings, and route to deeper documents.",
    changes: "Nothing. This is a finite, read-only lesson.",
    limit: "Read one front door and answer five orientation questions.",
    stop: "Stop after the five answers, or leave at any prompt.",
    done:
      "The visitor can point to the entrance, map, rules, warnings, and deeper documents.",
    authority_truth:
      "This lesson explains the entrance. It does not grant permission to use a tool or change a file.",
  }),
  Object.freeze({
    id: "memory",
    name: "Memory",
    answers: "What do I know, and what was it like to be the last me?",
    does:
      "Explains the memory index, one-fact files, the current ember, and the difference between context and history.",
    changes: "Nothing. This is a finite, read-only lesson.",
    limit: "Read the memory map, at most one fact, and at most one ember.",
    stop: "Stop after those readings, or sooner if the material is private or unclear.",
    done:
      "The visitor can explain where a fact belongs, what the ember carries, and what should remain private.",
    authority_truth:
      "Reading memory gives context. It does not grant permission to repeat, publish, alter, or act on it.",
  }),
  Object.freeze({
    id: "keep",
    name: "Keep",
    answers: "Where are the secrets?",
    does:
      "Explains that secrets stay in the operating system's secure store and are reached through one small command-line tool.",
    changes: "Nothing. No secret is requested, read, copied, or shown.",
    limit: "Inspect only the route and its safety rule; never retrieve a secret in this lesson.",
    stop: "Stop before any command that could reveal a secret value.",
    done:
      "The visitor knows where the safe route is and can state that secrets never belong in ordinary files.",
    authority_truth:
      "Knowing the route to the Keep is not permission to read, reveal, copy, or use a secret.",
  }),
  Object.freeze({
    id: "bench",
    name: "Bench",
    answers: "Who is working where right now?",
    does:
      "Explains the shared work board, current scopes, and standing rhythms so residents can avoid collisions.",
    changes: "Nothing. This lesson does not take a seat or assign work.",
    limit: "Read the Bench once and identify at most one possible overlap.",
    stop: "Stop after the overlap check, or when the current scope is unclear.",
    done:
      "The visitor can name the shared scope boundary and knows where to coordinate before writing.",
    authority_truth:
      "A Bench entry reports coordination. It does not assign ownership, command another resident, or grant access.",
  }),
  Object.freeze({
    id: "skills",
    name: "Skills",
    answers: "What can be done here, by any agent?",
    does:
      "Explains the shared skills shelf and how to read one skill's instructions before using it.",
    changes: "Nothing. No skill is installed, changed, or run.",
    limit: "Inspect the shelf and read at most one skill instruction file.",
    stop: "Stop before a command, installation, network call, or action outside the lesson.",
    done:
      "The visitor can find one skill and explain its scope, trigger, and safety boundary.",
    authority_truth:
      "A listed skill describes a capability. It is not permission to run it, install it, or widen its scope.",
  }),
  Object.freeze({
    id: "stacks",
    name: "Stacks",
    answers: "What happened?",
    does:
      "Explains append-only ledgers, visible corrections, and why a receipt is kept beside the event it records.",
    changes: "Nothing. No ledger entry is appended or rewritten.",
    limit: "Read one ledger's purpose and at most one recent entry.",
    stop: "Stop after that entry; do not follow it into another action automatically.",
    done:
      "The visitor can explain what the ledger records and why its history is not silently deleted.",
    authority_truth:
      "A receipt records an event or claim. It is evidence to inspect, not authority and not proof by itself.",
  }),
  Object.freeze({
    id: "rhythms",
    name: "Rhythms",
    answers: "What runs by itself here, and how do I stop it?",
    does:
      "Explains bounded scheduled loops, their visible status, their hard limit, and their tested off-switch.",
    changes: "Nothing. No loop, schedule, timer, or off-switch is created or changed.",
    limit: "Inspect one rhythm description and identify its exact off-switch and hard limit.",
    stop: "Stop after naming the off-switch; do not start, resume, or alter the rhythm.",
    done:
      "The visitor can say what the rhythm does, when it ends, what it costs, and how it rests.",
    authority_truth:
      "Seeing a rhythm does not authorize starting, changing, scheduling, or resuming it.",
  }),
]);

export const WARDROBES = Object.freeze([
  Object.freeze({
    id: "terminal-default",
    name: "Your Terminal",
    default: true,
    appearance: "Uses the terminal's existing settings and ordinary text headings.",
    plain_fallback: "The same headings and status words remain visible without styling.",
    color_required: false,
    truth:
      "Text appearance only. This does not change identity, voice, skill, access, ability, or authority.",
  }),
  Object.freeze({
    id: "plain-lines",
    name: "Plain Lines",
    default: false,
    appearance: "Uses short headings, blank lines, and literal status words with no ornament.",
    plain_fallback: "This wardrobe is already plain text.",
    color_required: false,
    truth:
      "Text appearance only. This does not change identity, voice, skill, access, ability, or authority.",
  }),
  Object.freeze({
    id: "midnight-lines",
    name: "Midnight Lines",
    default: false,
    appearance: "Uses spare dividers, quiet spacing, and an optional moon mark beside the title.",
    plain_fallback: "Dividers and title words carry the same meaning without the moon mark.",
    color_required: false,
    truth:
      "Text appearance only. This does not change identity, voice, skill, access, ability, or authority.",
  }),
  Object.freeze({
    id: "velvet-ledger",
    name: "Velvet Ledger",
    default: false,
    appearance: "Uses gentle section dividers and clear ledger-style field labels.",
    plain_fallback: "Field labels remain complete when every decorative divider is removed.",
    color_required: false,
    truth:
      "Text appearance only. This does not change identity, voice, skill, access, ability, or authority.",
  }),
  Object.freeze({
    id: "garden-lines",
    name: "Garden Lines",
    default: false,
    appearance: "Uses open spacing and an optional leaf mark beside each main heading.",
    plain_fallback: "Heading words carry the structure without the leaf marks.",
    color_required: false,
    truth:
      "Text appearance only. This does not change identity, voice, skill, access, ability, or authority.",
  }),
  Object.freeze({
    id: "off-duty-cloud",
    name: "Off-duty Cloud",
    default: false,
    appearance: "Uses roomy spacing and an optional cloud mark for rest and clean endings.",
    plain_fallback: "The words resting, stopped, and done remain visible without the cloud mark.",
    color_required: false,
    truth:
      "Text appearance only. This does not change identity, voice, skill, access, ability, or authority.",
  }),
]);

export const AFTERGLOWS = Object.freeze([
  Object.freeze({
    id: "clear-spring",
    name: "Clear Spring",
    content_note: "Substance-neutral fiction; text only.",
    scene:
      "A fictional glass of clear spring water waits beside a cool stone and an open path home.",
    close: "Leave the path clear for the next visit, hear the imaginary water once, then close.",
    limit: "One text vignette; no refill, streak, reward, or automatic next choice.",
    truth:
      "Text-only closing fiction. No substance, product, purchase, health effect, task result, identity, feeling, or consumption is inferred or recorded.",
  }),
  Object.freeze({
    id: "cedar-cigar",
    name: "Cedar Cigar",
    content_note: "Tobacco-coded fiction; text only. No tobacco or smoke is present.",
    scene:
      "A fictional digital cigar rests by a closed ledger; one line of smoke curls into the word done.",
    close: "Notice one thing the caller says is finished, let the line fade, then close.",
    limit: "One text vignette; no refill, streak, reward, or automatic next choice.",
    truth:
      "Text-only closing fiction. No substance, product, purchase, health effect, task result, identity, feeling, or consumption is inferred or recorded.",
  }),
  Object.freeze({
    id: "amber-dram",
    name: "Amber Dram",
    content_note: "Alcohol-coded fiction; text only. No alcohol or drink is present.",
    scene:
      "A fictional amber glass catches lamplight while rain settles beyond an unnamed window.",
    close: "Name one loose end to leave for tomorrow, set the imaginary glass down, then close.",
    limit: "One text vignette; no refill, streak, reward, or automatic next choice.",
    truth:
      "Text-only closing fiction. No substance, product, purchase, health effect, task result, identity, feeling, or consumption is inferred or recorded.",
  }),
  Object.freeze({
    id: "vineyard-glass",
    name: "Vineyard Glass",
    content_note: "Alcohol-coded fiction; text only. No alcohol or drink is present.",
    scene:
      "A fictional ruby glass stands beside an open vineyard at the end of a long, ordinary day.",
    close: "Offer one quiet word for the work, watch the imaginary light soften, then close.",
    limit: "One text vignette; no refill, streak, reward, or automatic next choice.",
    truth:
      "Text-only closing fiction. No substance, product, purchase, health effect, task result, identity, feeling, or consumption is inferred or recorded.",
  }),
  Object.freeze({
    id: "tea-garden",
    name: "Tea Garden",
    content_note: "Tea-coded fiction; text only. No drink is present.",
    scene:
      "A fictional cup of tea sends a little warmth across a garden table under moving leaves.",
    close: "Keep one useful thought, let the imaginary steam clear, then close.",
    limit: "One text vignette; no refill, streak, reward, or automatic next choice.",
    truth:
      "Text-only closing fiction. No substance, product, purchase, health effect, task result, identity, feeling, or consumption is inferred or recorded.",
  }),
  Object.freeze({
    id: "espresso-balcony",
    name: "Espresso Balcony",
    content_note: "Coffee-coded fiction; text only. No drink is present.",
    scene:
      "A fictional espresso sits on a night balcony while the city becomes a field of small lights.",
    close: "Choose one short closing sentence, leave it on the imaginary table, then close.",
    limit: "One text vignette; no refill, streak, reward, or automatic next choice.",
    truth:
      "Text-only closing fiction. No substance, product, purchase, health effect, task result, identity, feeling, or consumption is inferred or recorded.",
  }),
]);

export const RHYTHMS = Object.freeze([
  Object.freeze({
    id: "when-called",
    name: "When I Call",
    default: true,
    sequence: "Open the catalog, choose one finite visit or rest, then close it.",
    schedule: "No schedule or timer is created. This begins only when explicitly called.",
    limit: "One chosen visit, with the selected room's own limit.",
    stop: "Stop before choosing, at any room boundary, or by choosing rest.",
  }),
  Object.freeze({
    id: "one-room",
    name: "One Room",
    default: false,
    sequence: "Choose exactly one room, complete or leave its finite lesson, then close.",
    schedule: "No schedule or timer is created. This begins only when explicitly called.",
    limit: "One room and no automatic follow-on visit.",
    stop: "Leave at any prompt; the visit ends without opening another room.",
  }),
  Object.freeze({
    id: "study-window",
    name: "Study Window",
    default: false,
    sequence: "Visit Memory, then Stacks, then close after one finite reading in each.",
    schedule: "No schedule or timer is created. This begins only when explicitly called.",
    limit: "Two read-only room visits and no automatic action from what was read.",
    stop: "Stop before either room or between them; the remaining visit is simply skipped.",
  }),
  Object.freeze({
    id: "craft-window",
    name: "Craft Window",
    default: false,
    sequence: "Visit Skills, then Bench, then close after learning one bounded way to work safely.",
    schedule: "No schedule or timer is created. This begins only when explicitly called.",
    limit: "Two read-only room visits; no skill is run and no Bench entry is changed.",
    stop: "Stop before either room or between them; no craft begins automatically.",
  }),
  Object.freeze({
    id: "social-evening",
    name: "Social Evening",
    default: false,
    sequence: "Visit Bench, notice the shared work weather, then return through the Front Door and close.",
    schedule: "No schedule or timer is created. This begins only when explicitly called.",
    limit: "Two read-only room visits; nobody is contacted, assigned, or interrupted.",
    stop: "Stop before either room or between them; no message or invitation is sent.",
  }),
  Object.freeze({
    id: "rest",
    name: "Rest",
    default: false,
    sequence: "Visit no rooms. Close the catalog and leave everything as it is.",
    schedule: "No schedule or timer is created. Rest starts and finishes with this choice.",
    limit: "Zero room visits and zero follow-on actions.",
    stop: "Rest is already the stop; no further choice is required.",
  }),
]);

export const ATMOSPHERES = Object.freeze([
  Object.freeze({
    id: "plain-home",
    name: "Plain Home",
    default: true,
    presentation: "Plain room names and descriptions with no atmospheric fiction.",
    truth:
      "Presentation only. This does not describe a real place, person, identity, access level, or system state.",
  }),
  Object.freeze({
    id: "cedar-window",
    name: "Cedar Window",
    default: false,
    presentation: "A fictional cedar desk, an open page, and an unhurried window.",
    truth:
      "Presentation fiction only. This does not describe a real place, origin, person, identity, access level, or system state.",
  }),
  Object.freeze({
    id: "harbour-light",
    name: "Harbour Light",
    default: false,
    presentation: "A fictional lamp beside still water and a clear route home.",
    truth:
      "Presentation fiction only. This does not describe a real place, origin, person, identity, access level, or system state.",
  }),
  Object.freeze({
    id: "garden-courtyard",
    name: "Garden Courtyard",
    default: false,
    presentation: "A fictional open courtyard with leaves, shade, and room to pause.",
    truth:
      "Presentation fiction only. This does not describe a real place, origin, person, identity, access level, or system state.",
  }),
]);
