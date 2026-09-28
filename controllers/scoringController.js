import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, getDoc, doc,
  setDoc, serverTimestamp,
} from "firebase/firestore";

// ─── Colour palette (matches judge.xian JS array) ────────────────────────────
const CRITERIA_COLORS = [
  "#2563eb","#7c3aed","#059669","#dc2626",
  "#d97706","#0891b2","#be185d","#65a30d",
];

// ─── Judge scoring panel ──────────────────────────────────────────────────────
export const scoringPage = async (req, res) => {
  const { eventId } = req.params;
  const judgeId     = req.session.userId;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "criteria")),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    if (!eSnap.exists()) return res.redirect("/events");

    const event = { id: eSnap.id, ...eSnap.data() };

    // ── Block scoring when event is not ongoing (judges only — admin/organizer can always enter) ──
    if (req.session.userRole === 'judge' && event.status !== 'ongoing') {
      req.flash("error_msg",
        event.status === 'upcoming'
          ? `"${event.name}" has not started yet. Scoring opens when the event goes live.`
          : `"${event.name}" has already ended. Scoring is now closed.`
      );
      return res.redirect("/dashboard");
    }

    const event       = { id: eSnap.id, ...eSnap.data() };
    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const criteria    = crSnap.docs.map((d, i) => ({
      id: d.id,
      ...d.data(),
      color: CRITERIA_COLORS[i % CRITERIA_COLORS.length],
    }));

    // Build score lookup: contestantId|criteriaId -> score
    const scoreMap = {};
    sSnap.docs.forEach(d => {
      const s = d.data();
      if (s.judgeId === judgeId) {
        scoreMap[`${s.contestantId}|${s.criteriaId}`] = s.score;
      }
    });

    // Build scoring matrix
    const matrix = contestants.map(c => ({
      ...c,
      scores: criteria.map(cr => ({
        criteriaId:   cr.id,
        criteriaName: cr.name,
        weight:       cr.weight,
        maxScore:     cr.maxScore,
        color:        cr.color,
        value:        scoreMap[`${c.id}|${cr.id}`] ?? "",
      })),
    }));

    res.render("scoring/judge", {
      title:       `Score Entry — ${event.name}`,
      event,
      contestants: matrix,
      criteria,
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isJudge:     req.session.userRole === "judge",
      isEncoder:   req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load scoring page.");
    res.redirect("/events");
  }
};

// ─── Submit scores ────────────────────────────────────────────────────────────
export const submitScores = async (req, res) => {
  const { eventId } = req.params;
  const judgeId     = req.session.userId;
  const { scores }  = req.body;

  // Block submit if event is not ongoing (judges only)
  try {
    if (req.session.userRole === 'judge') {
      const eSnap = await getDoc(doc(db, "events", eventId));
      if (eSnap.exists() && eSnap.data().status !== 'ongoing') {
        req.flash("error_msg", "Scoring is only allowed while the event is ongoing.");
        return res.redirect("/dashboard");
      }
    }
  } catch (_) {}

  try {
    const writes = [];
    for (const [contestantId, criteriaMap] of Object.entries(scores || {})) {
      for (const [criteriaId, rawScore] of Object.entries(criteriaMap || {})) {
        const score = parseFloat(rawScore);
        if (isNaN(score)) continue;
        const docId = `${judgeId}_${contestantId}_${criteriaId}`;
        writes.push(
          setDoc(doc(db, "events", eventId, "scores", docId), {
            judgeId,
            judgeName:   req.session.userName || "Unknown",
            contestantId,
            criteriaId,
            score,
            submittedAt: serverTimestamp(),
          })
        );
      }
    }
    await Promise.all(writes);
    req.flash("success_msg", "Scores submitted successfully.");
    res.redirect(`/events/${eventId}/scoring`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to save scores.");
    res.redirect(`/events/${eventId}/scoring`);
  }
};

// ─── Results / Leaderboard ────────────────────────────────────────────────────
export const resultsPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "criteria")),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    if (!eSnap.exists()) return res.redirect("/events");

    const event       = { id: eSnap.id, ...eSnap.data() };
    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const criteria    = crSnap.docs.map((d, i) => ({
      id: d.id,
      ...d.data(),
      color: CRITERIA_COLORS[i % CRITERIA_COLORS.length],
    }));
    const allScores   = sSnap.docs.map(d => d.data());

    // ── Unique judges ──
    const judgeMap = {};  // judgeId -> judgeName
    allScores.forEach(s => {
      if (s.judgeId && !judgeMap[s.judgeId]) {
        judgeMap[s.judgeId] = s.judgeName || "Judge";
      }
    });
    const judgeCount = Object.keys(judgeMap).length || 1;

    // ── Ranked contestants ──
    const ranked = contestants.map(c => {
      let totalWeighted = 0;

      const breakdown = criteria.map((cr, i) => {
        const judgeScores = allScores.filter(
          s => s.contestantId === c.id && s.criteriaId === cr.id
        );
        const avg = judgeScores.length
          ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length
          : 0;
        const weighted    = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        const barPct      = Math.min((avg / (Number(cr.maxScore) || 100)) * 100, 100).toFixed(1);
        totalWeighted    += weighted;
        return {
          name:     cr.name,
          weight:   cr.weight,
          color:    CRITERIA_COLORS[i % CRITERIA_COLORS.length],
          avg:      avg.toFixed(2),
          weighted: weighted.toFixed(2),
          barPct,
        };
      });

      return {
        ...c,
        breakdown,
        finalScore:        totalWeighted.toFixed(4),
        finalScoreDisplay: totalWeighted.toFixed(2),
      };
    });

    // Sort descending, assign rank + gap-to-first
    ranked.sort((a, b) => b.finalScore - a.finalScore);
    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => {
      c.rank        = i + 1;
      c.gapToFirst  = (topScore - parseFloat(c.finalScore)).toFixed(2);
    });

    // ── Per-judge breakdown ──
    // ── Per-judge breakdown ──
    const judgeEntries = Object.entries(judgeMap);
    const judgeBreakdown = judgeEntries.map(([jId, jName], idx) => {
      const alias = `Judge ${idx + 1}`;
      // Contestants this judge has scored (at least one criteria)
      const scoredContestantIds = new Set(
        allScores.filter(s => s.judgeId === jId).map(s => s.contestantId)
      );
      const scoredCount   = scoredContestantIds.size;
      const completionPct = contestants.length
        ? Math.round((scoredCount / contestants.length) * 100)
        : 0;

      // Top 3 contestants by this judge's weighted score
      const judgeWeighted = contestants.map(c => {
        let w = 0;
        criteria.forEach(cr => {
          const s = allScores.find(s => s.judgeId === jId && s.contestantId === c.id && s.criteriaId === cr.id);
          if (s) w += (s.score / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        });
        return { contestantName: c.name, score: w.toFixed(2) };
      });
      judgeWeighted.sort((a, b) => b.score - a.score);

      return {
        judgeId:          jId,
        judgeName:        jName,         // real name — only shown to admin
        alias,                           // anonymous alias — shown to everyone else
        initial:          String(idx + 1), // "1", "2", "3" — anonymous
        scoredCount,
        totalContestants: contestants.length,
        completionPct,
        topScores:        judgeWeighted.slice(0, 3),
      };
    });

    res.render("scoring/results", {
      title:          `Results — ${event.name}`,
      event,
      ranked,
      criteria,
      judgeCount,
      judgeBreakdown,
      userName:       req.session.userName,
      userRole:       req.session.userRole,
      userInitial:    (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:        req.session.userRole === "admin",
      isJudge:        req.session.userRole === "judge",
      isEncoder:      req.session.userRole === "encoder",
      isOrganizer:    req.session.userRole === "organizer",
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load results.");
    res.redirect(`/events/${eventId}`);
  }
};
