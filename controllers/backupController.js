import { db } from "../models/firebaseConfig.js";
import { collection, getDocs } from "firebase/firestore";

export const backupData = async (req, res) => {
  try {
    const eventsSnap = await getDocs(collection(db, "events"));
    const eventsData = [];
    for (const evDoc of eventsSnap.docs) {
      const evObj = { id: evDoc.id, ...evDoc.data() };
      const [cSnap, crSnap, sSnap, aSnap] = await Promise.all([
        getDocs(collection(db, "events", evDoc.id, "contestants")),
        getDocs(collection(db, "events", evDoc.id, "criteria")),
        getDocs(collection(db, "events", evDoc.id, "scores")),
        getDocs(collection(db, "events", evDoc.id, "audit_log")),
      ]);
      evObj.contestants = cSnap.docs.map(d  => ({ id: d.id,  ...d.data() }));
      evObj.criteria    = crSnap.docs.map(d => ({ id: d.id,  ...d.data() }));
      evObj.scores      = sSnap.docs.map(d  => ({ id: d.id,  ...d.data() }));
      evObj.audit_log   = aSnap.docs.map(d  => ({ id: d.id,  ...d.data() }));
      eventsData.push(evObj);
    }
    const usersSnap = await getDocs(collection(db, "users"));
    const usersData = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const date   = new Date().toISOString().split("T")[0];
    const backup = {
      exportedAt:  new Date().toISOString(),
      exportedBy:  req.session.userName || "admin",
      version:     "1.0",
      events:      eventsData,
      users:       usersData,
    };
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=scoresync-backup-${date}.json`);
    return res.status(200).send(JSON.stringify(backup, null, 2));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Backup failed." });
  }
};
