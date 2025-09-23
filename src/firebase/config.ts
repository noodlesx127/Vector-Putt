// Firebase configuration and initialization
import { initializeApp } from "firebase/app";
import { getDatabase, Database } from "firebase/database";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC2bQ6BpyqSFw4a1lBCgzxb-pfyAAnioLw",
  authDomain: "vector-putt.firebaseapp.com",
  databaseURL: "https://vector-putt-default-rtdb.firebaseio.com/",
  projectId: "vector-putt",
  storageBucket: "vector-putt.firebasestorage.app",
  messagingSenderId: "1013534920899",
  appId: "1:1013534920899:web:3d8e433e251d81c6a6d276",
  measurementId: "G-MX98E2M8EH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and get a reference to the service
export const database: Database = getDatabase(app);

// Initialize Analytics only in browser environment
let analytics = null;
if (typeof window !== 'undefined') {
  try {
    import("firebase/analytics").then(({ getAnalytics }) => {
      analytics = getAnalytics(app);
    }).catch(error => {
      console.warn("Analytics not available:", error);
    });
  } catch (error) {
    console.warn("Analytics not available:", error);
  }
}

export { analytics };
export default app;
