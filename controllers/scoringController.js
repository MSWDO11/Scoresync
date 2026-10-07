import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, getDoc, doc,
  setDoc, updateDoc, addDoc, serverTimestamp,
} from "firebase/firestore";
import { sanitizeText } from "../utils/sanitize.js";

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

    const ev = { id: eSnap.id, ...eSnap.data() };

    // Block scoring when event is not ongoing (judges only)
    if (req.session.userRole === 'judge' && ev.status !== 'ongoing') {
      req.flash("error_msg",
        ev.status === 'upcoming'
          ? `"${ev.name}" has not started yet. Scoring opens when the event goes live.`
          : `"${ev.name}" has already ended. Scoring is now closed.`
      );
      return res.redirect("/dashboard");
    }

    // Block if scoring is locked
    if (ev.scoringLocked && req.session.userRole === 'judge') {
      req.flash("error_msg", "Scoring has been locked by the administrator. Please contact the event organizer.");
      return res.redirect("/dashboard");
    }

    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const criteria    = crSnap.docs.map((d, i) => ({
      id: d.id,
      ...d.data(),
      color: CRITERIA_COLORS[i % CRITERIA_COLORS.length],
    }));

    const scoreMap = {};
    sSnap.docs.forEach(d => {
      const s = d.data();
      if (s.judgeId === judgeId) {
        scoreMap[`${s.contestantId}|${s.criteriaId}`] = s.score;
      }
    });

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
      title:       `Score Entry — ${ev.name}`,
      event:       ev,
      contestants: matrix,
      criteria,
      judgeId,
      scoringLocked: ev.scoringLocked || false,
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
    // Block scoring if locked
    const evSnap2 = await getDoc(doc(db, "events", eventId));
    if (evSnap2.exists() && evSnap2.data().scoringLocked) {
      req.flash("error_msg", "Scoring has been locked by the administrator. No more score submissions are allowed.");
      return res.redirect(`/events/${eventId}/scoring`);
    }

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

    // Audit trail log
    await addDoc(collection(db, "events", eventId, "audit_log"), {
      action:    "scores_submitted",
      judgeId,
      judgeName: req.session.userName || "Unknown",
      scoreCount: Object.values(scores || {}).reduce((t, cm) => t + Object.keys(cm).length, 0),
      timestamp: serverTimestamp(),
    });

    req.flash("success_msg", "Scores submitted successfully.");
    res.redirect(`/events/${eventId}/scoring`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to save scores.");
    res.redirect(`/events/${eventId}/scoring`);
  }
};

// ─── Shared tie-breaking helper ───────────────────────────────────────────────
function applyTieBreaking(ranked, criteria) {
  // Sort criteria by weight descending for tiebreaker priority
  const criteriaByWeightDesc = [...criteria].sort((a, b) => Number(b.weight) - Number(a.weight));

  let i = 0;
  while (i < ranked.length) {
    let j = i + 1;
    while (j < ranked.length && parseFloat(ranked[j].finalScore) === parseFloat(ranked[i].finalScore)) j++;
    const group = ranked.slice(i, j);
    if (group.length > 1) {
      group.forEach(c => { c.tieDetected = true; });
      let resolved = false;
      for (const cr of criteriaByWeightDesc) {
        const vals = group.map(c => {
          const bd = c.breakdown ? c.breakdown.find(b => b.name === cr.name) : null;
          return bd ? parseFloat(bd.avg) : 0;
        });
        const maxVal = Math.max(...vals);
        const minVal = Math.min(...vals);
        if (maxVal !== minVal) {
          group.sort((a, b) => {
            const aAvg = parseFloat((a.breakdown ? (a.breakdown.find(bd => bd.name === cr.name) || {}) : {}).avg || 0);
            const bAvg = parseFloat((b.breakdown ? (b.breakdown.find(bd => bd.name === cr.name) || {}) : {}).avg || 0);
            return bAvg - aAvg;
          });
          for (let k = 0; k < group.length; k++) ranked[i + k] = group[k];
          group.forEach(c => { c.tieBroken = true; c.tiebreakCriteria = cr.name; });
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        group.forEach(c => { c.tieBroken = false; });
      }
    } else {
      group[0].tieDetected = false;
      group[0].tieBroken   = false;
    }
    i = j;
  }
}

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

    const ev          = { id: eSnap.id, ...eSnap.data() };
    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const criteria    = crSnap.docs.map((d, i) => ({
      id: d.id,
      ...d.data(),
      color: CRITERIA_COLORS[i % CRITERIA_COLORS.length],
    }));
    const allScores = sSnap.docs.map(d => d.data());

    const judgeMap = {};
    allScores.forEach(s => {
      if (s.judgeId && !judgeMap[s.judgeId]) {
        judgeMap[s.judgeId] = s.judgeName || "Judge";
      }
    });
    const judgeCount = Object.keys(judgeMap).length || 1;

    const ranked = contestants.map(c => {
      let totalWeighted = 0;
      const breakdown = criteria.map((cr, i) => {
        const judgeScores = allScores.filter(
          s => s.contestantId === c.id && s.criteriaId === cr.id
        );
        const avg = judgeScores.length
          ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length
          : 0;
        const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        const barPct   = Math.min((avg / (Number(cr.maxScore) || 100)) * 100, 100).toFixed(1);
        totalWeighted += weighted;
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

    ranked.sort((a, b) => b.finalScore - a.finalScore);

    // Apply tie-breaking before rank assignment
    applyTieBreaking(ranked, criteria);

    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => {
      c.rank       = i + 1;
      c.gapToFirst = (topScore - parseFloat(c.finalScore)).toFixed(2);
    });

    const judgeEntries   = Object.entries(judgeMap);
    const judgeBreakdown = judgeEntries.map(([jId, jName], idx) => {
      const alias = `Judge ${idx + 1}`;
      const scoredContestantIds = new Set(
        allScores.filter(s => s.judgeId === jId).map(s => s.contestantId)
      );
      const scoredCount   = scoredContestantIds.size;
      const completionPct = contestants.length
        ? Math.round((scoredCount / contestants.length) * 100)
        : 0;
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
        judgeName:        jName,
        alias,
        initial:          String(idx + 1),
        scoredCount,
        totalContestants: contestants.length,
        completionPct,
        topScores:        judgeWeighted.slice(0, 3),
      };
    });

    // Build judgeProgressData (same shape as getScoringProgress returns)
    const judgeProgressData = judgeEntries.map(([jId, jName], idx) => {
      const scoredCount = new Set(
        allScores.filter(s => s.judgeId === jId).map(s => s.contestantId)
      ).size;
      const completionPct = contestants.length
        ? Math.round((scoredCount / contestants.length) * 100)
        : 0;
      return {
        judgeId:          jId,
        judgeName:        jName,
        alias:            `Judge ${idx + 1}`,
        scoredCount,
        totalContestants: contestants.length,
        completionPct,
      };
    });

    res.render("scoring/results", {
      title:       `Results — ${ev.name}`,
      event:       ev,
      ranked,
      criteria,
      judgeCount,
      judgeBreakdown,
      judgeProgressData,
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
    req.flash("error_msg", "Could not load results.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Live Display Board (no auth required — public scoreboard) ────────────────
export const displayBoard = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "criteria")),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);
    if (!eSnap.exists()) return res.redirect("/");
    const ev          = { id: eSnap.id, ...eSnap.data() };
    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const criteria    = crSnap.docs.map((d, i) => ({ id: d.id, ...d.data(), color: CRITERIA_COLORS[i % CRITERIA_COLORS.length] }));
    const allScores   = sSnap.docs.map(d => d.data());
    const judgeMap    = {};
    allScores.forEach(s => { if (s.judgeId) judgeMap[s.judgeId] = true; });
    const ranked = contestants.map(c => {
      let total = 0;
      const breakdown = criteria.map((cr, i) => {
        const judgeScores = allScores.filter(s => s.contestantId === c.id && s.criteriaId === cr.id);
        const avg = judgeScores.length ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length : 0;
        total += (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        return { name: cr.name, avg: avg.toFixed(2) };
      });
      return { ...c, breakdown, finalScore: total.toFixed(4), finalScoreDisplay: total.toFixed(2) };
    });
    ranked.sort((a, b) => b.finalScore - a.finalScore);
    // Apply tie-breaking (no breakdown available in displayBoard, ties may remain)
    applyTieBreaking(ranked, criteria);
    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => { c.rank = i + 1; c.gapToFirst = (topScore - parseFloat(c.finalScore)).toFixed(2); });
    res.render("scoring/display", {
      title: `Live — ${ev.name}`,
      event: ev, ranked, criteria,
      judgeCount: Object.keys(judgeMap).length || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Could not load display board.");
  }
};

// ─── Public Results (no login required) ──────────────────────────────────────
export const publicResults = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "criteria")),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);
    if (!eSnap.exists()) return res.status(404).send("Event not found.");
    const ev = { id: eSnap.id, ...eSnap.data() };
    // Only public if completed or organizer made it public
    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const criteria    = crSnap.docs.map((d, i) => ({ id: d.id, ...d.data(), color: CRITERIA_COLORS[i % CRITERIA_COLORS.length] }));
    const allScores   = sSnap.docs.map(d => d.data());
    const judgeMap    = {};
    allScores.forEach(s => { if (s.judgeId && !judgeMap[s.judgeId]) judgeMap[s.judgeId] = s.judgeName || "Judge"; });
    const ranked = contestants.map(c => {
      let totalWeighted = 0;
      const breakdown = criteria.map((cr, i) => {
        const judgeScores = allScores.filter(s => s.contestantId === c.id && s.criteriaId === cr.id);
        const avg = judgeScores.length ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length : 0;
        const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        totalWeighted += weighted;
        return { name: cr.name, weight: cr.weight, avg: avg.toFixed(2), weighted: weighted.toFixed(2), color: CRITERIA_COLORS[i % CRITERIA_COLORS.length] };
      });
      return { ...c, breakdown, finalScore: totalWeighted.toFixed(4), finalScoreDisplay: totalWeighted.toFixed(2) };
    });
    ranked.sort((a, b) => b.finalScore - a.finalScore);
    // Apply tie-breaking before rank assignment
    applyTieBreaking(ranked, criteria);
    ranked.forEach((c, i) => { c.rank = i + 1; });
    res.render("scoring/public", { title: `Results — ${ev.name}`, event: ev, ranked, criteria, judgeCount: Object.keys(judgeMap).length });
  } catch (err) {
    console.error(err);
    res.status(500).send("Could not load results.");
  }
};

// ─── Score Lock / Unlock ──────────────────────────────────────────────────────
export const toggleScoreLock = async (req, res) => {
  const { eventId } = req.params;
  try {
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) return res.redirect("/events");
    const locked = !eSnap.data().scoringLocked;
    await updateDoc(doc(db, "events", eventId), { scoringLocked: locked });
    req.flash("success_msg", locked ? "Scoring locked. Judges can no longer submit scores." : "Scoring unlocked. Judges can now submit scores.");
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to toggle score lock.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── CSV Export of Results ────────────────────────────────────────────────────
export const exportResults = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "criteria")),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    if (!eSnap.exists()) return res.status(404).send("Event not found.");

    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const criteria    = crSnap.docs.map((d, i) => ({
      id: d.id,
      ...d.data(),
      color: CRITERIA_COLORS[i % CRITERIA_COLORS.length],
    }));
    const allScores = sSnap.docs.map(d => d.data());

    const ranked = contestants.map(c => {
      let totalWeighted = 0;
      const breakdown = criteria.map(cr => {
        const judgeScores = allScores.filter(
          s => s.contestantId === c.id && s.criteriaId === cr.id
        );
        const avg = judgeScores.length
          ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length
          : 0;
        const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        totalWeighted += weighted;
        return {
          name:    cr.name,
          avg:     avg.toFixed(2),
          weighted: weighted.toFixed(2),
        };
      });
      return {
        ...c,
        breakdown,
        finalScore:        totalWeighted.toFixed(4),
        finalScoreDisplay: totalWeighted.toFixed(2),
      };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);
    applyTieBreaking(ranked, criteria);
    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => {
      c.rank       = i + 1;
      c.gapToFirst = (topScore - parseFloat(c.finalScore)).toFixed(2);
    });

    // Build CSV
    function q(val) {
      return `"${String(val).replace(/"/g, '""')}"`;
    }
    const headerCols = [
      "Rank", "No.", "Name", "Barangay",
      ...criteria.map(cr => cr.name),
      "Final Score (%)", "Gap to 1st",
    ];
    const headerRow = headerCols.map(q).join(",");
    const dataRows = ranked.map(c => {
      const critCols = c.breakdown.map(bd => q(bd.avg));
      return [
        q(c.rank),
        q(c.number || ""),
        q(sanitizeText(c.name || "")),
        q(sanitizeText(c.barangay || "")),
        ...critCols,
        q(c.finalScoreDisplay),
        q(c.gapToFirst),
      ].join(",");
    });
    const csvContent = [headerRow, ...dataRows].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="results-${eventId}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Could not export results.");
  }
};

// ─── Judge Scoring Progress (JSON endpoint) ───────────────────────────────────
export const getScoringProgress = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    if (!eSnap.exists()) return res.status(404).json({ error: "Event not found." });

    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allScores   = sSnap.docs.map(d => d.data());

    const judgeMap = {};
    allScores.forEach(s => {
      if (s.judgeId && !judgeMap[s.judgeId]) {
        judgeMap[s.judgeId] = s.judgeName || "Judge";
      }
    });

    const progressArray = Object.entries(judgeMap).map(([jId, jName], idx) => {
      const scoredCount = new Set(
        allScores.filter(s => s.judgeId === jId).map(s => s.contestantId)
      ).size;
      const completionPct = contestants.length
        ? Math.round((scoredCount / contestants.length) * 100)
        : 0;
      return {
        judgeId:          jId,
        judgeName:        jName,
        alias:            `Judge ${idx + 1}`,
        scoredCount,
        totalContestants: contestants.length,
        completionPct,
      };
    });

    return res.json(progressArray);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not load scoring progress." });
  }
};
