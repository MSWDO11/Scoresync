import { timingSafeEqual } from "node:crypto";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../models/firebaseConfig.js";
import { applyAutoStatus } from "../utils/autoStatus.js";

export const updateScheduledEventStatuses = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "Scheduled event status updates are not configured." });
  }

  const authorization = req.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const snapshot = await getDocs(collection(db, "events"));
    const events = snapshot.docs
      .map(eventDoc => ({ id: eventDoc.id, ...eventDoc.data() }))
      .filter(event => event.date && event.status !== "cancelled");
    const previousStatuses = events.map(event => event.status);
    const results = await Promise.allSettled(
      events.map(event => applyAutoStatus(event.id, event))
    );
    const failures = results.flatMap((result, index) => (
      result.status === "rejected"
        ? [{ eventId: events[index].id, error: result.reason?.message || "Status update failed." }]
        : []
    ));

    if (failures.length) {
      console.error("Scheduled event status update failures:", failures);
      const updated = results.reduce((count, result, index) => (
        result.status === "fulfilled" && events[index].status !== previousStatuses[index]
          ? count + 1
          : count
      ), 0);
      return res.status(500).json({ updated, failures });
    }

    const updated = events.reduce((count, event, index) => (
      event.status !== previousStatuses[index] ? count + 1 : count
    ), 0);
    return res.json({ checked: events.length, updated });
  } catch (err) {
    console.error("Scheduled event status job failed:", err);
    return res.status(500).json({ error: "Could not update scheduled event statuses." });
  }
};
