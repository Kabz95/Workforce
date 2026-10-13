import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import {
  getFunctions,
  connectFunctionsEmulator,
  type Functions,
} from 'firebase/functions';

// Firebase config from environment. All values are public web identifiers
// (not secrets) — but a real .env is never committed.
const isFirebaseConfigured = Boolean(import.meta.env.VITE_FIREBASE_API_KEY);

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string) || 'demo-workforce-api-key',
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || 'demo-workforce.firebaseapp.com',
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || 'demo-workforce',
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || 'demo-workforce.appspot.com',
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || '000000000000',
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || '1:000000000000:web:000000000000',
};

const app: FirebaseApp = initializeApp(firebaseConfig);
const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);
const functions: Functions = getFunctions(app);

// No Firebase Analytics anywhere in this app (spec §3.4, anti-surveillance).

const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export { app, auth, db, functions, useEmulators, isFirebaseConfigured };

