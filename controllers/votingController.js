import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, getDoc, doc,
  addDoc, updateDoc, query, where, serverTimestamp,
} from "firebase/firestore";
import crypto from "crypto";

// ─── Public voting page ───────────────────────────────────────────────────────
export const votingPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, vSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "votes")),
    ]);

    if (!eSnap.exists()) return res.status(404).send("Event not found.");

    const ev          = { id: eSnap.id, ...eSnap.data() };
    const votingOpen  = ev.votingOpen === true;

    // Build vote count map
    const votesByContestant = {};
    vSnap.docs.forEach(d => {
      const v = d.data();
      if (v.contestantId) {
        votesByContestant[v.contestantId] = (votesByContestant[v.contestantId] || 0) + 1;
      }
    });

    const totalVotes = vSnap.docs.length;
    const maxVotes   = Math.max(0, ...Object.values(votesByContestant));

    const contestants = cSnap.docs
      .map(d => {
        const c         = { id: d.id, ...d.data() };
        const voteCount = votesByContestant[c.id] || 0;
        const voteBarPct = maxVotes > 0 ? Math.round((voteCount / maxVotes) * 100) : 0;
        return { ...c, voteCount, voteBarPct };
      })
      .sort((a, b) => Number(a.number) - Number(b.number));

    res.render("voting/index", {
      title:             `Vote — ${ev.name}`,
      event:             ev,
      contestants,
      votesByContestant,
      votingOpen,
      maxVotes,
      totalVotes,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Could not load voting page.");
  }
};

// ─── Submit a vote ────────────────────────────────────────────────────────────
export const submitVote = async (req, res) => {
  const { eventId } = req.params;
  try {
    // (a) Fetch event; check votingOpen
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) return res.redirect(`/events/${eventId}/vote`);

    if (!eSnap.data().votingOpen) {
      req.flash("error_msg", "Voting is currently closed.");
      return res.redirect(`/events/${eventId}/vote`);
    }

    // (b) Fingerprint
    const fingerprint = crypto
      .createHash("sha256")
      .update((req.ip || "") + "|" + (req.headers["user-agent"] || ""))
      .digest("hex");

    // (c) Check for duplicate vote
    const dupQ   = query(
      collection(db, "events", eventId, "votes"),
      where("fingerprint", "==", fingerprint)
    );
    const dupSnap = await getDocs(dupQ);
    if (!dupSnap.empty) {
      req.flash("error_msg", "You have already voted.");
      return res.redirect(`/events/${eventId}/vote`);
    }

    // (d) Sanitize contestantId
    const contestantId = String(req.body.contestantId || "").trim().slice(0, 128);
    if (!contestantId) {
      req.flash("error_msg", "Invalid contestant.");
      return res.redirect(`/events/${eventId}/vote`);
    }

    // (e) Record the vote
    await addDoc(collection(db, "events", eventId, "votes"), {
      contestantId,
      fingerprint,
      votedAt: serverTimestamp(),
      ip:      req.ip || "",
    });

    // (f) Flash success + redirect
    req.flash("success_msg", "Your vote has been cast!");
    res.redirect(`/events/${eventId}/vote`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to submit vote. Please try again.");
    res.redirect(`/events/${eventId}/vote`);
  }
};

// ─── Vote results (redirects to voting page — results shown inline) ───────────
export const voteResults = async (req, res) => {
  const { eventId } = req.params;
  res.redirect(`/events/${eventId}/vote`);
};

// ─── Toggle voting open/closed ─────────────────────────────────────────────────
export const toggleVoting = async (req, res) => {
  const { eventId } = req.params;
  try {
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) return res.redirect("/events");

    const newState = !eSnap.data().votingOpen;
    await updateDoc(doc(db, "events", eventId), { votingOpen: newState });

    req.flash(
      "success_msg",
      newState
        ? "Voting is now OPEN. Share the link with your audience."
        : "Voting is now CLOSED."
    );
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to toggle voting.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Live vote counts (JSON, no auth, no cache) ───────────────────────────────
export const voteCounts = async (req, res) => {
  const { eventId } = req.params;
  try {
    const vSnap = await getDocs(collection(db, "events", eventId, "votes"));
    const votes = {};
    vSnap.docs.forEach(d => {
      const v = d.data();
      if (v.contestantId) {
        votes[v.contestantId] = (votes[v.contestantId] || 0) + 1;
      }
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ votes, total: vSnap.docs.length });
  } catch (err) {
    console.error(err);
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ votes: {}, total: 0 });
  }
};
