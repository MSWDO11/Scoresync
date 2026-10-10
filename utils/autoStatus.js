// ─── Standalone utility: no cross-controller imports ─────────────────────────
// Keeping this separate breaks the circular import chain that crashes Render.
import { db } from "../models/firebaseConfig.js";
import { doc, updateDoc } from "firebase/firestore";

export async function applyAutoStatus(eventId, event) {
  if (!event.date || event.status === 'cancelled') return event.status;

  const now = new Date();

  // Parse as Philippine Standard Time (UTC+8)
  const startStr = event.date + 'T' + (event.time || '00:00') + ':00+08:00';
  const endStr   = event.endTime ? event.date + 'T' + event.endTime + ':00+08:00' : null;

  const startDt = new Date(startStr);
  const endDt   = endStr ? new Date(endStr) : null;

  let newStatus;
  // Auto-complete is disabled — events only complete when organizer/admin manually ends them.
  // This prevents judges being blocked mid-scoring if an event runs over time.
  // Auto-start (upcoming → ongoing) is still active.
  if (!isNaN(startDt) && now >= startDt && event.status !== 'completed') newStatus = 'ongoing';
  else if (isNaN(startDt) || now < startDt)                               newStatus = 'upcoming';
  else                                                                     newStatus = event.status; // keep current

  if (newStatus !== event.status) {
    try {
      await updateDoc(doc(db, "events", eventId), { status: newStatus });
      event.status = newStatus;
    } catch (err) {
      console.error("applyAutoStatus error:", err.message);
    }
  }
  return event.status;
}
