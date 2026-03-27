// ============================================================
// Starks Galaxy Limited – Main Application
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion, getDocs, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";

// Add this at the beginning of your app.js, after imports
// ============================================================
// PWA Service Worker Registration
// ============================================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('[PWA] ServiceWorker registered successfully with scope:', registration.scope);
        
        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          console.log('[PWA] ServiceWorker update found!');
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New update available, show notification
              showUpdateNotification();
            }
          });
        });
      })
      .catch(error => {
        console.log('[PWA] ServiceWorker registration failed:', error);
      });
    
    // Handle online/offline events
    window.addEventListener('online', () => {
      showToast('Back online! Data will sync automatically.', 'success');
    });
    
    window.addEventListener('offline', () => {
      showToast('You are offline. Some features may be limited.', 'warning');
    });
  });
}

// Add this function to show update notification
function showUpdateNotification() {
  const updateToast = document.createElement('div');
  updateToast.className = 'toast update-toast';
  updateToast.innerHTML = `
    <span>🔄</span>
    New version available! 
    <button onclick="location.reload()" style="background:none;border:none;color:white;text-decoration:underline;margin-left:0.5rem;cursor:pointer">
      Update now
    </button>
  `;
  const container = document.getElementById('toast-container');
  if (container) {
    container.appendChild(updateToast);
    setTimeout(() => {
      updateToast.style.animation = 'toastOut .22s ease forwards';
      setTimeout(() => updateToast.remove(), 220);
    }, 8000);
  }
}

// Optional: Add offline data sync
let syncQueue = [];
let isOnline = navigator.onLine;

async function queueOfflineAction(action, data) {
  syncQueue.push({ action, data, timestamp: Date.now() });
  localStorage.setItem('offline-sync-queue', JSON.stringify(syncQueue));
}

async function processOfflineQueue() {
  if (!navigator.onLine) return;
  
  const queue = JSON.parse(localStorage.getItem('offline-sync-queue') || '[]');
  if (queue.length === 0) return;
  
  for (const item of queue) {
    try {
      // Process queued actions
      if (item.action === 'create-task') {
        await createTask(item.data);
      } else if (item.action === 'update-task') {
        await updateTask(item.data.id, item.data.updates);
      } else if (item.action === 'add-comment') {
        await addComment(item.data.taskId, item.data.text);
      }
    } catch (err) {
      console.error('Failed to sync offline action:', err);
      // Keep in queue if still failing
      continue;
    }
  }
  
  // Clear processed queue
  localStorage.removeItem('offline-sync-queue');
  syncQueue = [];
  showToast('Offline data synced successfully!', 'success');
}

// Listen for online events to sync offline data
window.addEventListener('online', processOfflineQueue);

// Modify your createTask, updateTask, addComment functions to queue offline actions
// For example, modify createTask:
const originalCreateTask = createTask;
window.createTask = async function(data) {
  if (!navigator.onLine) {
    queueOfflineAction('create-task', data);
    showToast('Task saved offline. Will sync when online.', 'info');
    // Add to local state immediately
    const tempTask = { id: 'temp-' + Date.now(), ...data, status: 'pending-sync' };
    allTasks.unshift(tempTask);
    renderTasks();
    return tempTask.id;
  }
  return originalCreateTask(data);
};

// ─── Init ──────────────────────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ─── App State ─────────────────────────────────────────────
let currentUser = null;
let userProfile = null; // full Firestore user doc
let allTasks = [];
let allNotes = [];
let allMeetings = [];
let allTimeLogs = [];
let allUsers = [];
let allCompanies = [];
let currentTaskId = null;
let currentNoteId = null;
let currentMeetingId = null;
let currentCompanyId = null;
let currentView = 'dashboard';
let calendarDate = new Date();
let clockInterval = null;
let clockInTime = null;
const unsubs = [];

const PROJECT_COLORS = ['#2563eb','#8b5cf6','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899','#84cc16'];

// ─── Auth Guard ────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'login.html'; return; }
  currentUser = user;
  await loadUserProfile();
  initApp();
});

async function loadUserProfile() {
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (snap.exists()) {
      userProfile = { id: snap.id, ...snap.data() };
    } else {
      // Create profile if missing (e.g. old user)
      const name = currentUser.displayName || currentUser.email.split('@')[0];
      userProfile = { uid: currentUser.uid, name, email: currentUser.email, role: 'member', companies: [], clockedIn: false };
      await setDoc(doc(db, 'users', currentUser.uid), { ...userProfile, createdAt: serverTimestamp() });
    }
  } catch (e) {
    userProfile = { uid: currentUser.uid, name: currentUser.displayName || 'User', email: currentUser.email, role: 'member', companies: [], clockedIn: false };
  }
}

// ─── App Init ──────────────────────────────────────────────
function initApp() {
  setupUI();
  applyTheme(localStorage.getItem('sg-theme') || 'light');
  bindGlobalEvents();
  subscribeAll();
  startLiveClock();
  updateGreeting();
  document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

function setupUI() {
  const name = userProfile.name || currentUser.displayName || currentUser.email.split('@')[0];
  el('user-name').textContent = name;
  el('user-role').textContent = capitalize(userProfile.role || 'member');
  el('user-avatar').textContent = name.charAt(0).toUpperCase();
  el('comment-avatar').textContent = name.charAt(0).toUpperCase();
  // Role-based UI
  const isAdmin = ['admin','manager'].includes(userProfile.role);
  document.querySelectorAll('.admin-only').forEach(e => e.style.display = isAdmin ? '' : 'none');
  // Clock state
  if (userProfile.clockedIn && userProfile.clockInTime) {
    clockInTime = userProfile.clockInTime.toDate ? userProfile.clockInTime.toDate() : new Date(userProfile.clockInTime);
    setClockUI(true);
  }
}

// ─── Subscriptions ─────────────────────────────────────────
function subscribeAll() {
  subscribeTasks();
  subscribeNotes();
  subscribeMeetings();
  subscribeTimeLogs();
  subscribeUsers();
  subscribeCompanies();
}

function subscribeTasks() {
  const q = query(collection(db, 'tasks'), where('createdBy', '==', currentUser.uid));
  unsubs.push(onSnapshot(q, snap => {
    allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => ts(b) - ts(a));
    renderTasks();
    checkNotifications();
    el('nb-tasks').textContent = allTasks.filter(t => t.status !== 'completed').length;
  }, () => {
    const q2 = query(collection(db, 'tasks'), where('createdBy', '==', currentUser.uid));
    unsubs.push(onSnapshot(q2, snap => {
      allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => ts(b)-ts(a));
      renderTasks(); checkNotifications();
    }));
  }));
}

function subscribeNotes() {
  const q = query(collection(db, 'notes'), where('createdBy', '==', currentUser.uid));
  unsubs.push(onSnapshot(q, snap => {
    allNotes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => ts(b)-ts(a));
    if (currentView === 'notes') renderNotes();
  }));
}

function subscribeMeetings() {
  const q = query(collection(db, 'meetings'), where('createdBy', '==', currentUser.uid));
  unsubs.push(onSnapshot(q, snap => {
    allMeetings = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => {
      return new Date(b.date || 0) - new Date(a.date || 0);
    });
    if (currentView === 'meetings') renderMeetings();
  }));
}

function subscribeTimeLogs() {
  const q = query(collection(db, 'timeLogs'), where('userId', '==', currentUser.uid));
  unsubs.push(onSnapshot(q, snap => {
    allTimeLogs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => ts(b)-ts(a));
    if (currentView === 'timeclock') renderTimeLog();
    updateTodayHours();
  }));
}

function subscribeUsers() {
  const q = query(collection(db, 'users'));
  unsubs.push(onSnapshot(q, snap => {
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (currentView === 'users') renderUsers();
    populateUserFilter();
  }));
}

function subscribeCompanies() {
  const q = query(collection(db, 'companies'));
  unsubs.push(onSnapshot(q, snap => {
    allCompanies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCompanySwitcher();
    if (currentView === 'companies') renderCompanies();
    populateCompanySelects();
  }));
}

// ─── Render Tasks ─────────────────────────────────────────
function renderTasks() {
  const filtered = getFilteredTasks();
  renderStats(filtered);
  renderDashboard(filtered);
  renderKanban(filtered);
  renderAllTasksTable(filtered);
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'reports') renderReports();
  renderProjects();
  populateProjectFilter();
}

function getFilteredTasks() {
  const prio = el('filter-priority')?.value || '';
  const proj = el('filter-project')?.value || '';
  return allTasks.filter(t => {
    if (prio && t.priority !== prio) return false;
    if (proj && t.project !== proj) return false;
    return true;
  });
}

// ─── Stats ──────────────────────────────────────────────
function renderStats(tasks) {
  const now = today();
  el('stat-total').textContent = tasks.length;
  el('stat-done').textContent = tasks.filter(t => t.status === 'completed').length;
  el('stat-progress').textContent = tasks.filter(t => t.status === 'inprogress').length;
  el('stat-overdue').textContent = tasks.filter(t => t.dueDate && t.status !== 'completed' && new Date(t.dueDate) < now).length;
  // reports page
  el('rep-total-tasks').textContent = tasks.length;
  const done = tasks.filter(t => t.status === 'completed').length;
  el('rep-completion-rate').textContent = tasks.length ? Math.round(done/tasks.length*100)+'%' : '0%';
}

// ─── Dashboard ────────────────────────────────────────────
function renderDashboard(tasks) {
  const recentEl = el('recent-tasks');
  const recent = tasks.slice(0, 8);
  recentEl.innerHTML = recent.length ? recent.map(t => `
    <div class="recent-task-row" data-id="${t.id}">
      <button class="task-check-btn ${t.status==='completed'?'done':''}" data-id="${t.id}" onclick="event.stopPropagation();toggleTaskDone('${t.id}')"></button>
      <span class="task-row-title ${t.status==='completed'?'done-text':''}">${esc(t.title)}</span>
      <span class="priority-badge ${t.priority||'low'}">${t.priority||'low'}</span>
    </div>`).join('') : '<div class="empty-state">No tasks yet — create your first task!</div>';
  recentEl.querySelectorAll('.recent-task-row').forEach(row => row.addEventListener('click', () => openTask(row.dataset.id)));

  const upcomingEl = el('upcoming-list');
  const now = today();
  const upcoming = tasks.filter(t => t.dueDate && t.status !== 'completed')
    .map(t => ({ ...t, d: new Date(t.dueDate) }))
    .sort((a,b) => a.d - b.d).slice(0,8);
  upcomingEl.innerHTML = upcoming.length ? upcoming.map(t => {
    const diff = Math.ceil((t.d - now) / 86400000);
    let cls='soon', lbl=`In ${diff}d`;
    if (diff<0){cls='overdue';lbl=`${Math.abs(diff)}d overdue`;}
    else if (diff===0){cls='today';lbl='Due today';}
    else if (diff===1){cls='today';lbl='Tomorrow';}
    return `<div class="upcoming-item" data-id="${t.id}">
      <span class="due-chip ${cls}">${lbl}</span>
      <span style="flex:1;font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</span>
      <span class="priority-badge ${t.priority||'low'}" style="font-size:.65rem">${t.priority||'low'}</span>
    </div>`;
  }).join('') : '<div class="empty-state">No upcoming deadlines.</div>';
  upcomingEl.querySelectorAll('.upcoming-item').forEach(r => r.addEventListener('click', () => openTask(r.dataset.id)));
}

window.toggleTaskDone = async (id) => {
  const t = allTasks.find(t => t.id === id);
  if (t) await updateTask(id, { status: t.status === 'completed' ? 'todo' : 'completed' });
};

// ─── Kanban ───────────────────────────────────────────────
function renderKanban(tasks) {
  const kpf = el('kanban-project-filter')?.value || '';
  const filtered = kpf ? tasks.filter(t => t.project === kpf) : tasks;
  ['todo','inprogress','review','completed'].forEach(status => {
    const col = el(`col-${status}`);
    const colTasks = filtered.filter(t => t.status === status);
    el(`count-${status}`).textContent = colTasks.length;
    col.innerHTML = colTasks.map(t => buildCard(t)).join('');
    col.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', () => openTask(card.dataset.id));
      initDrag(card);
    });
    initDrop(col);
  });
  el('kanban-subtitle').textContent = kpf ? `Project: ${kpf}` : `All Projects · ${filtered.length} tasks`;
}

function buildCard(t) {
  const now = today();
  let dueLabel='', dueCls='';
  if (t.dueDate) {
    const diff = Math.ceil((new Date(t.dueDate) - now) / 86400000);
    if (diff<0){dueLabel=`Overdue ${Math.abs(diff)}d`;dueCls='overdue';}
    else if (diff===0){dueLabel='Due today';dueCls='today';}
    else if (diff===1){dueLabel='Tomorrow';dueCls='today';}
    else {dueLabel=`Due ${new Date(t.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;}
  }
  const cc = (t.comments||[]).length;
  return `<div class="task-card" data-id="${t.id}" draggable="true">
    <div class="card-top">
      <span class="card-title-text ${t.status==='completed'?'done-text':''}">${esc(t.title)}</span>
      <div class="priority-dot ${t.priority||'low'}"></div>
    </div>
    ${t.description?`<p class="card-desc">${esc(t.description)}</p>`:''}
    <div class="card-footer">
      ${dueLabel?`<span class="card-due ${dueCls}">${dueSvg}${dueLabel}</span>`:'<span></span>'}
      <div class="card-meta">
        ${t.project?`<span class="card-project">${esc(t.project)}</span>`:''}
        ${cc?`<span class="card-comments">${commentSvg} ${cc}</span>`:''}
      </div>
    </div>
  </div>`;
}
const dueSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const commentSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

// Drag & Drop
let dragId = null;
function initDrag(card) {
  card.addEventListener('dragstart', e => { dragId=card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); document.querySelectorAll('.col-cards').forEach(c => c.classList.remove('drag-over')); });
}
function initDrop(col) {
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', async e => {
    e.preventDefault(); col.classList.remove('drag-over');
    if (!dragId) return;
    const newStatus = col.dataset.status;
    const task = allTasks.find(t => t.id === dragId);
    if (task && task.status !== newStatus) await updateTask(dragId, { status: newStatus });
    dragId = null;
  });
}

// ─── All Tasks Table ─────────────────────────────────────
function renderAllTasksTable(tasks) {
  const listEl = el('all-tasks-list');
  if (!tasks.length) { listEl.innerHTML = '<div class="empty-state" style="padding:3rem">No tasks. Create your first task!</div>'; return; }
  listEl.innerHTML = tasks.map(t => {
    const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
    return `<div class="task-table-row" data-id="${t.id}">
      <button class="task-check-btn ${t.status==='completed'?'done':''}" onclick="event.stopPropagation();toggleTaskDone('${t.id}')"></button>
      <div style="overflow:hidden"><div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${t.status==='completed'?'text-decoration:line-through;color:var(--text-light)':''}">${esc(t.title)}</div><div style="font-size:.75rem;color:var(--text-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.project?`📁 ${esc(t.project)}`:''}</div></div>
      <div><span class="priority-badge ${t.priority||'low'}">${t.priority||'low'}</span></div>
      <div><span class="status-badge ${t.status||'todo'}">${statusLabel(t.status)}</span></div>
      <div style="color:var(--text-muted);font-size:.8125rem">${due}</div>
      <div>${t.project?`<span class="project-tag">${esc(t.project)}</span>`:''}</div>
      <div><button class="icon-btn icon-btn-danger" onclick="event.stopPropagation();confirmDelete('${t.id}')" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button></div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.task-table-row').forEach(row => row.addEventListener('click', () => openTask(row.dataset.id)));
}
window.confirmDelete = async (id) => {
  if (confirm('Delete this task? Cannot be undone.')) await deleteTask(id);
};

// ─── Calendar ────────────────────────────────────────────
function renderCalendar() {
  const g = el('calendar-grid');
  const y = calendarDate.getFullYear(), m = calendarDate.getMonth();
  el('cal-month-label').textContent = new Date(y,m,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const firstDay = new Date(y,m,1).getDay();
  const daysInMonth = new Date(y,m+1,0).getDate();
  const daysInPrev = new Date(y,m,0).getDate();
  const td = new Date();
  const byDate = {};
  [...allTasks, ...allMeetings.map(m2 => ({...m2, _isMeeting: true, dueDate: m2.date}))].forEach(item => {
    const key = item.dueDate || item.date;
    if (key) { byDate[key] = byDate[key] || []; byDate[key].push(item); }
  });
  let html = '<div class="cal-weekdays">' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="cal-weekday">${d}</div>`).join('') + '</div><div class="cal-days">';
  for (let i=firstDay-1; i>=0; i--) html += `<div class="cal-day other-month"><div class="cal-day-num">${daysInPrev-i}</div></div>`;
  for (let d=1; d<=daysInMonth; d++) {
    const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = td.getFullYear()===y && td.getMonth()===m && td.getDate()===d;
    const items = byDate[ds] || [];
    html += `<div class="cal-day${isToday?' today':''}">
      <div class="cal-day-num">${d}</div>
      ${items.slice(0,3).map(item => {
        const isMtg = item._isMeeting;
        const [bg,fg] = isMtg ? ['#f3e8ff','#7c3aed'] : item.priority==='high' ? ['#fee2e2','#b91c1c'] : item.priority==='medium' ? ['#fef3c7','#b45309'] : ['#dcfce7','#166534'];
        return `<div class="cal-task-dot" style="background:${bg};color:${fg}" data-id="${item.id}" data-type="${isMtg?'meeting':'task'}" title="${esc(item.title)}">${isMtg?'📅 ':''} ${esc(item.title)}</div>`;
      }).join('')}
      ${items.length>3?`<div style="font-size:.65rem;color:var(--text-light);padding:0 .25rem">+${items.length-3} more</div>`:''}
    </div>`;
  }
  const total = firstDay + daysInMonth;
  const rem = (7-(total%7))%7;
  for (let d=1; d<=rem; d++) html += `<div class="cal-day other-month"><div class="cal-day-num">${d}</div></div>`;
  html += '</div>';
  g.innerHTML = html;
  g.querySelectorAll('.cal-task-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      if (dot.dataset.type === 'meeting') openMeeting(dot.dataset.id);
      else openTask(dot.dataset.id);
    });
  });
}

// ─── Projects Sidebar ────────────────────────────────────
function renderProjects() {
  const projects = [...new Set(allTasks.map(t => t.project).filter(Boolean))];
  el('project-list').innerHTML = projects.map((p,i) =>
    `<div class="project-item" data-project="${esc(p)}">
      <div class="project-dot" style="background:${PROJECT_COLORS[i%PROJECT_COLORS.length]}"></div>
      <span>${esc(p)}</span>
    </div>`).join('');
  el('project-list').querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => {
      el('filter-project').value = item.dataset.project;
      renderTasks();
      if (window.innerWidth <= 768) closeSidebar();
    });
  });
}

function populateProjectFilter() {
  const projects = [...new Set(allTasks.map(t => t.project).filter(Boolean))];
  const selects = [el('filter-project'), el('kanban-project-filter')];
  selects.forEach(sel => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Projects</option>' + projects.map(p => `<option value="${esc(p)}" ${cur===p?'selected':''}>${esc(p)}</option>`).join('');
  });
}

// ─── Companies ───────────────────────────────────────────
function renderCompanies() {
  const g = el('companies-grid');
  if (!allCompanies.length) { g.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:3rem">No companies yet. Add your first company!</div>'; return; }
  g.innerHTML = allCompanies.map(c => {
    const memberCount = allUsers.filter(u => u.companies?.includes(c.id)).length;
    const taskCount = allTasks.filter(t => t.companyId === c.id).length;
    return `<div class="company-card" data-id="${c.id}">
      <div class="company-card-header">
        <div class="company-logo" style="background:${c.color||'#2563eb'}">${(c.name||'?').charAt(0).toUpperCase()}</div>
        <div class="company-info">
          <div class="company-card-name">${esc(c.name)}</div>
          <div class="company-card-industry">${esc(c.industry||'')}</div>
          ${c.website?`<a href="${esc(c.website)}" target="_blank" class="text-link" style="font-size:.75rem" onclick="event.stopPropagation()">${esc(c.website.replace('https://',''))}</a>`:''}
        </div>
      </div>
      <div class="company-stats-row">
        <div class="company-stat"><span class="company-stat-val">${memberCount}</span><span class="company-stat-key">Members</span></div>
        <div class="company-stat"><span class="company-stat-val">${taskCount}</span><span class="company-stat-key">Tasks</span></div>
      </div>
      ${c.description?`<p style="font-size:.8125rem;color:var(--text-muted);margin-top:.75rem;line-height:1.5">${esc(c.description)}</p>`:''}
      <div style="display:flex;gap:.5rem;margin-top:1rem">
        <button class="btn-ghost" style="font-size:.8rem;padding:.4rem .75rem" onclick="event.stopPropagation();openCompanyModal('${c.id}')">Edit</button>
        <button class="btn-danger" style="font-size:.8rem;padding:.4rem .75rem" onclick="event.stopPropagation();deleteCompany('${c.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function renderCompanySwitcher() {
  const myCompanies = allCompanies.filter(c => (userProfile?.companies||[]).includes(c.id) || ['admin','manager'].includes(userProfile?.role));
  if (!myCompanies.length) { el('co-name').textContent = 'No Company'; return; }
  const active = allCompanies[0];
  if (active) { el('co-name').textContent = active.name; el('co-dot').style.background = active.color || '#22c55e'; }
}

function populateCompanySelects() {
  const opts = '<option value="">No company</option>' + allCompanies.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  [el('f-company'), el('invite-company')].forEach(sel => { if (sel) sel.innerHTML = opts; });
}

window.deleteCompany = async (id) => {
  if (!confirm('Delete this company?')) return;
  try { await deleteDoc(doc(db, 'companies', id)); showToast('Company deleted.', 'warning'); } catch { showToast('Failed.', 'error'); }
};

// ─── Users ───────────────────────────────────────────────
function renderUsers() {
  const ul = el('users-list');
  if (!allUsers.length) { ul.innerHTML = '<div class="empty-state" style="padding:2rem">No users found.</div>'; return; }
  ul.innerHTML = allUsers.map(u => {
    const co = allCompanies.find(c => (u.companies||[]).includes(c.id));
    const joined = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString('en-US',{month:'short',year:'numeric'}) : '—';
    return `<div class="user-row" data-uid="${u.id}">
      <div><div class="avatar sm">${(u.name||u.email||'U').charAt(0).toUpperCase()}</div></div>
      <div class="user-name-cell"><div><div class="name">${esc(u.name||'—')}</div><div class="email">${esc(u.email||'')}</div></div></div>
      <div>${co?`<span class="project-tag">${esc(co.name)}</span>`:'<span style="color:var(--text-light);font-size:.8rem">—</span>'}</div>
      <div><span class="role-badge ${u.role||'member'}">${u.role||'member'}</span></div>
      <div><span class="status-badge ${u.clockedIn?'inprogress':'todo'}">${u.clockedIn?'Clocked In':'Offline'}</span></div>
      <div style="font-size:.8rem;color:var(--text-muted)">${joined}</div>
      <div><button class="icon-btn" onclick="openUserEdit('${u.id}')" title="Edit user"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></div>
    </div>`;
  }).join('');
}

function populateUserFilter() {
  const sel = el('time-filter-user');
  if (!sel) return;
  sel.innerHTML = '<option value="">All Users</option>' + allUsers.map(u => `<option value="${u.id}">${esc(u.name||u.email)}</option>`).join('');
}

window.openUserEdit = (uid) => {
  const u = allUsers.find(u => u.id === uid);
  if (!u) return;
  el('invite-uid').value = u.id;
  el('invite-name').value = u.name || '';
  el('invite-role').value = u.role || 'member';
  el('invite-company').value = (u.companies||[])[0] || '';
  showModal('invite-modal-overlay');
};

// ─── Notes ───────────────────────────────────────────────
function renderNotes() {
  const filter = el('notes-filter')?.value || 'all';
  const notes = filter === 'all' ? allNotes : allNotes.filter(n => n.category === filter || (filter==='shared' && n.category==='shared') || (filter==='personal' && n.category==='personal'));
  const g = el('notes-grid');
  if (!notes.length) { g.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:3rem">No notes yet. Create your first note!</div>'; return; }
  g.innerHTML = notes.map(n => {
    const preview = n.content ? n.content.replace(/<[^>]+>/g,'').substring(0,160) : '';
    const date = n.updatedAt?.toDate ? n.updatedAt.toDate().toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—';
    return `<div class="note-card" data-id="${n.id}">
      <div class="note-card-color" style="background:${n.color||'#2563eb'}"></div>
      <div class="note-card-title">${esc(n.title||'Untitled')}</div>
      <div class="note-card-preview">${preview || 'No content'}</div>
      <div class="note-card-meta">
        <span>${n.category||'general'}</span>·<span>${date}</span>
      </div>
    </div>`;
  }).join('');
  el('notes-grid').querySelectorAll('.note-card').forEach(c => c.addEventListener('click', () => openNoteModal(c.dataset.id)));
}

// ─── Meetings ────────────────────────────────────────────
function renderMeetings() {
  const ml = el('meetings-list');
  if (!allMeetings.length) { ml.innerHTML = '<div class="empty-state" style="padding:3rem">No meetings yet. Schedule your first meeting!</div>'; return; }
  ml.innerHTML = allMeetings.map(m2 => {
    const d = m2.date ? new Date(m2.date) : null;
    const day = d ? d.getDate() : '?';
    const mon = d ? d.toLocaleDateString('en-US',{month:'short'}) : '';
    const attendees = (m2.attendees || '').split(',').filter(Boolean).slice(0,4);
    return `<div class="meeting-card" data-id="${m2.id}">
      <div class="meeting-date-box">
        <div class="meeting-date-day">${day}</div>
        <div class="meeting-date-mon">${mon}</div>
      </div>
      <div class="meeting-info">
        <div class="meeting-title">${esc(m2.title)}</div>
        <div class="meeting-time">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${m2.time||''} ${m2.duration?`· ${m2.duration} min`:''}
          ${m2.location?`· 📍 ${esc(m2.location)}`:''}
        </div>
        ${attendees.length?`<div class="meeting-attendees">${attendees.map(a=>`<div class="meeting-attendee-avatar" title="${esc(a.trim())}">${a.trim().charAt(0).toUpperCase()}</div>`).join('')}</div>`:''}
      </div>
    </div>`;
  }).join('');
  el('meetings-list').querySelectorAll('.meeting-card').forEach(c => c.addEventListener('click', () => openMeeting(c.dataset.id)));
}

// ─── Time Clock ──────────────────────────────────────────
function startLiveClock() {
  clearInterval(clockInterval);
  clockInterval = setInterval(() => {
    el('live-clock').textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
  }, 1000);
  el('live-clock').textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}

function setClockUI(in_) {
  const inBtn = el('clock-in-btn'), outBtn = el('clock-out-btn');
  const statusLabel = el('clock-status-label');
  const topbarStatus = el('clock-status-topbar');
  inBtn.disabled = in_;
  outBtn.disabled = !in_;
  if (in_) {
    statusLabel.className = 'clock-status-dot';
    statusLabel.textContent = 'Clocked In';
    topbarStatus.className = 'clock-status-dot';
    topbarStatus.textContent = 'Clocked In';
  } else {
    statusLabel.className = 'clock-status-dot clocked-out';
    statusLabel.textContent = 'Not clocked in';
    topbarStatus.className = 'clock-status-dot clocked-out';
    topbarStatus.textContent = 'Not clocked in';
  }
}

async function clockIn() {
  if (el('clock-in-btn').disabled) return;
  clockInTime = new Date();
  setClockUI(true);
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { clockedIn: true, clockInTime: clockInTime });
    userProfile.clockedIn = true;
    userProfile.clockInTime = clockInTime;
    showToast(`Clocked in at ${clockInTime.toLocaleTimeString()}`, 'success');
  } catch (e) { showToast('Clock in failed.', 'error'); }
}

async function clockOut() {
  if (!clockInTime) return;
  const clockOutTime = new Date();
  const durationMs = clockOutTime - clockInTime;
  const durationMin = Math.round(durationMs / 60000);
  const date = clockInTime.toISOString().split('T')[0];
  setClockUI(false);
  try {
    await addDoc(collection(db, 'timeLogs'), {
      userId: currentUser.uid,
      userName: userProfile.name || currentUser.displayName || currentUser.email,
      date,
      clockIn: clockInTime.toISOString(),
      clockOut: clockOutTime.toISOString(),
      durationMin,
      notes: '',
      companyId: ''
    });
    await updateDoc(doc(db, 'users', currentUser.uid), { clockedIn: false, clockInTime: null });
    userProfile.clockedIn = false;
    clockInTime = null;
    showToast(`Clocked out. Duration: ${formatDuration(durationMin)}`, 'success');
  } catch (e) { showToast('Clock out failed.', 'error'); }
}

function renderTimeLog() {
  const filterDate = el('time-filter-date')?.value || '';
  const filterUser = el('time-filter-user')?.value || '';
  let logs = [...allTimeLogs];
  if (filterDate) logs = logs.filter(l => l.date === filterDate);
  if (filterUser) logs = logs.filter(l => l.userId === filterUser);
  const listEl = el('time-log-list');
  if (!logs.length) { listEl.innerHTML = '<div class="empty-state" style="padding:2rem">No time logs found.</div>'; return; }
  listEl.innerHTML = logs.slice(0,50).map(l => `
    <div class="time-row">
      <div>${esc(l.userName||'—')}</div>
      <div style="color:var(--text-muted)">${l.date||'—'}</div>
      <div style="color:var(--text-muted)">${l.clockIn?new Date(l.clockIn).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}):'—'}</div>
      <div style="color:var(--text-muted)">${l.clockOut?new Date(l.clockOut).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}):'—'}</div>
      <div class="time-duration">${formatDuration(l.durationMin||0)}</div>
      <div style="font-size:.8rem;color:var(--text-muted)">${esc(l.notes||'')}</div>
    </div>`).join('');
}

function updateTodayHours() {
  const today2 = new Date().toISOString().split('T')[0];
  const todayLogs = allTimeLogs.filter(l => l.date === today2 && l.userId === currentUser.uid);
  const totalMin = todayLogs.reduce((a,l) => a+(l.durationMin||0), 0);
  el('today-hours').textContent = formatDuration(totalMin);
  el('today-sessions').textContent = todayLogs.length;
  el('hours-progress').style.width = Math.min(100, totalMin/480*100) + '%';
  const days = new Set(allTimeLogs.filter(l => l.userId === currentUser.uid && isThisWeek(l.date)).map(l => l.date));
  const weekMin = allTimeLogs.filter(l => l.userId === currentUser.uid && isThisWeek(l.date)).reduce((a,l)=>a+(l.durationMin||0),0);
  el('week-hours').textContent = formatDuration(weekMin);
  el('week-days').textContent = days.size;
  el('rep-total-hours').textContent = formatDuration(allTimeLogs.filter(l=>l.userId===currentUser.uid).reduce((a,l)=>a+(l.durationMin||0),0));
}

// ─── Reports ─────────────────────────────────────────────
function renderReports() {
  renderBarChart('report-priority-chart', [
    { label:'High', value: allTasks.filter(t=>t.priority==='high').length, color:'#ef4444' },
    { label:'Medium', value: allTasks.filter(t=>t.priority==='medium').length, color:'#f59e0b' },
    { label:'Low', value: allTasks.filter(t=>t.priority==='low').length, color:'#22c55e' },
  ]);
  const byProject = {};
  allTasks.forEach(t => { if (t.project) { byProject[t.project] = (byProject[t.project]||0) + 1; } });
  renderBarChart('report-project-chart', Object.entries(byProject).map(([label,value],i) => ({label, value, color: PROJECT_COLORS[i%PROJECT_COLORS.length]})));
}

function renderBarChart(containerId, data) {
  const el2 = el(containerId);
  if (!data.length) { el2.innerHTML = '<div class="empty-state">No data yet.</div>'; return; }
  const max = Math.max(...data.map(d=>d.value), 1);
  el2.innerHTML = data.map(d => `
    <div style="margin-bottom:.875rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.375rem">
        <span style="font-size:.875rem;font-weight:500;color:var(--text)">${esc(d.label)}</span>
        <span style="font-size:.875rem;font-weight:700;color:var(--text)">${d.value}</span>
      </div>
      <div class="progress-bar-wrap md"><div class="progress-bar-fill" style="background:${d.color};width:${d.value/max*100}%"></div></div>
    </div>`).join('');
}

// ─── Notifications ────────────────────────────────────────
function checkNotifications() {
  const now = today();
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate()+1);
  const notifs = [];
  allTasks.forEach(t => {
    if (!t.dueDate || t.status==='completed') return;
    const due = new Date(t.dueDate);
    if (due < now) notifs.push({ color:'#ef4444', icon:'⚠️', title: t.title, msg:'Overdue', id: t.id });
    else if (due.toDateString()===now.toDateString()) notifs.push({ color:'#f59e0b', icon:'📅', title: t.title, msg:'Due today', id: t.id });
    else if (due.toDateString()===tomorrow.toDateString()) notifs.push({ color:'#3b82f6', icon:'🔔', title: t.title, msg:'Due tomorrow', id: t.id });
  });
  el('notif-badge').textContent = notifs.length;
  el('notif-badge').classList.toggle('hidden', notifs.length === 0);
  el('notif-list').innerHTML = notifs.length ? notifs.map(n => `
    <div class="notif-item" data-id="${n.id}">
      <div class="notif-dot" style="background:${n.color}"></div>
      <div><div style="font-weight:600;font-size:.8125rem;color:var(--text)">${esc(n.title)}</div><div>${n.icon} ${n.msg}</div></div>
    </div>`).join('') : '<div class="notif-item">All caught up! 🎉</div>';
  el('notif-list').querySelectorAll('[data-id]').forEach(row => {
    row.addEventListener('click', () => { openTask(row.dataset.id); hideModal('notif-dropdown'); });
  });
}

// ─── Task Modal ──────────────────────────────────────────
function openTask(id, defaultStatus='todo') {
  const task = allTasks.find(t => t.id === id);
  currentTaskId = id || null;
  showModal('task-modal-overlay');
  if (task) {
    el('modal-title').textContent = task.title;
    el('view-priority').className = `priority-badge ${task.priority||'low'}`;
    el('view-priority').textContent = task.priority||'low';
    el('view-status').className = `status-badge ${task.status||'todo'}`;
    el('view-status').textContent = statusLabel(task.status);
    const proj = el('view-project');
    if (task.project) { proj.textContent = task.project; proj.style.display=''; } else proj.style.display='none';
    el('view-desc').textContent = task.description || 'No description provided.';
    el('view-due').textContent = task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric',year:'numeric'}) : 'No due date';
    el('view-assigned').textContent = task.assignedTo || 'Unassigned';
    const co = allCompanies.find(c => c.id === task.companyId);
    el('view-company').textContent = co ? co.name : 'No company';
    renderAttachments(task);
    renderComments(task);
    renderActivityLog(task);
    showView_modal(false);
    el('modal-edit-btn').style.display='flex';
    el('modal-delete-btn').style.display='flex';
  } else {
    el('modal-title').textContent = 'New Task';
    resetTaskForm();
    el('f-status').value = defaultStatus;
    showView_modal(true);
    el('modal-edit-btn').style.display='none';
    el('modal-delete-btn').style.display='none';
  }
}

function showView_modal(editMode) {
  el('modal-view').style.display = editMode ? 'none' : 'block';
  el('modal-edit').classList.toggle('hidden', !editMode);
}

function populateEditForm(task) {
  el('task-id').value = task.id;
  el('f-title').value = task.title||'';
  el('f-desc').value = task.description||'';
  el('f-priority').value = task.priority||'medium';
  el('f-status').value = task.status||'todo';
  el('f-due').value = task.dueDate||'';
  el('f-project').value = task.project||'';
  el('f-assigned').value = task.assignedTo||'';
  el('f-company').value = task.companyId||'';
  el('f-recurring').checked = !!task.recurring;
}

function resetTaskForm() {
  el('task-form').reset();
  el('task-id').value='';
}

function renderAttachments(task) {
  const list = task.attachments||[];
  el('view-attachments').innerHTML = list.length ? list.map(a => `
    <a href="${a.url}" target="_blank" class="attachment-chip">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      ${esc(a.name)}
    </a>`).join('') : '<span style="font-size:.8125rem;color:var(--text-light)">No attachments yet.</span>';
}

function renderComments(task) {
  const comments = task.comments||[];
  el('comment-count').textContent = `(${comments.length})`;
  el('comments-list').innerHTML = comments.length ? comments.map(c => `
    <div class="comment-item">
      <div class="avatar sm">${(c.userName||'U').charAt(0).toUpperCase()}</div>
      <div class="comment-body">
        <div class="comment-meta"><strong>${esc(c.userName||'User')}</strong> · ${formatTime(c.createdAt)}</div>
        <div class="comment-text">${esc(c.text)}</div>
      </div>
    </div>`).join('') : '<div style="font-size:.8125rem;color:var(--text-light);padding:.5rem 0">No comments yet.</div>';
}

function renderActivityLog(task) {
  const log = task.activityLog||[];
  el('activity-list').innerHTML = log.slice(-10).reverse().map(entry => `
    <div class="activity-item">
      <div class="activity-icon" style="background:var(--primary-light);color:var(--primary)">⚡</div>
      <div class="activity-content">
        <div class="activity-text">${esc(entry)}</div>
      </div>
    </div>`).join('') || '<div style="color:var(--text-light);font-size:.8125rem">No activity yet.</div>';
}

// ─── Note Modal ──────────────────────────────────────────
function openNoteModal(id) {
  currentNoteId = id || null;
  const note = id ? allNotes.find(n => n.id === id) : null;
  el('note-modal-title').textContent = note ? 'Edit Note' : 'New Note';
  el('note-id').value = note?.id || '';
  el('note-title').value = note?.title || '';
  el('note-category').value = note?.category || 'general';
  el('note-color').value = note?.color || '#2563eb';
  el('note-content').innerHTML = note?.content || '';
  el('delete-note-btn').style.display = note ? 'flex' : 'none';
  showModal('note-modal-overlay');
}

// ─── Meeting Modal ───────────────────────────────────────
function openMeeting(id) {
  currentMeetingId = id || null;
  const m2 = id ? allMeetings.find(m3 => m3.id === id) : null;
  el('meeting-modal-title').textContent = m2 ? 'Edit Meeting' : 'New Meeting';
  el('meeting-id').value = m2?.id || '';
  el('meeting-title').value = m2?.title || '';
  el('meeting-date').value = m2?.date || '';
  el('meeting-time').value = m2?.time || '';
  el('meeting-duration').value = m2?.duration || '60';
  el('meeting-location').value = m2?.location || '';
  el('meeting-attendees').value = m2?.attendees || '';
  el('meeting-agenda').value = m2?.agenda || '';
  el('meeting-minutes').innerHTML = m2?.minutes || '';
  el('meeting-actions').value = m2?.actionItems || '';
  el('delete-meeting-btn').style.display = m2 ? 'flex' : 'none';
  showModal('meeting-modal-overlay');
}

// ─── Company Modal ───────────────────────────────────────
function openCompanyModal(id) {
  currentCompanyId = id || null;
  const co = id ? allCompanies.find(c => c.id === id) : null;
  el('company-modal-title').textContent = co ? 'Edit Company' : 'Add Company';
  el('company-id').value = co?.id || '';
  el('co-name-input').value = co?.name || '';
  el('co-industry').value = co?.industry || '';
  el('co-website').value = co?.website || '';
  el('co-desc').value = co?.description || '';
  el('co-color').value = co?.color || '#2563eb';
  showModal('company-modal-overlay');
}

// ─── Firebase CRUD ────────────────────────────────────────
async function createTask(data) {
  try {
    const ref = await addDoc(collection(db,'tasks'), { ...data, createdBy: currentUser.uid, createdAt: serverTimestamp(), comments:[], attachments:[], activityLog:[`Created by ${userProfile.name||currentUser.email}`] });
    showToast('Task created!','success'); return ref.id;
  } catch { showToast('Failed to create task.','error'); throw new Error(); }
}

async function updateTask(id, data) {
  try {
    const log = `Updated: ${Object.keys(data).join(', ')} by ${userProfile.name||currentUser.email}`;
    await updateDoc(doc(db,'tasks',id), { ...data, updatedAt: serverTimestamp(), activityLog: arrayUnion(log) });
  } catch { showToast('Update failed.','error'); }
}

async function deleteTask(id) {
  try { await deleteDoc(doc(db,'tasks',id)); showToast('Task deleted.','warning'); } catch { showToast('Delete failed.','error'); }
}

async function addComment(taskId, text) {
  const comment = { id: Date.now().toString(), text, userName: userProfile.name||currentUser.email.split('@')[0], userEmail: currentUser.email, createdAt: new Date().toISOString() };
  try { await updateDoc(doc(db,'tasks',taskId), { comments: arrayUnion(comment), updatedAt: serverTimestamp() }); return comment; }
  catch { showToast('Comment failed.','error'); }
}

async function uploadAttachment(taskId, file) {
  try {
    const path = `attachments/${currentUser.uid}/${taskId}/${Date.now()}_${file.name}`;
    await uploadBytes(sRef(storage, path), file);
    const url = await getDownloadURL(sRef(storage, path));
    const att = { name: file.name, url, size: file.size, type: file.type };
    await updateDoc(doc(db,'tasks',taskId), { attachments: arrayUnion(att), updatedAt: serverTimestamp() });
    showToast(`${file.name} uploaded!`,'success');
    return att;
  } catch { showToast('Upload failed. Check Storage rules.','error'); }
}

// ─── Event Bindings ──────────────────────────────────────
function bindGlobalEvents() {
  // Nav
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      switchView(item.dataset.view);
      if (window.innerWidth<=768) closeSidebar();
    });
  });

  // New task buttons
  [el('new-task-btn'), el('new-task-btn2')].forEach(btn => { if (btn) btn.addEventListener('click', () => openTask(null)); });

  // Add card buttons
  document.querySelectorAll('.add-card-btn').forEach(btn => btn.addEventListener('click', () => openTask(null, btn.dataset.status)));

  // Modal close
  el('modal-close-btn').addEventListener('click', () => hideModal('task-modal-overlay'));
  el('task-modal-overlay').addEventListener('click', e => { if (e.target === el('task-modal-overlay')) hideModal('task-modal-overlay'); });

  // Edit/Delete task
  el('modal-edit-btn').addEventListener('click', () => {
    const task = allTasks.find(t => t.id === currentTaskId);
    if (task) { populateEditForm(task); showView_modal(true); }
  });
  el('modal-delete-btn').addEventListener('click', async () => {
    if (!currentTaskId || !confirm('Delete this task?')) return;
    await deleteTask(currentTaskId);
    hideModal('task-modal-overlay');
  });
  el('cancel-edit-btn').addEventListener('click', () => {
    if (currentTaskId) showView_modal(false); else hideModal('task-modal-overlay');
  });

  // Save task
  el('save-task-btn').addEventListener('click', async () => {
    const title = el('f-title').value.trim();
    if (!title) { showToast('Title is required.','error'); return; }
    const saveBtn = el('save-task-btn');
    saveBtn.disabled = true;
    saveBtn.querySelector('.btn-loader').classList.remove('hidden');
    saveBtn.querySelector('.btn-text').classList.add('hidden');
    const data = {
      title,
      description: el('f-desc').value.trim(),
      priority: el('f-priority').value,
      status: el('f-status').value,
      dueDate: el('f-due').value,
      project: el('f-project').value.trim(),
      assignedTo: el('f-assigned').value.trim(),
      companyId: el('f-company').value,
      recurring: el('f-recurring').checked
    };
    try {
      const tid = el('task-id').value;
      if (tid) {
        await updateTask(tid, data);
        showView_modal(false);
        openTask(tid);
      } else {
        const newId = await createTask(data);
        currentTaskId = newId;
        setTimeout(() => { const t = allTasks.find(t=>t.id===newId); if(t) openTask(newId); else hideModal('task-modal-overlay'); }, 700);
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.querySelector('.btn-loader').classList.add('hidden');
      saveBtn.querySelector('.btn-text').classList.remove('hidden');
    }
  });

  // Comment
  el('add-comment-btn').addEventListener('click', async () => {
    if (!currentTaskId) return;
    const text = el('comment-text').value.trim();
    if (!text) return;
    el('comment-text').value = '';
    await addComment(currentTaskId, text);
    const task = allTasks.find(t => t.id === currentTaskId);
    if (task) renderComments(task);
  });
  el('comment-text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey||e.metaKey)) el('add-comment-btn').click();
  });

  // Attachment
  el('attachment-input').addEventListener('change', async e => {
    if (!currentTaskId) return;
    for (const file of Array.from(e.target.files)) await uploadAttachment(currentTaskId, file);
    const task = allTasks.find(t => t.id === currentTaskId);
    if (task) renderAttachments(task);
    e.target.value = '';
  });

  // Notes
  el('new-note-btn').addEventListener('click', () => openNoteModal(null));
  el('note-close-btn').addEventListener('click', () => hideModal('note-modal-overlay'));
  el('note-cancel-btn').addEventListener('click', () => hideModal('note-modal-overlay'));
  el('note-modal-overlay').addEventListener('click', e => { if (e.target===el('note-modal-overlay')) hideModal('note-modal-overlay'); });
  el('notes-filter').addEventListener('change', renderNotes);
  el('delete-note-btn').addEventListener('click', async () => {
    if (!currentNoteId||!confirm('Delete this note?')) return;
    try { await deleteDoc(doc(db,'notes',currentNoteId)); hideModal('note-modal-overlay'); showToast('Note deleted.','warning'); } catch { showToast('Delete failed.','error'); }
  });
  el('save-note-btn').addEventListener('click', async () => {
    const title = el('note-title').value.trim();
    if (!title) { showToast('Note needs a title.','error'); return; }
    const btn = el('save-note-btn');
    btn.disabled = true; btn.querySelector('.btn-loader').classList.remove('hidden'); btn.querySelector('.btn-text').classList.add('hidden');
    const data = { title, category: el('note-category').value, color: el('note-color').value, content: el('note-content').innerHTML, createdBy: currentUser.uid, updatedAt: serverTimestamp() };
    try {
      const nid = el('note-id').value;
      if (nid) await updateDoc(doc(db,'notes',nid), data);
      else { await addDoc(collection(db,'notes'), { ...data, createdAt: serverTimestamp() }); }
      hideModal('note-modal-overlay'); showToast('Note saved!','success');
    } catch { showToast('Save failed.','error'); }
    finally { btn.disabled=false; btn.querySelector('.btn-loader').classList.add('hidden'); btn.querySelector('.btn-text').classList.remove('hidden'); }
  });
  document.querySelectorAll('.editor-btn').forEach(btn => {
    btn.addEventListener('click', () => { document.execCommand(btn.dataset.cmd, false, null); btn.classList.toggle('active'); });
  });

  // Meetings
  el('new-meeting-btn').addEventListener('click', () => openMeeting(null));
  el('meeting-close-btn').addEventListener('click', () => hideModal('meeting-modal-overlay'));
  el('meeting-cancel-btn').addEventListener('click', () => hideModal('meeting-modal-overlay'));
  el('meeting-modal-overlay').addEventListener('click', e => { if (e.target===el('meeting-modal-overlay')) hideModal('meeting-modal-overlay'); });
  el('delete-meeting-btn').addEventListener('click', async () => {
    if (!currentMeetingId||!confirm('Delete this meeting?')) return;
    try { await deleteDoc(doc(db,'meetings',currentMeetingId)); hideModal('meeting-modal-overlay'); showToast('Meeting deleted.','warning'); } catch { showToast('Delete failed.','error'); }
  });
  el('save-meeting-btn').addEventListener('click', async () => {
    const title = el('meeting-title').value.trim(), date = el('meeting-date').value;
    if (!title||!date) { showToast('Title and date required.','error'); return; }
    const btn = el('save-meeting-btn');
    btn.disabled=true; btn.querySelector('.btn-loader').classList.remove('hidden'); btn.querySelector('.btn-text').classList.add('hidden');
    const data = { title, date, time: el('meeting-time').value, duration: el('meeting-duration').value, location: el('meeting-location').value, attendees: el('meeting-attendees').value, agenda: el('meeting-agenda').value, minutes: el('meeting-minutes').innerHTML, actionItems: el('meeting-actions').value, createdBy: currentUser.uid, updatedAt: serverTimestamp() };
    try {
      const mid = el('meeting-id').value;
      if (mid) await updateDoc(doc(db,'meetings',mid), data);
      else await addDoc(collection(db,'meetings'), { ...data, createdAt: serverTimestamp() });
      hideModal('meeting-modal-overlay'); showToast('Meeting saved!','success');
    } catch { showToast('Save failed.','error'); }
    finally { btn.disabled=false; btn.querySelector('.btn-loader').classList.add('hidden'); btn.querySelector('.btn-text').classList.remove('hidden'); }
  });

  // Companies
  el('new-company-btn')?.addEventListener('click', () => openCompanyModal(null));
  el('company-close-btn').addEventListener('click', () => hideModal('company-modal-overlay'));
  el('company-cancel-btn').addEventListener('click', () => hideModal('company-modal-overlay'));
  el('save-company-btn').addEventListener('click', async () => {
    const name = el('co-name-input').value.trim();
    if (!name) { showToast('Company name required.','error'); return; }
    const btn = el('save-company-btn');
    btn.disabled=true; btn.querySelector('.btn-loader').classList.remove('hidden'); btn.querySelector('.btn-text').classList.add('hidden');
    const data = { name, industry: el('co-industry').value, website: el('co-website').value, description: el('co-desc').value, color: el('co-color').value, createdBy: currentUser.uid };
    try {
      const cid = el('company-id').value;
      if (cid) await updateDoc(doc(db,'companies',cid), data);
      else await addDoc(collection(db,'companies'), { ...data, createdAt: serverTimestamp() });
      hideModal('company-modal-overlay'); showToast('Company saved!','success');
    } catch { showToast('Save failed.','error'); }
    finally { btn.disabled=false; btn.querySelector('.btn-loader').classList.add('hidden'); btn.querySelector('.btn-text').classList.remove('hidden'); }
  });

  // Users
  el('invite-user-btn')?.addEventListener('click', () => { el('invite-uid').value=''; el('invite-name').value=''; el('invite-role').value='member'; el('invite-company').value=''; showModal('invite-modal-overlay'); });
  el('invite-close-btn').addEventListener('click', () => hideModal('invite-modal-overlay'));
  el('invite-cancel-btn').addEventListener('click', () => hideModal('invite-modal-overlay'));
  el('save-invite-btn').addEventListener('click', async () => {
    const uid = el('invite-uid').value;
    if (!uid) { showToast('No user selected.','error'); return; }
    const coId = el('invite-company').value;
    const updates = { role: el('invite-role').value };
    if (el('invite-name').value) updates.name = el('invite-name').value;
    if (coId) updates.companies = arrayUnion(coId);
    try {
      await updateDoc(doc(db,'users',uid), updates);
      hideModal('invite-modal-overlay'); showToast('User updated!','success');
    } catch { showToast('Update failed.','error'); }
  });

  // Clock
  el('clock-in-btn').addEventListener('click', clockIn);
  el('clock-out-btn').addEventListener('click', clockOut);
  el('time-filter-date').addEventListener('change', renderTimeLog);
  el('time-filter-user')?.addEventListener('change', renderTimeLog);

  // Search
  const si = el('search-input'), sr = el('search-results');
  si.addEventListener('input', () => {
    const q = si.value.trim().toLowerCase();
    if (!q) { sr.classList.remove('open'); return; }
    const results = [...allTasks.filter(t => t.title?.toLowerCase().includes(q)||t.description?.toLowerCase().includes(q)).map(t=>({...t,_type:'task'})), ...allNotes.filter(n=>n.title?.toLowerCase().includes(q)).map(n=>({...n,_type:'note'})), ...allMeetings.filter(m=>m.title?.toLowerCase().includes(q)).map(m=>({...m,_type:'meeting'}))].slice(0,8);
    if (!results.length) { sr.innerHTML='<div class="search-result-item">No results.</div>'; }
    else sr.innerHTML = results.map(r => `
      <div class="search-result-item" data-id="${r.id}" data-type="${r._type}">
        <span style="font-size:.8rem;padding:.15rem .4rem;border-radius:4px;background:var(--surface2);color:var(--text-muted)">${r._type}</span>
        <span style="flex:1;font-weight:500">${esc(r.title)}</span>
        ${r._type==='task'?`<span class="priority-badge ${r.priority||'low'}" style="font-size:.65rem">${r.priority||'low'}</span>`:''}
      </div>`).join('');
    sr.classList.add('open');
    sr.querySelectorAll('.search-result-item[data-id]').forEach(row => {
      row.addEventListener('click', () => {
        if (row.dataset.type==='task') openTask(row.dataset.id);
        else if (row.dataset.type==='note') { switchView('notes'); openNoteModal(row.dataset.id); }
        else { switchView('meetings'); openMeeting(row.dataset.id); }
        si.value=''; sr.classList.remove('open');
      });
    });
    sr.classList.add('open');
  });
  document.addEventListener('click', e => { if (!si.contains(e.target)&&!sr.contains(e.target)) sr.classList.remove('open'); });

  // Filters
  el('filter-priority').addEventListener('change', renderTasks);
  el('filter-project').addEventListener('change', renderTasks);
  el('kanban-project-filter').addEventListener('change', () => renderKanban(getFilteredTasks()));

  // Notifications
  el('notif-btn').addEventListener('click', e => { e.stopPropagation(); el('notif-dropdown').classList.toggle('hidden'); });
  el('clear-notifs').addEventListener('click', e => { e.stopPropagation(); el('notif-dropdown').classList.add('hidden'); });
  document.addEventListener('click', e => { if (!el('notif-btn').contains(e.target)) el('notif-dropdown').classList.add('hidden'); });

  // Theme
  el('theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur==='dark'?'light':'dark';
    applyTheme(next); localStorage.setItem('sg-theme', next);
  });

  // Logout
  el('logout-btn').addEventListener('click', async () => {
    clearInterval(clockInterval);
    if (clockInTime) await clockOut();
    unsubs.forEach(u => u());
    await signOut(auth);
    window.location.href = 'login.html';
  });

  // Calendar nav
  el('cal-prev').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth()-1); renderCalendar(); });
  el('cal-next').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth()+1); renderCalendar(); });

  // Mobile sidebar
  el('menu-btn').addEventListener('click', () => { el('sidebar').classList.add('open'); el('sidebar-overlay').classList.remove('hidden'); });
  el('sidebar-close').addEventListener('click', closeSidebar);
  el('sidebar-overlay').addEventListener('click', closeSidebar);

  // Add project
  el('add-project-btn').addEventListener('click', () => {
    const name = prompt('Enter project name:');
    if (name?.trim()) { openTask(null); setTimeout(() => el('f-project').value = name.trim(), 100); }
  });

  // Export CSV
  el('export-tasks-btn')?.addEventListener('click', exportCSV);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key==='Escape') { hideModal('task-modal-overlay'); hideModal('note-modal-overlay'); hideModal('meeting-modal-overlay'); hideModal('company-modal-overlay'); hideModal('invite-modal-overlay'); }
    if ((e.ctrlKey||e.metaKey) && e.key==='n') { e.preventDefault(); openTask(null); }
  });
}

// ─── View Switching ───────────────────────────────────────
window.switchView = function(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const v = el(`view-${name}`);
  if (v) v.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (nav) nav.classList.add('active');
  // Lazy render
  if (name==='calendar') renderCalendar();
  if (name==='notes') renderNotes();
  if (name==='meetings') renderMeetings();
  if (name==='timeclock') { renderTimeLog(); updateTodayHours(); }
  if (name==='companies') renderCompanies();
  if (name==='users') renderUsers();
  if (name==='reports') renderReports();
};

// ─── Helpers ──────────────────────────────────────────────
function showModal(id) { el(id).classList.remove('hidden'); }
function hideModal(id) { el(id).classList.add('hidden'); }
function closeSidebar() { el('sidebar').classList.remove('open'); el('sidebar-overlay').classList.add('hidden'); }

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  el('sun-icon').classList.toggle('hidden', theme==='dark');
  el('moon-icon').classList.toggle('hidden', theme==='light');
}

function updateGreeting() {
  const h = new Date().getHours();
  const g = h<12 ? 'Good morning' : h<17 ? 'Good afternoon' : 'Good evening';
  const name = (userProfile?.name||currentUser?.displayName||'').split(' ')[0];
  el('dash-greeting').textContent = `${g}, ${name} 👋`;
}

function exportCSV() {
  const tasks = getFilteredTasks();
  const headers = ['Title','Description','Priority','Status','Due Date','Project','Assigned To'];
  const rows = tasks.map(t => [t.title,t.description||'',t.priority,statusLabel(t.status),t.dueDate||'',t.project||'',t.assignedTo||''].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'tasks.csv'; a.click();
}

function showToast(msg, type='') {
  const c = el('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = {success:'✓',error:'✕',warning:'⚠'};
  t.innerHTML = `<span>${icons[type]||'ℹ'}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.animation='toastOut .22s ease forwards'; setTimeout(()=>t.remove(),220); }, 3200);
}

function esc(s) { if(!s)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function el(id) { return document.getElementById(id); }
function ts(obj) { return obj?.createdAt?.toMillis?.() || 0; }
function today() { const d=new Date(); d.setHours(0,0,0,0); return d; }
function isThisWeek(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const start = new Date(now); start.setDate(now.getDate()-now.getDay());
  const end = new Date(start); end.setDate(start.getDate()+7);
  return d >= start && d < end;
}
function formatDuration(min) {
  if (!min) return '0h 0m';
  const h = Math.floor(min/60), m = min%60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
function formatTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
  catch { return iso; }
}
function statusLabel(s) {
  return {todo:'To Do',inprogress:'In Progress',review:'Review',completed:'Completed'}[s]||s||'To Do';
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase()+s.slice(1) : ''; }
