import { initializeApp, type FirebaseApp } from "firebase/app";
import { 
  getAuth, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from "firebase/auth";
import type { User as FirebaseUser } from "firebase/auth";
import { Logger } from './logger';

// Validate required environment variables
function validateFirebaseConfig(): boolean {
  const requiredVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
  ];

  const missingVars = requiredVars.filter(varName => {
    const value = import.meta.env[varName];
    return !value || value.trim() === '';
  });

  if (missingVars.length > 0) {
    Logger.error(`Missing required Firebase environment variables: ${missingVars.join(', ')}`);
    return false;
  }

  return true;
}

// Firebase config using Vite Environment Variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export let app: FirebaseApp | undefined;
let auth: ReturnType<typeof getAuth>;

try {
  if (!validateFirebaseConfig()) {
    throw new Error('Firebase configuration is incomplete');
  }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (e) {
  Logger.warn("Firebase not initialized. Make sure to add your config.", e);
}

export type XavuUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  isPro: boolean;
};

type AuthStateCallback = (user: XavuUser | null) => void;

function firebaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export class AuthService {
  private static user: XavuUser | null = null;
  private static listeners: AuthStateCallback[] = [];

  static init() {
    if (!auth) return;
    
    onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        await this.syncUserFromFirebase(firebaseUser);
      } else {
        this.user = null;
      }
      this.notifyListeners();
    });
  }

  static validatePassword(password: string): { isValid: boolean; error?: string } {
    if (password.length < 12) {
      return { isValid: false, error: "Password must be at least 12 characters long." };
    }
    if (!/[a-z]/.test(password)) {
      return { isValid: false, error: "Password must contain at least one lowercase letter." };
    }
    if (!/[A-Z]/.test(password)) {
      return { isValid: false, error: "Password must contain at least one uppercase letter." };
    }
    return { isValid: true };
  }

  static async signUp(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    if (!auth) {
      Logger.error("Firebase not initialized.");
      return { success: false, error: "Authentication service not available" };
    }

    // Validate password requirements
    const passwordValidation = this.validatePassword(password);
    if (!passwordValidation.isValid) {
      return { success: false, error: passwordValidation.error };
    }

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      Logger.debug("User signed up successfully.");
      return { success: true };
    } catch (error: unknown) {
      Logger.error("Error signing up:", error);
      let errorMessage = "Sign up failed";
      const code = firebaseErrorCode(error);
      if (code === 'auth/email-already-in-use') {
        errorMessage = "This email is already registered. Please sign in instead.";
      } else if (code === 'auth/weak-password') {
        errorMessage = "Password must be at least 12 characters long with uppercase and lowercase letters.";
      } else if (code === 'auth/invalid-email') {
        errorMessage = "Please enter a valid email address.";
      }
      return { success: false, error: errorMessage };
    }
  }

  static async signIn(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    if (!auth) {
      Logger.error("Firebase not initialized.");
      return { success: false, error: "Authentication service not available" };
    }
    try {
      await signInWithEmailAndPassword(auth, email, password);
      Logger.debug("User signed in successfully.");
      return { success: true };
    } catch (error: unknown) {
      Logger.error("Error signing in:", error);
      let errorMessage = "Sign in failed";
      const code = firebaseErrorCode(error);
      if (code === 'auth/user-not-found') {
        errorMessage = "No account found with this email. Please sign up first.";
      } else if (code === 'auth/wrong-password') {
        errorMessage = "Incorrect password. Please try again.";
      } else if (code === 'auth/invalid-email') {
        errorMessage = "Please enter a valid email address.";
      } else if (code === 'auth/too-many-requests') {
        errorMessage = "Too many failed attempts. Please try again later.";
      }
      return { success: false, error: errorMessage };
    }
  }

  static async resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    if (!auth) {
      Logger.error("Firebase not initialized.");
      return { success: false, error: "Authentication service not available" };
    }
    try {
      await sendPasswordResetEmail(auth, email);
      Logger.debug("Password reset email sent.");
      return { success: true };
    } catch (error: unknown) {
      Logger.error("Error sending password reset:", error);
      let errorMessage = "Failed to send password reset email";
      const code = firebaseErrorCode(error);
      if (code === 'auth/user-not-found') {
        errorMessage = "No account found with this email address.";
      } else if (code === 'auth/invalid-email') {
        errorMessage = "Please enter a valid email address.";
      }
      return { success: false, error: errorMessage };
    }
  }

  static async signOut(): Promise<void> {
    if (!auth) return;
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      Logger.error("Error signing out", error);
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

  static getUser(): XavuUser | null {
    return this.user;
  }

  /**
   * Get the current Firebase ID token (JWT) for authenticating API calls.
   * Returns null if no user is signed in.
   */
  static async getIdToken(): Promise<string | null> {
    return this.refreshIdToken();
  }

  static async refreshIdToken(forceRefresh = false): Promise<string | null> {
    if (!auth) return null;
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    try {
      const token = await currentUser.getIdToken(forceRefresh);
      await this.syncUserFromFirebase(currentUser, forceRefresh);
      this.notifyListeners();
      return token;
    } catch (error) {
      Logger.error("Failed to refresh ID token:", error);
      return null;
    }
  }

  private static async syncUserFromFirebase(firebaseUser: FirebaseUser, forceRefresh = false): Promise<void> {
    // Use localStorage as a fast cache for initial render, then verify
    // authoritatively via Firebase custom claims from the JWT.
    // The billing webhook sets custom claims (e.g. { pro: true })
    // on the Firebase user after checkout/subscription updates.
    let isPro = localStorage.getItem(`xavu_pro_${firebaseUser.uid}`) === "true";

    try {
      const tokenResult = await firebaseUser.getIdTokenResult(forceRefresh);
      const claims = tokenResult.claims;
      isPro = !!(
        claims.pro ||
        claims.stripeRole === 'pro' ||
        claims.plan === 'pro'
      );
      localStorage.setItem(`xavu_pro_${firebaseUser.uid}`, isPro ? "true" : "false");
    } catch (e) {
      Logger.warn("Failed to fetch token claims, using cached Pro status:", e);
    }

    this.user = {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      isPro
    };
  }
}
