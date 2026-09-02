import assert from "node:assert/strict";
import test from "node:test";
import {
  crossingQuarantineShelf,
  idsForShelfAction,
} from "../src/shelf-actions.js";

const live = { id: "live", quarantined: false };
const held = { id: "held", quarantined: true };

test("quarantine only acts on live cards", () => {
  assert.deepEqual(
    idsForShelfAction(["live", "held", "gone"], [live, held], "quarantine"),
    ["live"],
  );
});

test("restore only acts on quarantined cards", () => {
  assert.deepEqual(
    idsForShelfAction(["live", "held"], [live, held], "restore"),
    ["held"],
  );
});

test("delete acts on either shelf", () => {
  assert.deepEqual(
    idsForShelfAction(["live", "held", "gone"], [live, held], "delete"),
    ["live", "held"],
  );
});

test("crossing the quarantine shelf clears marks; live drawers do not", () => {
  assert.equal(crossingQuarantineShelf("all", "quarantine"), true);
  assert.equal(crossingQuarantineShelf("quarantine", "claude"), true);
  assert.equal(crossingQuarantineShelf("all", "claude"), false);
  assert.equal(crossingQuarantineShelf("quarantine", "quarantine"), false);
});
