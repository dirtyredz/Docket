// Outcome items (owner ruling 2026-11-22, "outcome work closes on the installed result"). The 12
// frontmatter keys are fixed, so the markers live in the facts body as `Key: value` lines:
//   Outcome: yes                         marks an outcome item
//   Installed-measurement: <evidence>    the measurement on the installed result (required to close)
//   Safety-switch-off: dk-xxxxxxxx       the follow-up item that turns the switch back on
//   Owner: <name>                        the owner of a follow-up item
// planSet calls `assertCloseable` on a move to `done`; items without these markers are unaffected.
import { CODES, docketError } from "../../errors.mjs";
import { ID_RE } from "../../format/schema.mjs";
import { contentView, parseContent } from "../../format/content.mjs";

const OUTCOME_RE = /^Outcome:[ \t]*yes[ \t]*$/im;
const MEASUREMENT_RE = /^Installed-measurement:[ \t]*(.*)$/im;
const SWITCH_RE = /^Safety-switch-off:[ \t]*(\S*)[ \t]*$/gim;
const OWNER_RE = /^Owner:[ \t]*(\S.*)$/im;

/** The facts body with fenced code blocks removed, so an example in a fence never acts as a marker. */
function markerText(rec) {
  const content = rec.content ?? parseContent(rec.rest);
  const out = [];
  let fence = null;
  for (const line of contentView(rec.rest, content).body.split("\n")) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m && !fence) fence = m[1][0];
    else if (m && m[1][0] === fence) fence = null;
    else if (!fence) out.push(line);
  }
  return out.join("\n");
}

const refuse = (id, message) =>
  docketError(CODES.INVALID, `${id} cannot be completed: ${message}`, { id });

/** Throw DOCKET_INVALID unless `rec` (moving to done) meets the outcome and switch-off rules. */
export function assertCloseable(rec, byId) {
  const text = markerText(rec);
  const id = rec.id;
  if (OUTCOME_RE.test(text)) {
    const evidence = MEASUREMENT_RE.exec(text)?.[1].trim();
    if (!evidence) {
      throw refuse(
        id,
        "it is an outcome item (`Outcome: yes`) with no `Installed-measurement:` line; record the " +
          "measurement taken on the installed result against the target, then complete it",
      );
    }
  }
  for (const [, ref] of text.matchAll(SWITCH_RE)) {
    if (!ID_RE.test(ref)) {
      throw refuse(id, `\`Safety-switch-off:\` must name a follow-up item id, got "${ref}"`);
    }
    const follow = byId.get(ref);
    if (!follow?.fields) throw refuse(id, `safety switch-off follow-up ${ref} does not exist`);
    if (!OWNER_RE.test(markerText(follow))) {
      throw refuse(id, `safety switch-off follow-up ${ref} has no \`Owner:\` line in its body`);
    }
    if (follow.fields.status !== "done") {
      throw refuse(
        id,
        `safety switch-off follow-up ${ref} is ${follow.fields.status}; the switch must be turned ` +
          "back on (follow-up done) before this item can be completed",
      );
    }
  }
}
