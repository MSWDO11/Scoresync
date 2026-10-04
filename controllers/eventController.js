import { db } from "../models/firebaseConfig.js";
import { getFinanceSummary } from "./financeController.js";
import {
  collection, addDoc, getDocs, getDoc, doc,
  updateDoc, deleteDoc, query, orderBy, serverTimestamp,
} from "firebase/firestore";
import { applyAutoStatus } from "../utils/autoStatus.js";

const EVENTS = "events";
const PAYMENT_TYPES = ['cultural','choral','dance','culinary','booth','sports','academic','other'];
const PRIZE_TYPES   = ['pageant','talent','choral','dance','culinary','academic'];

// ─── List all events ──────────────────────────────────────────────────────────
export const listEvents = async (req, res) => {
  try {
    const q    = query(collection(db, EVENTS), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    await Promise.all(
      events
        .filter(e => e.date && e.status !== 'cancelled')
        .map(e => applyAutoStatus(e.id, e))
    );

    res.render("events/index", {
      title:       "Events",
      events,
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
    req.flash("error_msg", "Could not load events.");
    res.redirect("/dashboard");
  }
};

// ─── Create event form ────────────────────────────────────────────────────────
export const createEventPage = (req, res) => {
  res.render("events/create", {
    title:       "Create Event",
    userName:    req.session.userName,
    userRole:    req.session.userRole,
    userInitial: (req.session.userName || "U")[0].toUpperCase(),
    isAdmin:     req.session.userRole === "admin",
    isOrganizer: req.session.userRole === "organizer",
  });
};

// ─── Store new event ──────────────────────────────────────────────────────────
export const storeEvent = async (req, res) => {
  const {
    name, description, date, time, endTime, venue, type, status,
    organizer, maxContestants, prizes, rules, theme, notes,
    paymentMethod, paymentAccountName, paymentAccountNumber, paymentQR,
    otherType,
  } = req.body;
  try {
    const evRef = await addDoc(collection(db, EVENTS), {
      name:                 name || "",
      description:          description || "",
      date:                 date || "",
      time:                 time || "",
      endTime:              endTime || "",
      venue:                venue || "",
      type:                 type || "pageant",
      otherType:            otherType || "",
      status:               status || "upcoming",
      organizer:            organizer || "",
      maxContestants:       maxContestants || "",
      prizes:               prizes || "",
      rules:                rules || "",
      theme:                theme || "blue",
      notes:                notes || "",
      paymentMethod:        paymentMethod        || "",
      paymentAccountName:   paymentAccountName   || "",
      paymentAccountNumber: paymentAccountNumber || "",
      paymentQR:            paymentQR            || "",
      createdBy:            req.session.userId,
      createdAt:            serverTimestamp(),
    });

    // ── Save inline criteria submitted from create form ──────────────────────
    const criteriaNames   = [].concat(req.body['criteria[name]']   || []);
    const criteriaWeights = [].concat(req.body['criteria[weight]'] || []);
    const criteriaMaxes   = [].concat(req.body['criteria[max]']    || []);
    const criteriaDescs   = [].concat(req.body['criteria[desc]']   || []);
    if (criteriaNames.length > 0) {
      const saves = criteriaNames
        .map((n, i) => ({
          name:        n.trim(),
          description: (criteriaDescs[i] || "").trim(),
          weight:      Number(criteriaWeights[i]) || 0,
          maxScore:    Number(criteriaMaxes[i])   || 100,
        }))
        .filter(c => c.name && c.weight > 0);
      await Promise.all(
        saves.map(c => addDoc(collection(db, EVENTS, evRef.id, "criteria"), {
          ...c, createdAt: serverTimestamp(),
        }))
      );
    }

    req.flash("success_msg", `Event "${name}" created successfully.`);
    res.redirect(`/events/${evRef.id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to create event. " + err.message);
    res.redirect("/events/create");
  }
};

// ─── Event detail ─────────────────────────────────────────────────────────────
export const showEvent = async (req, res) => {
  try {
    const snap = await getDoc(doc(db, EVENTS, req.params.id));
    if (!snap.exists()) {
      req.flash("error_msg", "Event not found.");
      return res.redirect("/events");
    }
    const ev = { id: snap.id, ...snap.data() };

    ev.isPaymentType   = PAYMENT_TYPES.includes(ev.type);
    ev.isPrizeType     = PRIZE_TYPES.includes(ev.type);
    ev.canManageFinance = ['admin','organizer'].includes(req.session.userRole);

    await applyAutoStatus(req.params.id, ev);

    const [cSnap, crSnap, finance, usersSnap] = await Promise.all([
      getDocs(collection(db, EVENTS, req.params.id, "contestants")),
      getDocs(collection(db, EVENTS, req.params.id, "criteria")),
      getFinanceSummary(req.params.id),
      getDocs(collection(db, "users")),
    ]);
    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const criteria    = crSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // All judges in the system
    const allJudges = usersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.role === 'judge' && u.status !== 'pending');

    // Assigned judges with names
    const assignedJudgeIds = ev.assignedJudges || [];
    const assignedJudges = allJudges.filter(j => assignedJudgeIds.includes(j.id));
    // Unassigned judges (available to assign)
    const availableJudges = allJudges.filter(j => !assignedJudgeIds.includes(j.id));

    res.render("events/show", {
      title:       ev.name,
      event:       ev,
      contestants,
      criteria,
      finance,
      allJudges,
      assignedJudges,
      availableJudges,
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isJudge:     req.session.userRole === "judge",
      isEncoder:   req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      canManageFinance: ['admin','organizer'].includes(req.session.userRole),
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load event.");
    res.redirect("/events");
  }
};

// ─── Edit event form ──────────────────────────────────────────────────────────
export const editEventPage = async (req, res) => {
  try {
    const snap = await getDoc(doc(db, EVENTS, req.params.id));
    if (!snap.exists()) return res.redirect("/events");
    const ev = { id: snap.id, ...snap.data() };
    res.render("events/edit", {
      title:         `Edit — ${ev.name}`,
      event:         ev,
      userName:      req.session.userName,
      userRole:      req.session.userRole,
      userInitial:   (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:       req.session.userRole === "admin",
      isOrganizer:   req.session.userRole === "organizer",
      isPaymentType: PAYMENT_TYPES.includes(ev.type),
      isPrizeType:   PRIZE_TYPES.includes(ev.type),
    });
  } catch (err) {
    req.flash("error_msg", "Could not load event.");
    res.redirect("/events");
  }
};

// ─── Update event ─────────────────────────────────────────────────────────────
export const updateEvent = async (req, res) => {
  const {
    name, description, date, time, endTime, venue, type, status,
    organizer, maxContestants, prizes, rules, theme, notes,
    paymentMethod, paymentAccountName, paymentAccountNumber, paymentQR,
    otherType,
  } = req.body;
  try {
    await updateDoc(doc(db, EVENTS, req.params.id), {
      name, description, date, time, venue, type, status,
      endTime:              endTime              || "",
      otherType:            otherType            || "",
      organizer:            organizer            || "",
      maxContestants:       maxContestants       || "",
      prizes:               prizes               || "",
      rules:                rules                || "",
      theme:                theme                || "blue",
      notes:                notes                || "",
      paymentMethod:        paymentMethod        || "",
      paymentAccountName:   paymentAccountName   || "",
      paymentAccountNumber: paymentAccountNumber || "",
      paymentQR:            paymentQR            || "",
    });
    req.flash("success_msg", `Event "${name}" updated successfully.`);
    res.redirect(`/events/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to update event.");
    res.redirect(`/events/${req.params.id}/edit`);
  }
};

// ─── Delete event ─────────────────────────────────────────────────────────────
export const deleteEvent = async (req, res) => {
  try {
    await deleteDoc(doc(db, EVENTS, req.params.id));
    req.flash("success_msg", "Event deleted.");
    res.redirect("/events");
  } catch (err) {
    req.flash("error_msg", "Failed to delete event.");
    res.redirect("/events");
  }
};

// ─── Update event status ──────────────────────────────────────────────────────
export const updateEventStatus = async (req, res) => {
  const { status } = req.body;
  const { id }     = req.params;
  try {
    if (!["upcoming", "ongoing", "completed", "cancelled"].includes(status)) {
      req.flash("error_msg", "Invalid status value.");
      return res.redirect(`/events/${id}`);
    }
    await updateDoc(doc(db, EVENTS, id), { status });
    const statusLabels = {
      ongoing:   "started (Ongoing)",
      completed: "manually ended (Completed)",
      upcoming:  "reset to Upcoming",
      cancelled: "marked as Cancelled",
    };
    req.flash("success_msg", `Event status updated to ${statusLabels[status] || status}.`);
    res.redirect(`/events/${id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to update event status.");
    res.redirect(`/events/${id}`);
  }
};

// ─── Assign judge to event ────────────────────────────────────────────────────
export const assignJudge = async (req, res) => {
  const { id } = req.params;
  const { judgeId } = req.body;
  try {
    if (!judgeId) {
      req.flash("error_msg", "Please select a judge.");
      return res.redirect(`/events/${id}`);
    }
    const [evSnap, judgeSnap] = await Promise.all([
      getDoc(doc(db, EVENTS, id)),
      getDoc(doc(db, "users", judgeId)),
    ]);
    if (!evSnap.exists()) return res.redirect("/events");
    const current = evSnap.data().assignedJudges || [];
    if (current.includes(judgeId)) {
      req.flash("error_msg", "This judge is already assigned to the event.");
      return res.redirect(`/events/${id}`);
    }
    await updateDoc(doc(db, EVENTS, id), {
      assignedJudges: [...current, judgeId],
    });

    // Build Gmail notification link for the judge
    if (judgeSnap.exists()) {
      const ev = evSnap.data();
      const judge = judgeSnap.data();
      const subject = encodeURIComponent(`You have been assigned as Judge — ${ev.name}`);
      const body = encodeURIComponent(
        `Dear ${judge.name || 'Judge'},\n\n` +
        `You have been assigned as an official judge for:\n\n` +
        `Event: ${ev.name}\n` +
        `Date: ${ev.date || 'TBA'}\n` +
        `Venue: ${ev.venue || 'TBA'}\n\n` +
        `Please log in to ScoreSync to view your assigned event and submit scores when the event goes live.\n\n` +
        `Login: https://scoresync.site/login\n\n` +
        `Best regards,\nScoreSync Admin`
      );
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(judge.email)}&su=${subject}&body=${body}`;
      req.flash("success_msg", `Judge assigned. <a href="${gmailUrl}" target="_blank" style="color:#60a5fa;text-decoration:underline">Click here to notify them via Gmail →</a>`);
    } else {
      req.flash("success_msg", "Judge assigned to event.");
    }
    res.redirect(`/events/${id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to assign judge.");
    res.redirect(`/events/${id}`);
  }
};

// ─── Remove judge from event ──────────────────────────────────────────────────
export const removeJudge = async (req, res) => {
  const { id, judgeId } = req.params;
  try {
    const snap = await getDoc(doc(db, EVENTS, id));
    if (!snap.exists()) return res.redirect("/events");
    const current = snap.data().assignedJudges || [];
    await updateDoc(doc(db, EVENTS, id), {
      assignedJudges: current.filter(j => j !== judgeId),
    });
    req.flash("success_msg", "Judge removed from event.");
    res.redirect(`/events/${id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to remove judge.");
    res.redirect(`/events/${id}`);
  }
};
