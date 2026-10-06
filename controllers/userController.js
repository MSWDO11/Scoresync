import { db, auth, firebaseConfig } from "../models/firebaseConfig.js";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import {
  collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, query, orderBy,
} from "firebase/firestore";
import { sanitizeText, sanitizeEmail, sanitizeRole } from "../utils/sanitize.js";

// ─── List all users ───────────────────────────────────────────────────────────
export const listUsers = async (req, res) => {
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    const allUsers = snap.docs.map(d => {
      const data = d.data();
      const emailSubject = encodeURIComponent("ScoreSync Account Approved!");
      const emailBody = encodeURIComponent(`Hi ${data.name || 'User'},\n\nYour ScoreSync account request for the role of ${data.role || 'user'} has been APPROVED by the Administrator.\n\nYou can now log in to the system at ${req.protocol}://${req.get("host")}/login\n\nBest regards,\nScoreSync Admin`);
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(data.email)}&su=${emailSubject}&body=${emailBody}`;
      const mailtoUrl = `mailto:${encodeURIComponent(data.email)}?subject=${emailSubject}&body=${emailBody}`;

      return {
        id: d.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toLocaleDateString("en-PH") || "—",
        gmailUrl,
        mailtoUrl,
      };
    });

    const pendingUsers = allUsers.filter(u => u.status === "pending");
    const activeUsers  = allUsers.filter(u => u.status !== "pending");

    // Count by role
    const adminCount   = allUsers.filter(u => u.role === "admin" && u.status !== "pending").length;
    const judgeCount   = allUsers.filter(u => u.role === "judge" && u.status !== "pending").length;
    const encoderCount = allUsers.filter(u => u.role === "encoder" && u.status !== "pending").length;

    const notifyEmail = req.query.notifyEmail;
    const notifyName  = req.query.notifyName;
    const notifyGmail = req.query.notifyGmail;

    res.render("users/index", {
      title:        "Users",
      users:        activeUsers,
      pendingUsers,
      pendingCount: pendingUsers.length,
      adminCount,
      judgeCount,
      encoderCount,
      totalUsers:   activeUsers.length,
      userName:     req.session.userName,
      userRole:     req.session.userRole,
      userInitial:  (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:      true,
      notifyEmail,
      notifyName,
      notifyGmail,
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load users.");
    res.redirect("/dashboard");
  }
};

// ─── Approve account request ──────────────────────────────────────────────────
export const approveUser = async (req, res) => {
  const { id } = req.params;
  try {
    const userDoc = await getDoc(doc(db, "users", id));
    if (!userDoc.exists()) {
      req.flash("error_msg", "User request not found.");
      return res.redirect("/users");
    }
    const userData = userDoc.data();

    await updateDoc(doc(db, "users", id), { status: "approved" });

    const emailSubject = encodeURIComponent("ScoreSync Account Approved!");
    const emailBody = encodeURIComponent(`Hi ${userData.name || 'User'},\n\nYour ScoreSync account request for the role of ${userData.role || 'user'} has been APPROVED by the Administrator.\n\nYou can now log in to the system at ${req.protocol}://${req.get("host")}/login\n\nBest regards,\nScoreSync Admin`);
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(userData.email)}&su=${emailSubject}&body=${emailBody}`;

    req.flash("success_msg", `Approved account request for ${userData.name} (${userData.email})!`);
    res.redirect(`/users?notifyEmail=${encodeURIComponent(userData.email)}&notifyName=${encodeURIComponent(userData.name)}&notifyGmail=${encodeURIComponent(gmailUrl)}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to approve account request.");
    res.redirect("/users");
  }
};

// ─── Reject account request ───────────────────────────────────────────────────
export const rejectUser = async (req, res) => {
  const { id } = req.params;
  try {
    const userDoc = await getDoc(doc(db, "users", id));
    const userData = userDoc.exists() ? userDoc.data() : {};

    await updateDoc(doc(db, "users", id), { status: "rejected" });

    req.flash("success_msg", `Account request for ${userData.name || 'user'} rejected.`);
    res.redirect("/users");
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to reject user request.");
    res.redirect("/users");
  }
};

// ─── Edit user role ───────────────────────────────────────────────────────────
export const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const role   = sanitizeRole(req.body.role, ["judge", "encoder", "organizer"]);
  const allowed = ["judge", "encoder", "organizer"]; // admin NOT in allowed — cannot assign or change to/from admin

  if (!allowed.includes(role)) {
    req.flash("error_msg", "Invalid role selection.");
    return res.redirect("/users");
  }

  // Prevent changing own role
  if (id === req.session.userId) {
    req.flash("error_msg", "You cannot change your own role.");
    return res.redirect("/users");
  }

  try {
    // Block changing an admin account's role
    const targetDoc = await getDoc(doc(db, "users", id));
    if (targetDoc.exists() && targetDoc.data().role === "admin") {
      req.flash("error_msg", "Admin accounts are protected and cannot have their role changed.");
      return res.redirect("/users");
    }

    await updateDoc(doc(db, "users", id), { role });
    req.flash("success_msg", "User role updated.");
    res.redirect("/users");
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to update role.");
    res.redirect("/users");
  }
};

// ─── Delete user ──────────────────────────────────────────────────────────────
export const deleteUser = async (req, res) => {
  const { id } = req.params;

  if (id === req.session.userId) {
    req.flash("error_msg", "You cannot delete your own account.");
    return res.redirect("/users");
  }

  try {
    // Block deleting any admin account
    const targetDoc = await getDoc(doc(db, "users", id));
    if (targetDoc.exists() && targetDoc.data().role === "admin") {
      req.flash("error_msg", "Admin accounts are protected and cannot be deleted.");
      return res.redirect("/users");
    }

    await deleteDoc(doc(db, "users", id));
    req.flash("success_msg", "User removed from the system.");
    res.redirect("/users");
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to delete user.");
    res.redirect("/users");
  }
};

// ─── Create user (admin) ──────────────────────────────────────────────────────
export const createUser = async (req, res) => {
  const name     = sanitizeText(req.body.name, 100);
  const email    = sanitizeEmail(req.body.email);
  const password = req.body.password || "";
  const role     = sanitizeRole(req.body.role, ["judge", "encoder", "organizer"]);
  const allowed = ["judge", "encoder", "organizer"]; // admin cannot be created via this form

  if (!name || !email || !password || !allowed.includes(role)) {
    req.flash("error_msg", "Please fill in all required fields and select a valid role.");
    return res.redirect("/users");
  }

  let tempApp;
  try {
    tempApp = initializeApp(firebaseConfig, "TempApp_" + Date.now());
    const tempAuth = getAuth(tempApp);

    const credential = await createUserWithEmailAndPassword(tempAuth, email, password);
    const uid = credential.user.uid;

    await setDoc(doc(db, "users", uid), {
      name,
      email,
      role,
      status: "approved",
      createdAt: new Date(),
    });

    await deleteApp(tempApp);

    req.flash("success_msg", `Successfully created ${role.toUpperCase()} account for ${name} (${email}).`);
    res.redirect("/users");
  } catch (err) {
    console.error("Create user error:", err);
    if (tempApp) try { await deleteApp(tempApp); } catch (_) {}
    
    let errMsg = "Failed to create user.";
    if (err.code === "auth/email-already-in-use") errMsg = "Email address is already registered.";
    else if (err.code === "auth/weak-password") errMsg = "Password should be at least 6 characters.";
    else if (err.message) errMsg += " " + err.message;

    req.flash("error_msg", errMsg);
    res.redirect("/users");
  }
};
