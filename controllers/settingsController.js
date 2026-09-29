import { db } from "../models/firebaseConfig.js";
import { doc, getDoc, updateDoc, collection, getDocs, addDoc, serverTimestamp, query, orderBy, limit } from "firebase/firestore";

// Initial default suggestions list
const DEFAULT_SUGGESTIONS = [
  {
    title: "Offline Sync Mode for Remote Venues",
    description: "Local IndexedDB caching so judges can submit scores even during wifi drops, syncing automatically when reconnected.",
    category: "Connectivity",
    votes: 14,
    status: "Under Review"
  },
  {
    title: "Custom Printable Score Sheets for Manual Audit",
    description: "Generate pre-formatted PDF judge paper score sheets with contestant names and criteria barcodes.",
    category: "Printing",
    votes: 9,
    status: "Planned"
  },
  {
    title: "Judge Feedback & Comments Box per Score",
    description: "Allow judges to add optional qualitative feedback notes alongside numerical percentage entries.",
    category: "Scoring UX",
    votes: 7,
    status: "In Progress"
  }
];

export const settingsPage = async (req, res) => {
  try {
    let userData = {};
    if (req.session.userId) {
      const userRef = doc(db, "users", req.session.userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        userData = snap.data();
      }
    }

    let customSuggestions = [];
    try {
      const q = query(collection(db, "feature_requests"), orderBy("createdAt", "desc"), limit(10));
      const querySnap = await getDocs(q);
      querySnap.forEach((docSnap) => {
        customSuggestions.push({ id: docSnap.id, ...docSnap.data() });
      });
    } catch (e) {
      console.log("No custom suggestions found or firestore collection empty.");
    }

    const allSuggestions = [...customSuggestions, ...DEFAULT_SUGGESTIONS];

    res.render("settings/index", {
      title: "Settings",
      userName: req.session.userName,
      userEmail: userData.email || "",
      userAvatar: userData.avatar || req.session.userAvatar || "",
      userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin: req.session.userRole === "admin",
      isJudge: req.session.userRole === "judge",
      isEncoder: req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      municipality: "Mansalay, Oriental Mindoro",
      systemVersion: "v2.5.0-PROD",
      aiModel: "Gemini 2.5 Flash",
      suggestions: allSuggestions
    });
  } catch (err) {
    console.error("Settings page error:", err);
    res.render("settings/index", {
      title: "Settings",
      userName: req.session.userName,
      userEmail: "",
      userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin: req.session.userRole === "admin",
      isJudge: req.session.userRole === "judge",
      isEncoder: req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      municipality: "Mansalay, Oriental Mindoro",
      systemVersion: "v2.5.0-PROD",
      aiModel: "Gemini 2.5 Flash",
      suggestions: DEFAULT_SUGGESTIONS
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
        req.session.userAvatar = avatar;
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

