import { db } from "../models/firebaseConfig.js";
import { getFinanceSummary } from "./financeController.js";
import {
  collection, addDoc, getDocs, getDoc, doc,
  updateDoc, deleteDoc, query, orderBy, serverTimestamp,
} from "firebase/firestore";

// ─── Shared: compute and apply auto-status for a single event ────────────────
export async function applyAutoStatus(eventId, event) {
  if (!event.date || event.status === 'cancelled') return event.status;

  const now = new Date();

  // Parse as Philippine Standard Time (UTC+8) — events are always in PHT
  // Appending +08:00 ensures server interprets times correctly regardless of server TZ
  const startStr = event.date + 'T' + (event.time || '00:00') + ':00+08:00';
  const endStr   = event.endTime ? event.date + 'T' + event.endTime + ':00+08:00' : null;

  const startDt  = new Date(startStr);
  const endDt    = endStr ? new Date(endStr) : null;

  let newStatus;
  if (endDt && !isNaN(endDt) && now >= endDt)    newStatus = 'completed';
  else if (!isNaN(startDt) && now >= startDt)     newStatus = 'ongoing';
  else                                             newStatus = 'upcoming';

  if (newStatus !== event.status) {
    await updateDoc(doc(db, "events", eventId), { status: newStatus });
    event.status = newStatus;
  }
  return event.status;
}

const EVENTS = "events";

// ─── List all events ──────────────────────────────────────────────────────────
export const listEvents = async (req, res) => {
  try {
    const q = query(collection(db, EVENTS), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Auto-update status for all non-cancelled events based on date/time
    await Promise.all(
      events
        .filter(e => e.date && e.status !== 'cancelled')
        .map(e => applyAutoStatus(e.id, e))
    );

    res.render("events/index", {
      title: "Events",
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
    await addDoc(collection(db, EVENTS), {
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
    req.flash("success_msg", `Event "${name}" created successfully.`);
    res.redirect("/events");
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
    const event = { id: snap.id, ...snap.data() };

    // Flag whether this event type requires payment (controls Payment QR display)
    const PAYMENT_TYPES = ['pageant','talent','cultural','choral','dance','culinary','booth','sports','academic','other'];
    event.isPaymentType = PAYMENT_TYPES.includes(event.type);
    // Flag whether this event type uses prizes/rules
    const PRIZE_TYPES = ['pageant','talent','choral','dance','culinary','academic'];
    event.isPrizeType = PRIZE_TYPES.includes(event.type);
    // Flag for finance management (admin + organizer)
    event.canManageFinance = ['admin','organizer'].includes(req.session.userRole);

    // ── Auto-status: update Firestore if date/time/endTime says status changed ──
    await applyAutoStatus(req.params.id, event);

    const [cSnap, crSnap, finance] = await Promise.all([
      getDocs(collection(db, EVENTS, req.params.id, "contestants")),
      getDocs(collection(db, EVENTS, req.params.id, "criteria")),
      getFinanceSummary(req.params.id),
    ]);
    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const criteria    = crSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.render("events/show", {
      title:       event.name,
      event,
      contestants,
      criteria,
      finance,
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
    const event = { id: snap.id, ...snap.data() };
    const PAYMENT_TYPES = ['pageant','talent','cultural','choral','dance','culinary','booth','sports','academic','other'];
    const PRIZE_TYPES   = ['pageant','talent','choral','dance','culinary','academic'];
    res.render("events/edit", {
      title:         `Edit — ${event.name}`,
      event,
      userName:      req.session.userName,
      userRole:      req.session.userRole,
      userInitial:   (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:       req.session.userRole === "admin",
      isOrganizer:   req.session.userRole === "organizer",
      isPaymentType: PAYMENT_TYPES.includes(event.type),
      isPrizeType:   PRIZE_TYPES.includes(event.type),
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

// ─── Update event status (Manual Start / End) ───────────────────────────────
export const updateEventStatus = async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  try {
    if (!["upcoming", "ongoing", "completed", "cancelled"].includes(status)) {
      req.flash("error_msg", "Invalid status value.");
      return res.redirect(`/events/${id}`);
    }
    await updateDoc(doc(db, EVENTS, id), { status });
    const statusLabels = {
      ongoing: "started (Ongoing)",
      completed: "manually ended (Completed)",
      upcoming: "reset to Upcoming",
      cancelled: "marked as Cancelled"
    };
    req.flash("success_msg", `Event status updated to ${statusLabels[status] || status}.`);
    res.redirect(`/events/${id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to update event status.");
    res.redirect(`/events/${id}`);
  }
};
