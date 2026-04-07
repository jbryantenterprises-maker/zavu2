import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut as firebaseSignOut,
  onAuthStateChanged
} from "firebase/auth";
import type { User as FirebaseUser } from "firebase/auth";

// Firebase config using Vite Environment Variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let app;
let auth: ReturnType<typeof getAuth>;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (e) {
  console.warn("Firebase not initialized. Make sure to add your config.", e);
}

export type ZavuUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  isPro: boolean;
};

type AuthStateCallback = (user: ZavuUser | null) => void;

export class AuthService {
  private static user: ZavuUser | null = null;
  private static listeners: AuthStateCallback[] = [];

  static init() {
    if (!auth) return;
    
    onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        // TODO: In a production app, verify `isPro` status by querying your Firestore users collection
        // or checking for custom claims populated by your Lemon Squeezy webhook.
        // For now, we simulate a check:
        const isPro = localStorage.getItem(`zavu_pro_${firebaseUser.uid}`) === "true";
        
        this.user = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          isPro
        };
      } else {
        this.user = null;
      }
      this.notifyListeners();
    });
  }

  static async signInWithGoogle(): Promise<void> {
    if (!auth) {
      console.error("Firebase not initialized.");
      return;
    }
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in with Google", error);
    }
  }

  static async signOut(): Promise<void> {
    if (!auth) return;
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error("Error signing out", error);
    }
  }

  static onAuthStateChanged(callback: AuthStateCallback) {
    this.listeners.push(callback);
    // immediately call with current state
    callback(this.user);
  }

  private static notifyListeners() {
    for (const listener of this.listeners) {
      listener(this.user);
    }
  }

  static getUser(): ZavuUser | null {
    return this.user;
  }
}
