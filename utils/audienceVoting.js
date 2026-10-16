import { createHash } from "crypto";

const voteAttemptWindows = new Map();
const VOTE_ATTEMPT_LIMIT = 10;
const VOTE_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
let attemptsSinceCleanup = 0;

export function createVoteFingerprint(ip, userAgent = "") {
  if (typeof ip !== "string" || !ip.trim()) {
    throw new TypeError("A client IP address is required for vote fingerprinting.");
  }

  return createHash("sha256")
    .update(`${ip.trim()}|${String(userAgent).slice(0, 512)}`)
    .digest("hex");
}

export function createVoteDocumentId(eventId, fingerprint) {
  return createHash("sha256")
    .update(`${eventId}|${fingerprint}`)
    .digest("hex");
}

export function isValidContestantId(contestantId) {
  return typeof contestantId === "string" &&
    contestantId.length > 0 &&
    contestantId.length <= 128 &&
    !/[\/\u0000-\u001f\u007f]/.test(contestantId);
}

export function consumeVoteAttempt(eventId, fingerprint, now = Date.now()) {
  const key = `${eventId}|${fingerprint}`;
  const current = voteAttemptWindows.get(key);
  const window = current && now - current.startedAt < VOTE_ATTEMPT_WINDOW_MS
    ? current
    : { startedAt: now, count: 0 };

  if (window.count >= VOTE_ATTEMPT_LIMIT) return false;
  window.count += 1;
  voteAttemptWindows.set(key, window);

  attemptsSinceCleanup += 1;
  if (attemptsSinceCleanup >= 256) {
    for (const [attemptKey, attempt] of voteAttemptWindows) {
      if (now - attempt.startedAt >= VOTE_ATTEMPT_WINDOW_MS) {
        voteAttemptWindows.delete(attemptKey);
      }
    }
    attemptsSinceCleanup = 0;
  }

  return true;
}

export function countVotesByContestant(votes, contestantIds) {
  const allowedIds = contestantIds ? new Set(contestantIds) : null;
  const counts = {};

  votes.forEach(({ contestantId }) => {
    if (!contestantId || (allowedIds && !allowedIds.has(contestantId))) return;
    counts[contestantId] = (counts[contestantId] || 0) + 1;
  });

  return counts;
}

export function buildAudienceRanking(contestants, votesByContestant) {
  const maxVotes = Math.max(
    0,
    ...Object.values(votesByContestant).map(Number),
  );
  const ranked = contestants
    .map(contestant => {
      const audienceVoteCount = Number(votesByContestant[contestant.id] || 0);
      return {
        ...contestant,
        audienceVoteCount,
        audienceVotePct: maxVotes > 0
          ? Math.round((audienceVoteCount / maxVotes) * 100)
          : 0,
      };
    })
    .sort((a, b) =>
      b.audienceVoteCount - a.audienceVoteCount ||
      (Number(a.number) || 0) - (Number(b.number) || 0)
    );

  let previousCount;
  let rank = 0;
  ranked.forEach((contestant, index) => {
    if (contestant.audienceVoteCount !== previousCount) {
      rank = index + 1;
      previousCount = contestant.audienceVoteCount;
    }
    contestant.audienceRank = rank;
  });

  return ranked;
}
