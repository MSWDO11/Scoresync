import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, initializeFirestore, CACHE_SIZE_UNLIMITED } from "firebase/firestore";
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

// ── Singleton guard — re-use existing app across Vercel cold-start re-evals ──
let app, db;
if (getApps().length) {
  app = getApp();
  db  = getFirestore(app);
} else {
  app = initializeApp(firebaseConfig);
  // Use long-polling instead of WebSocket — much faster on serverless (no WebSocket handshake)
  db  = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  });
}

const auth = getAuth(app);

export { db, auth, firebaseConfig };
