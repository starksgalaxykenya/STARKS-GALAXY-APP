[Uploading README.md…]()
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

The `projects` collection does not need a composite index (it's queried as a
plain collection scan client-side).

---

## 5b. Companies & Projects Workflow (new)

The app now has real **Company** and **Project** entities, not just free-text labels:

- **Companies** (`companies` collection) are top-level workspaces. Click the
  workspace pill at the top of the sidebar to switch between "All Companies"
  and a specific company — this filters tasks, projects, boards, the
  dashboard, calendar and reports to just that company. Your choice is saved
  in the browser (localStorage) so it persists across reloads.
- **Projects** (`projects` collection) belong to a company and are where
  tasks live. Each project gets its own Kanban board: open **Projects** in
  the sidebar, click a project card ("Open Board"), and you're in a board
  scoped to just that project's tasks — drag-and-drop works exactly like the
  main Kanban board, just filtered down.
- **Tasks** now store `projectId` (which project they belong to) and
  `companyId` (auto-derived from the project, or set directly if the task
  has no project). Old tasks created before this update — which only had a
  free-text `project` field — still display fine; they just won't show up
  when filtering by a specific project until you edit them and assign one.

Admins/managers can see and switch into every company; other roles only see
companies they've been added to (via **User Management → Assign to Company**).

---

## 5c. Sticky Notes on Board Items (new)

Notes can now be attached to a specific task so you can jump between the
board and your notes:

- Open any task → **Sticky Notes** section → **New sticky note** creates a
  note pre-linked to that task, or **Link an existing note** attaches one
  you already wrote (only notes not already linked to another task show up).
- Linked notes appear as small colored preview chips on the task — click one
  to open/edit it, or the × to unlink without deleting it.
- The note itself shows a "Linked to task: …" banner with its own unlink
  button, and the main **Notes** grid shows a small chip on any note that's
  linked, which jumps straight back to that task.
- Kanban cards show a sticky-note count badge so you can see at a glance
  which tasks have notes attached, without opening them.

This all lives on the `notes` collection via a new optional `taskId` field —
no new Firestore rules needed, it's covered by the existing notes rules.

---

## 5d. Finance: Per-Project & Per-Company + Budgets (new)

Finance entries can now be tied to a project (which rolls up into its
company), and both companies and projects can carry a monthly budget:

- The **New Finance Entry** form's Project field is now a dropdown (cascades
  with Company, same as the task form) instead of free text.
- On the **Finance** page, a new **Project** filter sits next to the existing
  **Company** filter — narrow down to a single project's income/expenses, a
  whole company's (including all its projects), or leave both on "All" for
  the org-wide picture.
- A **Budget** card shows this month's spend vs. the budget you set on the
  company or project (edit it from **Companies**/**Projects**, or the "Edit
  budget" link directly on the card) — with a progress bar that goes amber
  at 80% and red once over budget.
- A **Spend Breakdown** chart adapts to your scope: comparing all companies
  when nothing is selected, comparing all of a company's projects once you
  pick a company, or a category breakdown once you drill into one project.

This uses the existing `financeEntries` collection (new optional `projectId`
field) plus a new optional `budget` number field on `companies` and
`projects` — again, no rule changes required.

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

## 8b. PWA — install prompts & offline support (new)

The app is now a properly working installable PWA, not just the manifest
boilerplate it shipped with (the icon paths were pointing at `./ICONS/...`
while the actual folder is `icons/` — on a case-sensitive host like Firebase
Hosting or GitHub Pages that 404s every icon and silently breaks
installability; this is now fixed everywhere).

- **`js/pwa-install.js`** is loaded on every page (login, signup, dashboard)
  and shows a custom bottom banner prompting the user to install — using the
  browser's native `beforeinstallprompt` event on Chrome/Edge/Android. On
  iOS Safari (which doesn't support that event at all) it instead shows
  "Tap Share → Add to Home Screen" instructions. Both banners remember a
  dismissal for 7 days via `localStorage` instead of nagging every visit.
- A manual **Install app** button also lives in the dashboard sidebar
  (next to the theme toggle) for anyone who dismissed the banner earlier or
  is browsing on a device where the prompt doesn't fire automatically.
- **`sw.js`** was rewritten: it precaches the real app-shell files (the old
  version referenced `./CSS/`, `./JS/` and a `signup.js` that doesn't exist,
  so the install step silently failed and nothing was ever cached).
  It now uses network-first for page navigations (so you always get fresh
  content when online, with an offline fallback) and cache-first for
  static assets, plus a proper "update available" banner: when a new
  version is deployed, the next visit shows a **Refresh** prompt instead of
  serving a stale cached version forever.
- **`manifest.json`** got the icon-path fix plus proper `id`, `description`,
  `scope`, `categories`, and two home-screen **shortcuts** (New Task,
  Kanban Board) that deep-link into the dashboard — handled in `js/app.js`.

No Firebase changes are needed for any of this — it's all static-file and
service-worker behavior. After deploying, do a hard refresh once (or clear
the old service worker in DevTools → Application) so the fixed `sw.js`
replaces whatever was cached under the old broken version.

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
| Companies (multi-company workspaces, switchable) | ✅ |
| Projects (linked to companies, own board each) | ✅ |
| Sticky notes linked/attached to tasks | ✅ |
| Per-project & per-company finance + budgets | ✅ |
| Kanban board with drag & drop | ✅ |
| Task CRUD (create, edit, delete) | ✅ |
| Task comments | ✅ |
| File attachments (Firebase Storage) | ✅ |
| Dashboard stats | ✅ |
| Calendar view | ✅ |
| Search | ✅ |
| Filters (priority, project, company) | ✅ |
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
