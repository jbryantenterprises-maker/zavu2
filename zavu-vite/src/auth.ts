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
        // Use localStorage as a fast cache for initial render, then verify
        // authoritatively via Firebase custom claims from the JWT.
        // The Lemon Squeezy webhook must set custom claims (e.g. { pro: true })
        // on the Firebase user via the Admin SDK after purchase.
        let isPro = localStorage.getItem(`zavu_pro_${firebaseUser.uid}`) === "true";
        
        try {
          const tokenResult = await firebaseUser.getIdTokenResult();
          const claims = tokenResult.claims;
          isPro = !!(
            claims.pro ||
            claims.stripeRole === 'pro' ||
            claims.plan === 'pro'
          );
          // Update cache to match authoritative value
          localStorage.setItem(`zavu_pro_${firebaseUser.uid}`, isPro ? "true" : "false");
        } catch (e) {
          console.warn("Failed to fetch token claims, using cached Pro status:", e);
        }
        
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

  /**
   * Get the current Firebase ID token (JWT) for authenticating API calls.
   * Returns null if no user is signed in.
   */
  static async getIdToken(): Promise<string | null> {
    if (!auth) return null;
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    try {
      return await currentUser.getIdToken();
    } catch {
      return null;
    }
  }
}
