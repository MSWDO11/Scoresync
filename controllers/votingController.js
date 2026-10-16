import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, getDoc, doc, runTransaction, serverTimestamp,
} from "firebase/firestore";
import {
  consumeVoteAttempt, countVotesByContestant, createVoteDocumentId,
  createVoteFingerprint, isValidContestantId,
} from "../utils/audienceVoting.js";

class VotingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function flashAndRedirect(req, res, eventId, message, type = "error_msg") {
  req.flash(type, message);
  return res.redirect(`/events/${eventId}/vote`);
}

export const votingPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const eventRef = doc(db, "events", eventId);
    const eventSnap = await getDoc(eventRef);
    if (!eventSnap.exists()) return res.status(404).send("Event not found.");

    const contestantSnap = await getDocs(
      collection(db, "events", eventId, "contestants")
    );
    const event = { id: eventSnap.id, ...eventSnap.data() };
    let votingOpen = event.votingOpen === true;
    const contestants = contestantSnap.docs
      .map(snapshot => ({ id: snapshot.id, ...snapshot.data() }))
      .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));

    let votesByContestant = {};
    if (!votingOpen) {
      const voteSnap = await getDocs(
        collection(db, "events", eventId, "votes")
      );
      votesByContestant = countVotesByContestant(
        voteSnap.docs.map(snapshot => snapshot.data()),
        contestants.map(contestant => contestant.id)
      );
      const latestEventSnap = await getDoc(eventRef);
      if (!latestEventSnap.exists()) {
        return res.status(404).send("Event not found.");
      }
      votingOpen = latestEventSnap.data().votingOpen === true;
      if (votingOpen) votesByContestant = {};
    }
    event.votingOpen = votingOpen;

    const maxVotes = Math.max(0, ...Object.values(votesByContestant));
    const totalVotes = Object.values(votesByContestant)
      .reduce((total, count) => total + count, 0);
    const votingContestants = contestants.map(contestant => {
      const voteCount = votesByContestant[contestant.id] || 0;
      return {
        ...contestant,
        voteCount,
        voteBarPct: maxVotes > 0 ? Math.round((voteCount / maxVotes) * 100) : 0,
      };
    });

    res.setHeader("Cache-Control", "no-store");
    res.render("voting/index", {
      title: `Vote — ${event.name}`,
      event,
      contestants: votingContestants,
      votingOpen,
      maxVotes,
      totalVotes,
      audienceResultsAvailable: !votingOpen,
    });
  } catch (err) {
    console.error("Could not load voting page:", err.message);
    res.status(500).send("Could not load voting page.");
  }
};

export const submitVote = async (req, res) => {
  const { eventId } = req.params;
  let fingerprint;
  try {
    fingerprint = createVoteFingerprint(
      req.ip,
      req.get("user-agent") || ""
    );
  } catch (err) {
    console.error("Could not identify vote request:", err.message);
    return res.status(503).send("Voting is temporarily unavailable.");
  }

  if (!consumeVoteAttempt(eventId, fingerprint)) {
    return res.status(429).send("Too many voting attempts. Please wait before trying again.");
  }

  const contestantId = typeof req.body?.contestantId === "string"
    ? req.body.contestantId.trim()
    : "";
  if (!isValidContestantId(contestantId)) {
    return flashAndRedirect(req, res, eventId, "Invalid contestant.");
  }

  const eventRef = doc(db, "events", eventId);
  const contestantRef = doc(db, "events", eventId, "contestants", contestantId);
  const voteRef = doc(
    db,
    "events",
    eventId,
    "votes",
    createVoteDocumentId(eventId, fingerprint)
  );

  try {
    await runTransaction(db, async transaction => {
      const [eventSnap, contestantSnap, voteSnap] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(contestantRef),
        transaction.get(voteRef),
      ]);

      if (!eventSnap.exists()) {
        throw new VotingError("event-not-found", "Event not found.");
      }
      if (eventSnap.data().votingOpen !== true) {
        throw new VotingError("voting-closed", "Voting is currently closed.");
      }
      if (!contestantSnap.exists()) {
        throw new VotingError("invalid-contestant", "Invalid contestant.");
      }
      if (voteSnap.exists()) {
        throw new VotingError("duplicate-vote", "You have already voted.");
      }

      transaction.set(voteRef, {
        contestantId,
        fingerprint,
        votedAt: serverTimestamp(),
      });
    });

    return flashAndRedirect(
      req,
      res,
      eventId,
      "Your vote has been cast!",
      "success_msg"
    );
  } catch (err) {
    if (err instanceof VotingError) {
      if (err.code === "event-not-found") {
        return res.status(404).send("Event not found.");
      }
      return flashAndRedirect(req, res, eventId, err.message);
    }

    console.error("Failed to submit vote:", err.message);
    return res.status(500).send("Failed to submit vote. Please try again.");
  }
};

export const voteResults = async (req, res) => {
  res.redirect(`/events/${req.params.eventId}/vote`);
};

export const toggleVoting = async (req, res) => {
  const { eventId } = req.params;
  const userId = req.session?.userId;
  const isAdmin = req.session?.userRole === "admin";
  const eventRef = doc(db, "events", eventId);

  try {
    const newState = await runTransaction(db, async transaction => {
      const eventSnap = await transaction.get(eventRef);
      if (!eventSnap.exists()) {
        throw new VotingError("event-not-found", "Event not found.");
      }

      const event = eventSnap.data();
      if (!isAdmin && event.createdBy !== userId) {
        throw new VotingError("forbidden", "You cannot manage voting for this event.");
      }

      const nextState = event.votingOpen !== true;
      transaction.update(eventRef, { votingOpen: nextState });
      return nextState;
    });

    req.flash(
      "success_msg",
      newState
        ? "Voting is now OPEN. Share the link with your audience."
        : "Voting is now CLOSED."
    );
    return res.redirect(`/events/${eventId}`);
  } catch (err) {
    if (err instanceof VotingError) {
      if (err.code === "event-not-found") return res.status(404).send(err.message);
      return res.status(403).send(err.message);
    }

    console.error("Failed to toggle voting:", err.message);
    req.flash("error_msg", "Failed to toggle voting.");
    return res.redirect(`/events/${eventId}`);
  }
};

export const voteCounts = async (req, res) => {
  const { eventId } = req.params;
  res.setHeader("Cache-Control", "no-store");

  try {
    const eventSnap = await getDoc(doc(db, "events", eventId));
    if (!eventSnap.exists()) {
      return res.status(404).json({ error: "Event not found." });
    }
    if (eventSnap.data().votingOpen === true) {
      return res.json({ resultsAvailable: false });
    }

    const [contestantSnap, voteSnap] = await Promise.all([
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "votes")),
    ]);
    const contestants = contestantSnap.docs.map(snapshot => ({
      id: snapshot.id,
      ...snapshot.data(),
    }));
    const votes = countVotesByContestant(
      voteSnap.docs.map(snapshot => snapshot.data()),
      contestants.map(contestant => contestant.id)
    );
    const latestEventSnap = await getDoc(doc(db, "events", eventId));
    if (!latestEventSnap.exists()) {
      return res.status(404).json({ error: "Event not found." });
    }
    if (latestEventSnap.data().votingOpen === true) {
      return res.json({ resultsAvailable: false });
    }
    contestants.forEach(contestant => {
      if (!votes[contestant.id]) votes[contestant.id] = 0;
    });

    return res.json({
      resultsAvailable: true,
      votes,
      total: Object.values(votes).reduce((sum, count) => sum + count, 0),
    });
  } catch (err) {
    console.error("Could not load vote results:", err.message);
    return res.status(500).json({ error: "Could not load vote results." });
  }
};
