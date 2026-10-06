import { db } from "../models/firebaseConfig.js";
import { doc, getDoc } from "firebase/firestore";

// Middleware: require a logged-in session
export const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    req.flash("error_msg", "Please log in to continue.");
    return res.redirect("/login");
  }
  next();
};

// Middleware: restrict to specific roles
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.session.userId) {
    req.flash("error_msg", "Please log in to continue.");
    return res.redirect("/login");
  }
  if (!roles.includes(req.session.userRole)) {
    return res.status(403).render("403", {
      title: "Access Denied",
      userName: req.session.userName,
      userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
    });
  }
  next();
};

// Inject session user data + avatar into all view locals
export const injectUser = async (req, res, next) => {
  res.locals.userName      = req.session?.userName  || "";
  res.locals.userRole      = req.session?.userRole  || "";
  res.locals.userInitial   = (req.session?.userName || "U")[0].toUpperCase();
  res.locals.isAdmin       = req.session?.userRole === "admin";
  res.locals.isJudge       = req.session?.userRole === "judge";
  res.locals.isEncoder     = req.session?.userRole === "encoder";
  res.locals.isOrganizer   = req.session?.userRole === "organizer";

  // Fetch avatar from Firestore so it shows in navbar on ALL pages
  res.locals.userAvatar = "";
  if (req.session?.userId) {
    try {
      const snap = await getDoc(doc(db, "users", req.session.userId));
      if (snap.exists()) {
        const data = snap.data();
        res.locals.userAvatar = data.avatar || data.photoURL || data.photo || "";
      }
    } catch (e) {
      // Silent fail — navbar will show initial letter instead
    }
  }
  next();
};
