// Firestore-backed session store for express-session
// Works on Vercel serverless — sessions persist across function instances
import { db } from "../models/firebaseConfig.js";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import session from "express-session";

const Store = session.Store;

export class FirestoreStore extends Store {
  constructor(options = {}) {
    super(options);
    this.collection = options.collection || "sessions";
  }

  async get(sid, callback) {
    try {
      const snap = await getDoc(doc(db, this.collection, sid));
      if (!snap.exists()) return callback(null, null);
      const data = snap.data();
      if (data.expires && Date.now() > data.expires) {
        await this.destroy(sid, () => {});
        return callback(null, null);
      }
      callback(null, data.session);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sessionData, callback) {
    try {
      const expires = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 8;
      await setDoc(doc(db, this.collection, sid), {
        session: sessionData,
        expires,
        updatedAt: Date.now(),
      });
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await deleteDoc(doc(db, this.collection, sid));
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}
