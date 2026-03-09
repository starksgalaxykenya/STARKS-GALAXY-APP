# TaskFlow – Setup & Deployment Guide

## Overview
TaskFlow is a modern task management app built with HTML, CSS, and Vanilla JavaScript using Firebase for backend services.

---

## 1. Firebase Project Setup

### Create a Firebase Project
1. Go to [https://console.firebase.google.com/](https://console.firebase.google.com/)
2. Click **"Add project"** → give it a name (e.g. `taskflow-app`)
3. Disable Google Analytics if not needed → Click **"Create project"**

### Enable Authentication
1. In the Firebase Console, go to **Authentication → Get Started**
2. Click **Sign-in method → Email/Password → Enable** → Save

### Enable Firestore Database
1. Go to **Firestore Database → Create database**
2. Choose **Production mode** (or Start in test mode for development)
3. Select a region close to you → Done

### Enable Storage (for file attachments)
1. Go to **Storage → Get started**
2. Accept default rules → Choose same region → Done

### Get your Firebase Config
1. Go to **Project Settings** (gear icon) → **General**
2. Scroll to **"Your apps"** → Click **"Add app"** → Choose **Web (</>)**
3. Register app with any nickname → Copy the `firebaseConfig` object

---

## 2. Configure the App

Open `js/firebase-config.js` and replace the placeholder values:

```javascript
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",           // Your API Key
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-app",
  storageBucket: "your-app.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

## 3. Set Firestore Security Rules

In the Firebase Console → **Firestore Database → Rules**, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

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
```

---

## 4. Set Storage Rules (for file uploads)

In **Storage → Rules**, paste:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /attachments/{userId}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 5. Create Firestore Index (Required)

To avoid index errors, create a composite index:

1. Go to **Firestore → Indexes → Composite → Add index**
2. Collection: `tasks`
3. Fields: `createdBy ASC`, `createdAt DESC`
4. Query scope: Collection
5. Click **Create**

Alternatively, run the app and click the link in the browser console error — Firebase will create it automatically.

---

## 6. Local Development

Since the app uses ES Modules, you need a local server (not `file://`):

### Option A: VS Code Live Server
- Install the **Live Server** extension
- Right-click `index.html` → **Open with Live Server**

### Option B: Python
```bash
python3 -m http.server 8000
# Open http://localhost:8000
```

### Option C: Node.js
```bash
npx serve .
```

---

## 7. Deploy to Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize in your project folder
firebase init

# Select: Hosting
# Use existing project or create new
# Public directory: . (dot)
# Single-page app: No
# Overwrite index.html: No

# Deploy
firebase deploy
```

Your app will be live at: `https://your-project-id.web.app`

---

## 8. Deploy to GitHub Pages

1. Push your project to a GitHub repository
2. Go to **Repository Settings → Pages**
3. Source: **Deploy from a branch**
4. Branch: `main`, folder: `/ (root)`
5. Click **Save** — your app will be at `https://username.github.io/repo-name/`

> **Note:** Make sure your Firebase project's **Authorized domains** includes your GitHub Pages URL.
> Firebase Console → Authentication → Settings → Authorized domains → Add domain

---

## Project Structure

```
taskflow/
├── index.html           # Redirect to login
├── login.html           # Login page
├── signup.html          # Registration page
├── dashboard.html       # Main app
├── css/
│   ├── style.css        # Global + auth styles
│   └── dashboard.css    # Dashboard layout styles
├── js/
│   ├── firebase-config.js  # ← YOUR CONFIG GOES HERE
│   └── app.js              # All app logic
└── README.md
```

---

## Features Summary

| Feature | Status |
|---|---|
| Email authentication | ✅ |
| Password reset | ✅ |
| Kanban board with drag & drop | ✅ |
| Task CRUD (create, edit, delete) | ✅ |
| Task comments | ✅ |
| File attachments (Firebase Storage) | ✅ |
| Dashboard stats | ✅ |
| Calendar view | ✅ |
| Search | ✅ |
| Filters (priority, project) | ✅ |
| Dark mode | ✅ |
| Notifications (overdue/upcoming) | ✅ |
| Recurring tasks (flag) | ✅ |
| Real-time sync | ✅ |
| Responsive design | ✅ |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + N` | New task |
| `Escape` | Close modal |

---

## Troubleshooting

**"Missing or insufficient permissions"**
→ Check your Firestore security rules and make sure you're logged in.

**"Failed to get document because the client is offline"**
→ Enable offline persistence or check your internet connection.

**Tasks not loading / index errors**
→ Create the composite Firestore index (see Step 5).

**File uploads failing**
→ Check your Storage rules (see Step 4) and make sure Storage is enabled.
