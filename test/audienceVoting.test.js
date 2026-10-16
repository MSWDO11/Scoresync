import assert from "node:assert/strict";
import cookieSession from "cookie-session";
import express from "express";
import test from "node:test";
import {
  buildAudienceRanking, consumeVoteAttempt, countVotesByContestant,
  createVoteDocumentId, createVoteFingerprint, isValidContestantId,
} from "../utils/audienceVoting.js";
import { csrfMiddleware, csrfProtect } from "../middleware/csrf.js";

test("vote fingerprints and document IDs are deterministic and do not expose IP text", () => {
  const fingerprint = createVoteFingerprint("192.0.2.8", "test-agent");

  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(createVoteFingerprint("192.0.2.8", "test-agent"), fingerprint);
  assert.notEqual(createVoteFingerprint("192.0.2.8", "other-agent"), fingerprint);
  assert.match(createVoteDocumentId("event-1", fingerprint), /^[a-f0-9]{64}$/);
  assert.notEqual(
    createVoteDocumentId("event-1", fingerprint),
    createVoteDocumentId("event-2", fingerprint)
  );
  assert.throws(() => createVoteFingerprint("", "test-agent"), TypeError);
});

test("contestant IDs reject invalid path segments and oversized values", () => {
  assert.equal(isValidContestantId("contestant-1"), true);
  assert.equal(isValidContestantId(""), false);
  assert.equal(isValidContestantId("bad/id"), false);
  assert.equal(isValidContestantId("x".repeat(129)), false);
});

test("vote attempts are burst-limited per event and fingerprint", () => {
  const eventId = `rate-test-${Date.now()}`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(consumeVoteAttempt(eventId, "fingerprint", 1_000), true);
  }
  assert.equal(consumeVoteAttempt(eventId, "fingerprint", 1_000), false);
  assert.equal(consumeVoteAttempt(eventId, "fingerprint", 601_001), true);
});

test("vote counts ignore deleted contestants and audience ranks are independent", () => {
  const votes = [
    { contestantId: "a" },
    { contestantId: "a" },
    { contestantId: "b" },
    { contestantId: "deleted" },
  ];
  const counts = countVotesByContestant(votes, ["a", "b", "c"]);

  assert.deepEqual(counts, { a: 2, b: 1 });
  assert.deepEqual(
    buildAudienceRanking([
      { id: "a", number: "2", judgeRank: 1 },
      { id: "b", number: "1", judgeRank: 3 },
      { id: "c", number: "3", judgeRank: 2 },
    ], counts).map(contestant => ({
      id: contestant.id,
      rank: contestant.audienceRank,
      count: contestant.audienceVoteCount,
      pct: contestant.audienceVotePct,
    })),
    [
      { id: "a", rank: 1, count: 2, pct: 100 },
      { id: "b", rank: 2, count: 1, pct: 50 },
      { id: "c", rank: 3, count: 0, pct: 0 },
    ]
  );
});

test("equal audience vote totals share competition rank and empty results have zero bars", () => {
  const ranked = buildAudienceRanking([
    { id: "a", number: 1 },
    { id: "b", number: 2 },
    { id: "c", number: 3 },
  ], { a: 4, b: 4 });

  assert.deepEqual(
    ranked.map(contestant => [contestant.id, contestant.audienceRank, contestant.audienceVotePct]),
    [["a", 1, 100], ["b", 1, 100], ["c", 3, 0]]
  );
  assert.ok(
    buildAudienceRanking([{ id: "x", number: 1 }], {})[0].audienceVotePct === 0
  );
});

test("CSRF tokens are session-scoped and voting POSTs reject missing tokens", () => {
  const req = { session: {} };
  const res = { locals: {} };
  csrfMiddleware(req, res, () => {});

  assert.match(res.locals.csrfToken, /^[a-f0-9]{64}$/);
  assert.equal(req.session.csrfToken, res.locals.csrfToken);

  let statusCode;
  let nextCalled = false;
  const protectRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    send() {},
  };
  csrfProtect({
    method: "POST",
    path: "/events/event-1/vote",
    session: req.session,
    body: {},
    get() { return undefined; },
  }, protectRes, () => { nextCalled = true; });
  assert.equal(statusCode, 403);
  assert.equal(nextCalled, false);
});

test("CSRF protection accepts a valid token and does not affect other legacy POST routes", () => {
  const token = "a".repeat(64);
  let called = 0;
  const res = { status() { return this; }, send() {} };

  csrfProtect({
    method: "POST",
    path: "/events/event-1/vote/toggle",
    session: { csrfToken: token },
    body: { _csrf: token },
    get() { return undefined; },
  }, res, () => { called += 1; });

  csrfProtect({
    method: "POST",
    path: "/events/event-1/status",
    session: {},
    body: {},
    get() { return undefined; },
  }, res, () => { called += 1; });

  assert.equal(called, 2);
});

test("CSRF token survives a cookie-session round trip", async t => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieSession({
    name: "csrf_test",
    keys: ["test-secret"],
    sameSite: "lax",
  }));
  app.use(csrfMiddleware);
  app.get("/", (req, res) => {
    res.send(`<input name="_csrf" value="${res.locals.csrfToken}">`);
  });
  app.post("/events/event-1/vote", csrfProtect, (req, res) => {
    res.send("accepted");
  });

  const server = app.listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(baseUrl);
  const cookie = page.headers.get("set-cookie")
    .split(",")
    .map(part => part.split(";")[0])
    .join("; ");
  const html = await page.text();
  const token = html.match(/value="([a-f0-9]{64})"/)[1];

  const accepted = await fetch(`${baseUrl}/events/event-1/vote`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: token }),
  });
  const rejected = await fetch(`${baseUrl}/events/event-1/vote`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: "",
  });

  assert.equal(accepted.status, 200);
  assert.equal(rejected.status, 403);
});
