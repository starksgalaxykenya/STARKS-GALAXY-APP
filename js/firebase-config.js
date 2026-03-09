// ============================================================
// Starks Galaxy Limited – Firebase Configuration
// ============================================================
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBORBswvSauHGag4Zkp4f_If3Rx9zNiagU",
  authDomain: "carskenyaapp.firebaseapp.com",
  projectId: "carskenyaapp",
  storageBucket: "carskenyaapp.firebasestorage.app",
  messagingSenderId: "80734328",
  appId: "1:80734328:web:2b4fbe06dabb73dad7258d",
  measurementId: "G-8YYTLJVJK7"
};

// ============================================================
// FIRESTORE SECURITY RULES
// Paste these in Firebase Console → Firestore → Rules
// ============================================================
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuth() { return request.auth != null; }
    function isAdmin() {
      return isAuth() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'manager'];
    }
    function isOwner(uid) { return isAuth() && request.auth.uid == uid; }

    // Users: readable by all authenticated, writable by owner or admin
    match /users/{userId} {
      allow read: if isAuth();
      allow write: if isOwner(userId) || isAdmin();
    }

    // Tasks: owner or assigned users
    match /tasks/{taskId} {
      allow read: if isAuth() && (
        resource.data.createdBy == request.auth.uid ||
        resource.data.assignedTo == request.auth.uid ||
        resource.data.assignedTo == request.auth.token.email
      );
      allow create: if isAuth() && request.resource.data.createdBy == request.auth.uid;
      allow update: if isAuth() && (
        resource.data.createdBy == request.auth.uid || isAdmin()
      );
      allow delete: if isAuth() && (
        resource.data.createdBy == request.auth.uid || isAdmin()
      );
    }

    // Notes: owner only
    match /notes/{noteId} {
      allow read, write: if isAuth() && (
        resource == null || resource.data.createdBy == request.auth.uid || isAdmin()
      );
    }

    // Meetings: owner or admin
    match /meetings/{meetingId} {
      allow read: if isAuth();
      allow write: if isAuth() && (
        resource == null || resource.data.createdBy == request.auth.uid || isAdmin()
      );
    }

    // Time Logs: owner or admin
    match /timeLogs/{logId} {
      allow read: if isAuth() && (
        resource.data.userId == request.auth.uid || isAdmin()
      );
      allow create: if isAuth() && request.resource.data.userId == request.auth.uid;
      allow update, delete: if isAuth() && (
        resource.data.userId == request.auth.uid || isAdmin()
      );
    }

    // Companies: readable by auth, writable by admin
    match /companies/{companyId} {
      allow read: if isAuth();
      allow write: if isAdmin();
    }
  }
}
*/

// ============================================================
// STORAGE RULES
// Paste in Firebase Console → Storage → Rules
// ============================================================
/*
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /attachments/{userId}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
*/

// ============================================================
// REQUIRED FIRESTORE INDEXES
// Create in Firebase Console → Firestore → Indexes → Composite
// ============================================================
// Collection: tasks
//   Fields: createdBy ASC, createdAt DESC
//
// Collection: timeLogs
//   Fields: userId ASC, date DESC
// ============================================================
