import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, query, orderBy, limit, where,
} from "firebase/firestore";

export const dashboardPage = async (req, res) => {
  const role = req.session.userRole;
  try {
    // Load recent events for all roles
    const q = query(collection(db, "events"), orderBy("createdAt", "desc"), limit(5));
    const snap = await getDocs(q);
    const recentEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Count totals for admin
    let totalEvents = 0, totalUsers = 0, pendingCount = 0, ongoingCount = 0;
    let pendingUsers = [];
    let ongoingEvents = [];
    let judges = [];

    if (role === "admin") {
      const [evSnap, uSnap, ongoingSnap] = await Promise.all([
        getDocs(collection(db, "events")),
        getDocs(collection(db, "users")),
        getDocs(query(collection(db, "events"), where("status", "==", "ongoing"))),
      ]);
      totalEvents = evSnap.size;
      ongoingCount = ongoingSnap.size;

      const allUsers = uSnap.docs.map(d => {
        const data = d.data();
        const emailSubject = encodeURIComponent("ScoreSync Account Approved!");
        const emailBody = encodeURIComponent(`Hi ${data.name || 'User'},\n\nYour ScoreSync account request for the role of ${data.role || 'user'} has been APPROVED by the Administrator.\n\nYou can now log in to the system.\n\nBest regards,\nScoreSync Admin`);
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(data.email)}&su=${emailSubject}&body=${emailBody}`;

        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toLocaleDateString("en-PH") || "—",
          gmailUrl,
        };
      });

      pendingUsers = allUsers.filter(u => u.status === "pending");
      pendingCount = pendingUsers.length;
      totalUsers  = allUsers.filter(u => u.status !== "pending").length;
    }

    // Organizer: load ongoing events + judges list
    if (role === "organizer") {
      const [ongoingSnap, allEvSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, "events"), where("status", "==", "ongoing"))),
        getDocs(collection(db, "events")),
        getDocs(query(collection(db, "users"), where("role", "==", "judge"))),
      ]);
      ongoingEvents = ongoingSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      ongoingCount  = ongoingEvents.length;
      totalEvents   = allEvSnap.size;
      judges = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.status === "active" || u.status === "approved" || !u.status)
        .map(u => ({
          id:      u.id,
          name:    u.name || u.displayName || u.email || "Judge",
          email:   u.email || "",
          initial: (u.name || u.email || "J")[0].toUpperCase(),
        }));
    }

    const viewData = {
      title: "Dashboard",
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     role === "admin",
      isJudge:     role === "judge",
      isEncoder:   role === "encoder",
      isOrganizer: role === "organizer",
      recentEvents,
      totalEvents,
      totalUsers,
      ongoingCount,
      ongoingEvents,
      judges,
      pendingUsers,
      pendingCount,
    };

    if (role === "admin")     return res.render("dashboard/admin",     viewData);
    if (role === "judge")     return res.render("dashboard/judge",     viewData);
    if (role === "organizer") return res.render("dashboard/organizer", viewData);
    return res.render("dashboard/encoder", viewData);

  } catch (err) {
    console.error(err);
    // Fallback: render a simple dashboard without stats
    res.render("dashboard/admin", {
      title: "Dashboard",
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     role === "admin",
      isJudge:     role === "judge",
      isEncoder:   role === "encoder",
      isOrganizer: role === "organizer",
      recentEvents: [],
      totalEvents: 0,
      totalUsers: 0,
      ongoingCount: 0,
      ongoingEvents: [],
      judges: [],
    });
  }
};
