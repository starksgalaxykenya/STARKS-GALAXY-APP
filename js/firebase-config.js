// ============================================
// TaskFlow – Firebase Configuration
// ============================================
// IMPORTANT: Replace the values below with your
// Firebase project credentials from the Firebase Console.
// https://console.firebase.google.com/
// ============================================

export const firebaseConfig = {
  apiKey: "AIzaSyBORBswvSauHGag4Zkp4f_If3Rx9zNiagU",
  authDomain: "carskenyaapp.firebaseapp.com",
  projectId: "carskenyaapp",
  storageBucket: "carskenyaapp.firebasestorage.app",
  messagingSenderId: "80734328",
  appId: "1:80734328:web:2b4fbe06dabb73dad7258d",
  measurementId: "G-8YYTLJVJK7"
};




// ============================================
// Firestore Security Rules (paste in Firebase Console)
// ============================================
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can only read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Tasks: readable and editable by creator or assignee
    match /tasks/{taskId} {
      allow read: if request.auth != null &&
        (resource.data.createdBy == request.auth.uid ||
         resource.data.assignedTo == request.auth.uid ||
         resource.data.assignedTo == request.auth.token.email);
      allow create: if request.auth != null &&
        request.resource.data.createdBy == request.auth.uid;
      allow update: if request.auth != null &&
        (resource.data.createdBy == request.auth.uid ||
         resource.data.assignedTo == request.auth.uid ||
         resource.data.assignedTo == request.auth.token.email);
      allow delete: if request.auth != null &&
        resource.data.createdBy == request.auth.uid;
    }
  }
}
*/
