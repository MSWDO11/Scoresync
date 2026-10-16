// ─── Standalone utility: no cross-controller imports ─────────────────────────
// Keeping this separate breaks the circular import chain that crashes Render.
import { db } from "../models/firebaseConfig.js";
import { doc, updateDoc } from "firebase/firestore";
import { getScheduledEventStatus } from "./scheduledEventStatus.js";

export async function applyAutoStatus(eventId, event) {
  const newStatus = getScheduledEventStatus(event);

  if (newStatus !== event.status) {
    try {
      await updateDoc(doc(db, "events", eventId), {
        status: newStatus,
        statusManuallySet: false,
      });
      event.status = newStatus;
      event.statusManuallySet = false;
    } catch (err) {
      console.error("applyAutoStatus error:", err);
      throw err;
    }
  }
  return event.status;
}
