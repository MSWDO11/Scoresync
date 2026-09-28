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
  if (endDt && !isNaN(endDt) && now >= endDt)   newStatus = 'completed';
  else if (!isNaN(startDt) && now >= startDt)    newStatus = 'ongoing';
  else                                           newStatus = 'upcoming';

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
