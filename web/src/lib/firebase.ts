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

import appletConfig from '../firebase-applet-config.json';

function resolveConfigVal(envVal: string | undefined, appletVal: string | undefined): string {
  if (
    envVal &&
    envVal.trim() !== '' &&
    !envVal.startsWith('your-') &&
    !envVal.startsWith('demo-') &&
    envVal !== '000000000000' &&
    !envVal.includes('000000000000')
  ) {
    return envVal;
  }
  return appletVal || '';
}

// Firebase config prioritizing live appletConfig over container-injected placeholder env vars.
const firebaseConfig = {
  apiKey: resolveConfigVal(import.meta.env.VITE_FIREBASE_API_KEY, appletConfig.apiKey),
  authDomain: resolveConfigVal(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, appletConfig.authDomain),
  projectId: resolveConfigVal(import.meta.env.VITE_FIREBASE_PROJECT_ID, appletConfig.projectId),
  storageBucket: resolveConfigVal(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, appletConfig.storageBucket),
  messagingSenderId: resolveConfigVal(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, appletConfig.messagingSenderId),
  appId: resolveConfigVal(import.meta.env.VITE_FIREBASE_APP_ID, appletConfig.appId),
};

const databaseId = resolveConfigVal(import.meta.env.VITE_FIREBASE_DATABASE_ID, appletConfig.firestoreDatabaseId);

const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.startsWith('your-') &&
  !firebaseConfig.apiKey.startsWith('demo-')
);

const app: FirebaseApp = initializeApp(firebaseConfig);
const auth: Auth = getAuth(app);
const db: Firestore =
  databaseId && databaseId !== '(default)'
    ? getFirestore(app, databaseId)
    : getFirestore(app);
const functions: Functions = getFunctions(app, 'northamerica-northeast1');

// No Firebase Analytics anywhere in this app (spec §3.4, anti-surveillance).

const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export { app, auth, db, functions, useEmulators, isFirebaseConfigured, databaseId };

