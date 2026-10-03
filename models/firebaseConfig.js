import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey:            process.env.FIREBASE_API_KEY            || "AIzaSyCQTkh6tsjLjuw6d6KaPetiNH2CriQxD7Q",
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN        || "scoresync-92994.firebaseapp.com",
  projectId:         process.env.FIREBASE_PROJECT_ID         || "scoresync-92994",
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET     || "scoresync-92994.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID|| "518166819896",
  appId:             process.env.FIREBASE_APP_ID             || "1:518166819896:web:8155a8be113adb9adb62cd",
  measurementId:     process.env.FIREBASE_MEASUREMENT_ID     || "G-R9WJWV7KWR"
};

// ── Singleton guard — re-use existing app across Vercel warm re-invocations ──
const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

export { db, auth, firebaseConfig };
