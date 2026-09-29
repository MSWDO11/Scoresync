import { auth, db } from "../models/firebaseConfig.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, getDocs,
  collection, query, limit,
} from "firebase/firestore";

// ─── Page renderers ───────────────────────────────────────────────────────────

export const loginPage = (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("login", { title: "Login" });
};

export const registerPage = (req, res) => {
  if (req.session.userId) {
    // Allow admin to access register page when explicitly adding a user (e.g. ?role=judge)
    if (req.session.userRole === "admin" && !req.query.role) return res.redirect("/users");
    if (req.session.userRole !== "admin") return res.redirect("/dashboard");
  }
  res.render("register", {
    title: "Register",
    preRole: req.query.role || "",
  });
};

export const forgotPasswordPage = (req, res) =>
  res.render("forgotpassword", { title: "Forgot Password" });

// ─── Setup page (one-time admin creator) ─────────────────────────────────────

export const setupPage = async (req, res) => {
  // Check if any users already exist
  const snap = await getDocs(query(collection(db, "users"), limit(1)));
  const hasUsers = !snap.empty;
  res.render("setup", { title: "Setup Admin", hasUsers });
};

export const setupAdmin = async (req, res) => {
  const { name, email, password } = req.body;

  // Only allow if no users exist yet
  const snap = await getDocs(query(collection(db, "users"), limit(1)));
  if (!snap.empty) {
    req.flash("error_msg", "Setup already completed. An admin account exists.");
    return res.redirect("/login");
  }

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    await setDoc(doc(db, "users", uid), {
      name,
      email,
      role: "admin",           // always admin on setup
      status: "approved",
      createdAt: new Date(),
    });

    req.session.userId   = uid;
    req.session.userName = name;
    req.session.userRole = "admin";

    req.flash("success_msg", `Admin account created. Welcome, ${name}!`);
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Setup error:", err.code, err.message);
    req.flash("error_msg", friendlyError(err.code));
    res.redirect("/setup");
  }
};

// ─── Fix role for existing Firebase Auth user ─────────────────────────────────
// Visit /fix-role?email=you@email.com&role=admin  (one-time use, then remove)

export const fixRole = async (req, res) => {
  const { email, role } = req.query;
  const allowed = ["admin", "judge", "encoder"];

  if (!email || !allowed.includes(role)) {
    return res.json({ error: "Provide ?email=...&role=admin|judge|encoder" });
  }

  try {
    // Find user doc by email
    const usersSnap = await getDocs(collection(db, "users"));
    const userDoc = usersSnap.docs.find(d => d.data().email === email);

    if (!userDoc) {
      return res.json({ error: `No Firestore user found with email: ${email}` });
    }

    await setDoc(doc(db, "users", userDoc.id), {
      ...userDoc.data(),
      role,
    });

    return res.json({
      success: true,
      message: `Role updated to "${role}" for ${email}. Log out and log back in.`,
      uid: userDoc.id,
    });
  } catch (err) {
    return res.json({ error: err.message });
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────

export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    const snap = await getDoc(doc(db, "users", uid));
    const profile = snap.exists() ? snap.data() : {};

    // Check account status (Admin accounts are exempt and auto-approved)
    if (profile.role !== "admin" && profile.status === "pending") {
      await signOut(auth);
      req.flash(
        "error_msg",
        "Your account request is still pending approval by the Admin. Please wait for Gmail confirmation."
      );
      return res.redirect("/login");
    }

    if (profile.role !== "admin" && profile.status === "rejected") {
      await signOut(auth);
      req.flash("error_msg", "Your account request was declined by the Admin.");
      return res.redirect("/login");
    }

    req.session.userId    = uid;
    req.session.userName  = profile.name   || email;
    req.session.userRole  = profile.role   || "encoder";
    req.session.userAvatar = profile.avatar || "";

    console.log(`✅ Login: ${email} as ${req.session.userRole}`);
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Login error:", err.code, err.message);
    req.flash("error_msg", friendlyError(err.code));
    res.redirect("/login");
  }
};

// ─── Register ─────────────────────────────────────────────────────────────────

export const registerUser = async (req, res) => {
  const { name, email, password, role } = req.body;
  const allowedRoles = ["judge", "encoder", "organizer"];   // admin only via /setup

  if (!allowedRoles.includes(role)) {
    req.flash("error_msg", "Invalid role selected.");
    return res.redirect("/register");
  }

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    await setDoc(doc(db, "users", uid), {
      name, email, role,
      status: "pending",
      createdAt: new Date(),
    });

    // Sign out immediately so user is not logged in while request is pending
    await signOut(auth);

    console.log(`⏳ Account Request Submitted: ${email} as ${role}`);
    req.flash(
      "success_msg",
      `Your account request for ${name} (${email}) has been sent to the Admin for approval. You will receive a notification on your Gmail once confirmed!`
    );
    res.redirect("/login");
  } catch (err) {
    console.error("Register error:", err.code, err.message);
    req.flash("error_msg", friendlyError(err.code));
    res.redirect("/register");
  }
};

// ─── Forgot password ──────────────────────────────────────────────────────────

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    await sendPasswordResetEmail(auth, email);
    req.flash("success_msg", "Password reset email sent. Check your inbox.");
  } catch (err) {
    req.flash("error_msg", friendlyError(err.code));
  }
  res.redirect("/forgot-password");
};

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logoutUser = async (req, res) => {
  try { await signOut(auth); } catch (_) {}
  req.session.destroy(() => res.redirect("/login"));
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function friendlyError(code) {
  const map = {
    "auth/invalid-email":           "Invalid email address.",
    "auth/user-not-found":          "No account found with that email.",
    "auth/wrong-password":          "Incorrect password.",
    "auth/invalid-credential":      "Incorrect email or password.",
    "auth/email-already-in-use":    "That email is already registered.",
    "auth/weak-password":           "Password must be at least 6 characters.",
    "auth/too-many-requests":       "Too many attempts. Try again later.",
    "auth/network-request-failed":  "Network error. Check your internet connection.",
    "auth/operation-not-allowed":   "Email/Password sign-in is not enabled in Firebase Console.",
    "auth/configuration-not-found": "Firebase Auth not configured. Enable Email/Password in Firebase Console.",
  };
  return map[code] || `Error (${code || "unknown"}). Please try again.`;
}
