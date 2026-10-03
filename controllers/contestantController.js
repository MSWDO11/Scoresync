import { db } from "../models/firebaseConfig.js";
import {
  collection, addDoc, getDocs, getDoc, doc,
  updateDoc, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { autoCreateRegistrationRecord, autoDeleteRegistrationRecord } from "./inventoryController.js";

// Contestants are sub-collections under events: events/{eventId}/contestants

// ─── Add contestant form ──────────────────────────────────────────────────────
export const addContestantPage = async (req, res) => {
  try {
    const eSnap = await getDoc(doc(db, "events", req.params.eventId));
    if (!eSnap.exists()) return res.redirect("/events");

    const ev = eSnap.data();
    const maxContestants = Number(ev.maxContestants) || 0;

    // Check limit before showing the form
    if (maxContestants > 0) {
      const cSnap = await getDocs(collection(db, "events", req.params.eventId, "contestants"));
      if (cSnap.size >= maxContestants) {
        req.flash("error_msg", `Contestant limit reached. This event allows a maximum of ${maxContestants} contestants.`);
        return res.redirect(`/events/${req.params.eventId}`);
      }
    }

    const PAYMENT_TYPES = ['pageant','talent','cultural','choral','dance','culinary','booth','sports','academic','other'];
    res.render("contestants/create", {
      title: "Add Contestant",
      event: { id: eSnap.id, ...ev },
      userName: req.session.userName,
      userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin: req.session.userRole === "admin",
      isOrganizer: req.session.userRole === "organizer",
      isPaymentType: PAYMENT_TYPES.includes(ev.type),
    });
  } catch (err) {
    req.flash("error_msg", "Could not load event.");
    res.redirect("/events");
  }
};

// ─── Store contestant ─────────────────────────────────────────────────────────
export const storeContestant = async (req, res) => {
  const { name, number, barangay, age, gender, description, photo, platform, registrationFee } = req.body;
  const { eventId } = req.params;
  try {
    // ── Enforce maxContestants limit ─────────────────────────────────────────
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (eSnap.exists()) {
      const maxContestants = Number(eSnap.data().maxContestants) || 0;
      if (maxContestants > 0) {
        const cSnap = await getDocs(collection(db, "events", eventId, "contestants"));
        if (cSnap.size >= maxContestants) {
          req.flash("error_msg", `Cannot add more contestants. The limit for this event is ${maxContestants}.`);
          return res.redirect(`/events/${eventId}`);
        }
      }
    }

    const docRef = await addDoc(collection(db, "events", eventId, "contestants"), {
      name,
      number:          number          || "",
      barangay:        barangay        || "",
      age:             age             || "",
      gender:          gender          || "",
      description:     description     || "",
      platform:        platform        || "",
      photo:           photo           || "",
      registrationFee: Number(registrationFee) || 0,
      createdAt:       serverTimestamp(),
    });

    // Auto-create a ticket/income record for the registration fee
    await autoCreateRegistrationRecord(eventId, name, docRef.id, registrationFee, req.session.userId);

    req.flash("success_msg", `Contestant "${name}" added.`);
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to add contestant.");
    res.redirect(`/events/${eventId}/contestants/add`);
  }
};

// ─── Edit contestant form ─────────────────────────────────────────────────────
export const editContestantPage = async (req, res) => {
  const { eventId, id } = req.params;
  try {
    const [eSnap, cSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDoc(doc(db, "events", eventId, "contestants", id)),
    ]);
    if (!eSnap.exists() || !cSnap.exists()) return res.redirect(`/events/${eventId}`);
    const PAYMENT_TYPES = ['pageant','talent','cultural','choral','dance','culinary','booth','sports','academic','other'];
    res.render("contestants/edit", {
      title: "Edit Contestant",
      event:      { id: eSnap.id, ...eSnap.data() },
      contestant: { id: cSnap.id, ...cSnap.data() },
      userName: req.session.userName,
      userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin: req.session.userRole === "admin",
      isOrganizer: req.session.userRole === "organizer",
      isPaymentType: PAYMENT_TYPES.includes(eSnap.data().type),
    });
  } catch (err) {
    req.flash("error_msg", "Could not load contestant.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Update contestant ────────────────────────────────────────────────────────
export const updateContestant = async (req, res) => {
  const { eventId, id } = req.params;
  const { name, number, barangay, age, gender, description, photo, platform } = req.body;
  try {
    await updateDoc(doc(db, "events", eventId, "contestants", id), {
      name,
      number:      number      || "",
      barangay:    barangay    || "",
      age:         age         || "",
      gender:      gender      || "",
      description: description || "",
      platform:    platform    || "",
      photo:       photo       || "",
    });
    req.flash("success_msg", "Contestant updated.");
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    req.flash("error_msg", "Failed to update contestant.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Delete contestant ────────────────────────────────────────────────────────
export const deleteContestant = async (req, res) => {
  const { eventId, id } = req.params;
  try {
    await deleteDoc(doc(db, "events", eventId, "contestants", id));
    // Auto-delete the linked registration fee ticket record
    await autoDeleteRegistrationRecord(eventId, id);
    req.flash("success_msg", "Contestant removed.");
  } catch (err) {
    req.flash("error_msg", "Failed to remove contestant.");
  }
  res.redirect(`/events/${eventId}`);
};
