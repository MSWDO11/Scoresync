import { db } from "../models/firebaseConfig.js";
import { doc, getDoc, updateDoc, collection, getDocs, addDoc, serverTimestamp, query, orderBy, limit } from "firebase/firestore";

export const settingsPage = async (req, res) => {
  try {
    let userData = {};
    if (req.session.userId) {
      const userRef = doc(db, "users", req.session.userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) userData = snap.data();
    }

    // Only real submissions from Firestore — no fake defaults
    let suggestions = [];
    try {
      const q = query(collection(db, "feature_requests"), orderBy("createdAt", "desc"), limit(20));
      const querySnap = await getDocs(q);
      querySnap.forEach(d => suggestions.push({ id: d.id, ...d.data() }));
    } catch (e) {
      // Collection doesn't exist yet — that's fine, suggestions stays []
    }

    res.render("settings/index", {
      title: "Settings",
      userName:    req.session.userName,
      userEmail:   userData.email || "",
      userAvatar:  userData.avatar || req.session.userAvatar || "",
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isJudge:     req.session.userRole === "judge",
      isEncoder:   req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      municipality:  "Mansalay, Oriental Mindoro",
      systemVersion: "v2.5.0-PROD",
      aiModel:       "Gemini 2.5 Flash",
      suggestions,
    });
  } catch (err) {
    console.error("Settings page error:", err);
    res.render("settings/index", {
      title:       "Settings",
      userName:    req.session.userName,
      userEmail:   "",
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isJudge:     req.session.userRole === "judge",
      isEncoder:   req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      municipality:  "Mansalay, Oriental Mindoro",
      systemVersion: "v2.5.0-PROD",
      aiModel:       "Gemini 2.5 Flash",
      suggestions:   [],
    });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    if (req.session.userId) {
      const updates = {};
      if (name && name.trim()) {
        updates.name = name.trim();
        req.session.userName = name.trim();
      }
      // Save avatar (base64) to Firestore if provided and valid
      if (avatar && typeof avatar === 'string' && avatar.startsWith('data:image')) {
        updates.avatar = avatar;
        // Do NOT store avatar in session — cookie-session has 4KB limit
      }
      if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, "users", req.session.userId), updates);
      }
      req.flash("success_msg", "Profile updated successfully!");
    }
    res.redirect("/settings");
  } catch (err) {
    console.error("Update settings error:", err);
    req.flash("error_msg", "Failed to update settings. " + err.message);
    res.redirect("/settings");
  }
};

export const suggestFeature = async (req, res) => {
  try {
    const { title, category, description } = req.body;
    if (title && description) {
      await addDoc(collection(db, "feature_requests"), {
        title: title.trim(),
        category: category || "General",
        description: description.trim(),
        submittedBy: req.session.userName || "Anonymous User",
        votes: 1,
        status: "Submitted",
        createdAt: serverTimestamp()
      });
      req.flash("success_msg", "Thank you! Your feature suggestion has been submitted successfully.");
    }
    res.redirect("/settings");
  } catch (err) {
    console.error("Suggest feature error:", err);
    req.flash("error_msg", "Unable to submit feature suggestion.");
    res.redirect("/settings");
  }
};

