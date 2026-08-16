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
let allProjects = [];
let allFinance = [];
let allPettyCash = [];
let currentTaskId = null;
let currentNoteId = null;
let currentMeetingId = null;
let currentCompanyId = null;
let currentProjectId = null;
let currentFinanceId = null;
let currentPettyCashId = null;
// The active workspace filter — restricts tasks/projects/boards to one company,
// or null/'' for "All Companies". Persisted so the choice survives a reload.
let activeCompanyId = localStorage.getItem('sg-active-company') || '';
let currentFinType = 'income';
let currentPcType = 'topup';
let currentView = 'dashboard';
let calendarDate = new Date();
let clockInterval = null;
let clockInTime = null;
const unsubs = [];

const PROJECT_COLORS = ['#2563eb','#8b5cf6','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899','#84cc16'];
const FIN_CATEGORIES = {
  income: ['Sales','Consulting','Service Fees','Interest Income','Grants','Other Income'],
  expense: ['Rent','Utilities','Salaries','Supplies','Marketing','Travel','Software/Subscriptions','Professional Fees','Maintenance','Other Expense'],
  accrual: ['Sales','Consulting','Rent','Utilities','Salaries','Professional Fees','Other']
};

// Returns true if the given companyId belongs to the active workspace filter
// (or if there is no active filter, i.e. "All Companies" is selected).
function matchesActiveCompany(companyId) {
  if (!activeCompanyId) return true;
  return companyId === activeCompanyId;
}

// ─── Auth Guard ────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
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
  subscribeProjects();
  subscribeFinance();
  subscribePettyCash();
}

function subscribeTasks() {
  // Tasks can reach a user three ways: they created it, or they're assigned to it
  // (by uid or by email — the "Assigned to" field accepts either). Merge all three
  // live streams so assigned tasks actually show up for the assignee, not just the creator.
  const taskBuckets = { created: [], assignedUid: [], assignedEmail: [] };
  const mergeAndRender = () => {
    const seen = new Map();
    [...taskBuckets.created, ...taskBuckets.assignedUid, ...taskBuckets.assignedEmail]
      .forEach(t => seen.set(t.id, t));
    allTasks = [...seen.values()].sort((a,b) => ts(b) - ts(a));
    renderTasks();
    checkNotifications();
    el('nb-tasks').textContent = allTasks.filter(t => t.status !== 'completed').length;
  };

  const qCreated = query(collection(db, 'tasks'), where('createdBy', '==', currentUser.uid));
  unsubs.push(onSnapshot(qCreated, snap => {
    taskBuckets.created = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    mergeAndRender();
  }));

  const qAssignedUid = query(collection(db, 'tasks'), where('assignedTo', '==', currentUser.uid));
  unsubs.push(onSnapshot(qAssignedUid, snap => {
    taskBuckets.assignedUid = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    mergeAndRender();
  }, () => {}));

  if (currentUser.email) {
    const qAssignedEmail = query(collection(db, 'tasks'), where('assignedTo', '==', currentUser.email));
    unsubs.push(onSnapshot(qAssignedEmail, snap => {
      taskBuckets.assignedEmail = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      mergeAndRender();
    }, () => {}));
  }
}

function subscribeNotes() {
  const q = query(collection(db, 'notes'), where('createdBy', '==', currentUser.uid));
  unsubs.push(onSnapshot(q, snap => {
    allNotes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => ts(b)-ts(a));
    if (currentView === 'notes') renderNotes();
    // Sticky-note counts live on Kanban cards, and the task modal's own
    // sticky-notes section needs to stay in sync while it's open.
    if (currentView === 'kanban') renderKanban(getFilteredTasks());
    if (currentTaskId && !el('task-modal-overlay').classList.contains('hidden')) {
      const t = allTasks.find(t => t.id === currentTaskId);
      if (t) renderTaskNotes(t);
    }
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

function subscribeProjects() {
  const q = query(collection(db, 'projects'));
  unsubs.push(onSnapshot(q, snap => {
    allProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProjectsSidebar();
    populateProjectFilter();
    populateProjectSelects();
    populateFinanceProjectFilter();
    if (currentView === 'projects') renderProjectsGrid();
    if (currentView === 'finance') renderFinance();
    const badge = el('nb-projects');
    if (badge) badge.textContent = allProjects.filter(p => !p.archived && matchesActiveCompany(p.companyId)).length;
  }, () => {}));
}

function subscribeFinance() {
  const q = query(collection(db, 'financeEntries'));
  unsubs.push(onSnapshot(q, snap => {
    allFinance = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.date||0) - new Date(a.date||0));
    const pendingCount = allFinance.filter(f => f.type==='accrual' && f.status==='pending').length;
    const badge = el('nb-accruals');
    if (badge) badge.textContent = pendingCount;
    if (currentView === 'finance') renderFinance();
  }, () => {}));
}

function subscribePettyCash() {
  const q = query(collection(db, 'pettyCash'));
  unsubs.push(onSnapshot(q, snap => {
    allPettyCash = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.date||0) - new Date(a.date||0));
    if (currentView === 'finance') renderFinance();
  }, () => {}));
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
  if (currentView === 'projects') renderProjectsGrid();
  renderProjectsSidebar();
  populateProjectFilter();
}

function getFilteredTasks() {
  const prio = el('filter-priority')?.value || '';
  const proj = el('filter-project')?.value || '';
  return allTasks.filter(t => {
    if (!matchesActiveCompany(t.companyId)) return false;
    if (prio && t.priority !== prio) return false;
    if (proj && t.projectId !== proj) return false;
    return true;
  });
}

// Resolve a task's project display name — prefers the linked project entity,
// falls back to the legacy free-text label for tasks created before projects existed.
function projectNameFor(t) {
  if (t.projectId) {
    const p = allProjects.find(p => p.id === t.projectId);
    if (p) return p.name;
  }
  return t.project || '';
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
  const filtered = kpf ? tasks.filter(t => t.projectId === kpf) : tasks;
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
  if (kpf) {
    const proj = allProjects.find(p => p.id === kpf);
    const co = proj && allCompanies.find(c => c.id === proj.companyId);
    el('kanban-subtitle').textContent = `${proj ? proj.name : 'Project'}${co ? ' · ' + co.name : ''} · ${filtered.length} tasks`;
  } else {
    el('kanban-subtitle').textContent = `${activeCompanyId ? (allCompanies.find(c=>c.id===activeCompanyId)?.name || 'Company') : 'All Companies'} · All Projects · ${filtered.length} tasks`;
  }
}

// Jump straight to a project's own board — this is what "boards per project" means
// in practice: the shared Kanban view, scoped down to just this project's tasks.
window.openProjectBoard = function(projectId) {
  const sel = el('kanban-project-filter');
  if (sel) sel.value = projectId;
  switchView('kanban');
  renderKanban(getFilteredTasks());
  if (window.innerWidth <= 768) closeSidebar();
};

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
  const snc = allNotes.filter(n => n.taskId === t.id).length;
  return `<div class="task-card" data-id="${t.id}" draggable="true">
    <div class="card-top">
      <span class="card-title-text ${t.status==='completed'?'done-text':''}">${esc(t.title)}</span>
      <div class="priority-dot ${t.priority||'low'}"></div>
    </div>
    ${t.description?`<p class="card-desc">${esc(t.description)}</p>`:''}
    <div class="card-footer">
      ${dueLabel?`<span class="card-due ${dueCls}">${dueSvg}${dueLabel}</span>`:'<span></span>'}
      <div class="card-meta">
        ${projectNameFor(t)?`<span class="card-project">${esc(projectNameFor(t))}</span>`:''}
        ${snc?`<span class="card-stickynotes" title="${snc} sticky note${snc>1?'s':''}">${stickySvg} ${snc}</span>`:''}
        ${cc?`<span class="card-comments">${commentSvg} ${cc}</span>`:''}
      </div>
    </div>
  </div>`;
}
const dueSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const commentSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const stickySvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

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
    const pname = projectNameFor(t);
    return `<div class="task-table-row" data-id="${t.id}">
      <button class="task-check-btn ${t.status==='completed'?'done':''}" onclick="event.stopPropagation();toggleTaskDone('${t.id}')"></button>
      <div style="overflow:hidden"><div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${t.status==='completed'?'text-decoration:line-through;color:var(--text-light)':''}">${esc(t.title)}</div><div style="font-size:.75rem;color:var(--text-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pname?`📁 ${esc(pname)}`:''}</div></div>
      <div><span class="priority-badge ${t.priority||'low'}">${t.priority||'low'}</span></div>
      <div><span class="status-badge ${t.status||'todo'}">${statusLabel(t.status)}</span></div>
      <div style="color:var(--text-muted);font-size:.8125rem">${due}</div>
      <div>${pname?`<span class="project-tag">${esc(pname)}</span>`:''}</div>
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
function renderProjectsSidebar() {
  const projects = allProjects
    .filter(p => !p.archived && matchesActiveCompany(p.companyId))
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));
  el('project-list').innerHTML = projects.length ? projects.map((p,i) =>
    `<div class="project-item" data-id="${p.id}">
      <div class="project-dot" style="background:${p.color||PROJECT_COLORS[i%PROJECT_COLORS.length]}"></div>
      <span>${esc(p.name)}</span>
    </div>`).join('') : '<div style="padding:.5rem .875rem;font-size:.75rem;color:rgba(255,255,255,.3)">No projects yet</div>';
  el('project-list').querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => openProjectBoard(item.dataset.id));
  });
  const scopeEl = el('sidebar-projects-scope');
  if (scopeEl) {
    const co = activeCompanyId && allCompanies.find(c => c.id === activeCompanyId);
    scopeEl.textContent = co ? `· ${co.name}` : '';
  }
}

function populateProjectFilter() {
  const projects = allProjects
    .filter(p => matchesActiveCompany(p.companyId))
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));
  const selects = [el('filter-project'), el('kanban-project-filter')];
  selects.forEach(sel => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Projects</option>' + projects.map(p => `<option value="${p.id}" ${cur===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
  });
  const coFilter = el('projects-company-filter');
  if (coFilter) {
    const cur = coFilter.value;
    coFilter.innerHTML = '<option value="">All Companies</option>' + allCompanies.map(c => `<option value="${c.id}" ${cur===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
  }
}

// Populates the task-modal project <select>, scoped to whichever company is
// currently chosen in that same form (falls back to the active workspace company).
// Populates a "project" <select> scoped to whichever company is currently
// chosen in a paired company <select> — used by both the task form and the
// finance entry form so picking a company narrows the project list to it.
function populateCascadingProjectSelect(selectId, companySelectId) {
  const sel = el(selectId);
  if (!sel) return;
  const companyScope = el(companySelectId)?.value || '';
  const cur = sel.value;
  const projects = allProjects
    .filter(p => !p.archived)
    .filter(p => companyScope ? p.companyId === companyScope : true)
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));
  sel.innerHTML = '<option value="">No project</option>' + projects.map(p => `<option value="${p.id}" ${cur===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
}

function populateProjectSelects() {
  populateCascadingProjectSelect('f-project', 'f-company');
  populateCascadingProjectSelect('fin-project', 'fin-company');
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

// Companies a user is allowed to switch into: admins/managers see everything,
// everyone else sees only the companies they've been added to.
function visibleCompaniesForUser() {
  if (['admin','manager'].includes(userProfile?.role)) return allCompanies;
  return allCompanies.filter(c => (userProfile?.companies||[]).includes(c.id));
}

function renderCompanySwitcher() {
  // Reflect current selection in the pill
  if (!activeCompanyId) {
    el('co-name').textContent = 'All Companies';
    el('co-dot').style.background = '#64748b';
  } else {
    const active = allCompanies.find(c => c.id === activeCompanyId);
    if (active) { el('co-name').textContent = active.name; el('co-dot').style.background = active.color || '#22c55e'; }
    else { activeCompanyId = ''; localStorage.removeItem('sg-active-company'); el('co-name').textContent = 'All Companies'; el('co-dot').style.background = '#64748b'; }
  }
  // Build the dropdown list
  const list = el('company-dropdown-list');
  if (list) {
    const mine = visibleCompaniesForUser();
    list.innerHTML = mine.map(c => `
      <div class="company-dropdown-item ${c.id===activeCompanyId?'active':''}" data-company-id="${c.id}">
        <div class="company-dot" style="background:${c.color||'#2563eb'}"></div><span>${esc(c.name)}</span>
      </div>`).join('') || '<div style="padding:.5rem .625rem;font-size:.75rem;color:rgba(255,255,255,.4)">No companies yet</div>';
    list.querySelectorAll('.company-dropdown-item').forEach(item => {
      item.addEventListener('click', () => setActiveCompany(item.dataset.companyId));
    });
  }
  const allItem = document.querySelector('.company-dropdown-item[data-company-id=""]');
  if (allItem) allItem.classList.toggle('active', !activeCompanyId);
}

function setActiveCompany(id) {
  activeCompanyId = id || '';
  if (activeCompanyId) localStorage.setItem('sg-active-company', activeCompanyId);
  else localStorage.removeItem('sg-active-company');
  el('company-dropdown').classList.add('hidden');
  el('company-switcher').classList.remove('open');
  renderCompanySwitcher();
  applyCompanyFilter();
}

// Re-renders every view that depends on which company workspace is active.
function applyCompanyFilter() {
  renderTasks();
  renderProjectsSidebar();
  populateProjectFilter();
  if (currentView === 'projects') renderProjectsGrid();
  const badge = el('nb-projects');
  if (badge) badge.textContent = allProjects.filter(p => !p.archived && matchesActiveCompany(p.companyId)).length;
}

function populateCompanySelects() {
  const opts = '<option value="">No company</option>' + allCompanies.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  [el('f-company'), el('invite-company'), el('fin-company'), el('pr-company')].forEach(sel => { if (sel) sel.innerHTML = opts; });
  const filterOpts = '<option value="">All Companies</option>' + allCompanies.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const financeFilter = el('finance-company-filter');
  if (financeFilter) financeFilter.innerHTML = filterOpts;
  populateFinanceProjectFilter();
  renderCompanySwitcher();
}

window.deleteCompany = async (id) => {
  if (!confirm('Delete this company? Its projects and tasks will stay, but will show as "No company".')) return;
  try {
    await deleteDoc(doc(db, 'companies', id));
    if (activeCompanyId === id) setActiveCompany('');
    showToast('Company deleted.', 'warning');
  } catch { showToast('Failed.', 'error'); }
};

// ─── Projects Grid (main view) ────────────────────────────
function renderProjectsGrid() {
  const g = el('projects-grid');
  const coFilter = el('projects-company-filter')?.value || '';
  const projects = allProjects
    .filter(p => matchesActiveCompany(p.companyId))
    .filter(p => !coFilter || p.companyId === coFilter)
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));
  if (!projects.length) { g.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:3rem">No projects yet. Create your first project to get a dedicated board!</div>'; return; }
  g.innerHTML = projects.map(p => {
    const co = allCompanies.find(c => c.id === p.companyId);
    const tasks = allTasks.filter(t => t.projectId === p.id);
    const done = tasks.filter(t => t.status === 'completed').length;
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    return `<div class="company-card project-card ${p.archived?'archived':''}" data-id="${p.id}">
      <div class="company-card-header">
        <div class="company-logo" style="background:${p.color||'#2563eb'}">${(p.name||'?').charAt(0).toUpperCase()}</div>
        <div class="company-info">
          <div class="company-card-name">${esc(p.name)}${p.archived?' <span style="font-weight:400;font-size:.7rem;color:var(--text-light)">(archived)</span>':''}</div>
          ${co ? `<div class="project-card-company-tag"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>${esc(co.name)}</div>` : '<div class="project-card-company-tag">No company</div>'}
        </div>
      </div>
      ${p.description?`<p class="project-card-desc">${esc(p.description)}</p>`:''}
      <div class="project-card-progress-label"><span>${done}/${tasks.length} tasks done</span><span>${pct}%</span></div>
      <div class="progress-bar-wrap md"><div class="progress-bar-fill" style="width:${pct}%;background:${p.color||'#2563eb'}"></div></div>
      <div style="display:flex;gap:.5rem;margin-top:1rem">
        <button class="btn-primary" style="font-size:.8rem;padding:.4rem .75rem;flex:1" onclick="event.stopPropagation();openProjectBoard('${p.id}')">Open Board</button>
        <button class="btn-ghost" style="font-size:.8rem;padding:.4rem .75rem" onclick="event.stopPropagation();openProjectModal('${p.id}')">Edit</button>
        <button class="btn-danger" style="font-size:.8rem;padding:.4rem .75rem" onclick="event.stopPropagation();deleteProject('${p.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
  g.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => openProjectBoard(card.dataset.id));
  });
}

const PROJECT_COLOR_PALETTE = ['#2563eb','#8b5cf6','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899','#84cc16','#0ea5e9','#f97316'];

function renderProjectColorSwatches(selected) {
  const wrap = el('pr-color-swatches');
  if (!wrap) return;
  wrap.innerHTML = PROJECT_COLOR_PALETTE.map(c =>
    `<div class="color-swatch ${c===selected?'active':''}" data-color="${c}" style="background:${c};color:${c}"></div>`).join('');
  wrap.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      wrap.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      el('pr-color').value = sw.dataset.color;
    });
  });
}

function openProjectModal(id) {
  currentProjectId = id || null;
  const p = id ? allProjects.find(p => p.id === id) : null;
  el('project-modal-title').textContent = p ? 'Edit Project' : 'New Project';
  el('project-id').value = p?.id || '';
  el('pr-name-input').value = p?.name || '';
  el('pr-company').value = p?.companyId || activeCompanyId || '';
  el('pr-desc').value = p?.description || '';
  el('pr-budget').value = p?.budget || '';
  el('pr-color').value = p?.color || PROJECT_COLOR_PALETTE[allProjects.length % PROJECT_COLOR_PALETTE.length];
  el('pr-archived').checked = !!p?.archived;
  el('delete-project-btn').style.display = p ? 'flex' : 'none';
  renderProjectColorSwatches(el('pr-color').value);
  showModal('project-modal-overlay');
}

async function createProject(data) {
  try {
    const ref = await addDoc(collection(db,'projects'), { ...data, createdBy: currentUser.uid, createdAt: serverTimestamp() });
    showToast('Project created!','success'); return ref.id;
  } catch { showToast('Failed to create project.','error'); throw new Error(); }
}
async function updateProject(id, data) {
  try { await updateDoc(doc(db,'projects',id), data); showToast('Project saved!','success'); }
  catch { showToast('Save failed.','error'); }
}
window.deleteProject = async (id) => {
  if (!confirm('Delete this project? Tasks in it will remain but become unassigned from any project.')) return;
  try {
    await deleteDoc(doc(db, 'projects', id));
    showToast('Project deleted.', 'warning');
  } catch { showToast('Failed.', 'error'); }
};
window.openProjectModal = openProjectModal;

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
    const linkedTask = n.taskId ? allTasks.find(t => t.id === n.taskId) : null;
    return `<div class="note-card" data-id="${n.id}">
      <div class="note-card-color" style="background:${n.color||'#2563eb'}"></div>
      <div class="note-card-title">${esc(n.title||'Untitled')}</div>
      <div class="note-card-preview">${preview || 'No content'}</div>
      <div class="note-card-meta">
        <span>${n.category||'general'}</span>·<span>${date}</span>
      </div>
      ${linkedTask ? `<div class="note-card-task-chip" data-task-id="${linkedTask.id}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg> ${esc(linkedTask.title)}</div>` : ''}
    </div>`;
  }).join('');
  el('notes-grid').querySelectorAll('.note-card').forEach(c => c.addEventListener('click', e => {
    const chip = e.target.closest('.note-card-task-chip');
    if (chip) { e.stopPropagation(); openTask(chip.dataset.taskId); return; }
    openNoteModal(c.dataset.id);
  }));
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
  const scoped = allTasks.filter(t => matchesActiveCompany(t.companyId));
  renderBarChart('report-priority-chart', [
    { label:'High', value: scoped.filter(t=>t.priority==='high').length, color:'#ef4444' },
    { label:'Medium', value: scoped.filter(t=>t.priority==='medium').length, color:'#f59e0b' },
    { label:'Low', value: scoped.filter(t=>t.priority==='low').length, color:'#22c55e' },
  ]);
  const byProject = {};
  scoped.forEach(t => { const p = projectNameFor(t); if (p) { byProject[p] = (byProject[p]||0) + 1; } });
  renderBarChart('report-project-chart', Object.entries(byProject).map(([label,value],i) => ({label, value, color: PROJECT_COLORS[i%PROJECT_COLORS.length]})));
}

function renderBarChart(containerId, data, formatFn) {
  const el2 = el(containerId);
  if (!data.length) { el2.innerHTML = '<div class="empty-state">No data yet.</div>'; return; }
  const max = Math.max(...data.map(d=>d.value), 1);
  const fmt = formatFn || (v => v);
  el2.innerHTML = data.map(d => `
    <div style="margin-bottom:.875rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.375rem">
        <span style="font-size:.875rem;font-weight:500;color:var(--text)">${esc(d.label)}</span>
        <span style="font-size:.875rem;font-weight:700;color:var(--text)">${fmt(d.value)}</span>
      </div>
      <div class="progress-bar-wrap md"><div class="progress-bar-fill" style="background:${d.color};width:${d.value/max*100}%"></div></div>
    </div>`).join('');
}

// ─── Finance ───────────────────────────────────────────────
function fmtMoney(n) {
  const v = Number(n) || 0;
  return 'KES ' + v.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function getFilteredFinance() {
  const companyId = el('finance-company-filter')?.value || '';
  const projectId = el('finance-project-filter')?.value || '';
  return allFinance.filter(f => {
    if (companyId && f.companyId !== companyId) return false;
    if (projectId && f.projectId !== projectId) return false;
    return matchesFinanceTypeStatusMonth(f);
  });
}

// The type/status/month portion of the finance filters, split out so the
// company/project roll-up charts can reuse it while ignoring the company
// and project scope (which they vary themselves).
function matchesFinanceTypeStatusMonth(f) {
  const type = el('finance-type-filter')?.value || '';
  const status = el('finance-status-filter')?.value || '';
  const month = el('finance-month-filter')?.value || '';
  if (type && f.type !== type) return false;
  if (status && (f.status||'na') !== status) return false;
  if (month && (f.date||'').slice(0,7) !== month) return false;
  return true;
}

function computeFinanceStats(entries) {
  const income = entries.filter(f => f.type==='income').reduce((a,f)=>a+(Number(f.amount)||0),0);
  const expense = entries.filter(f => f.type==='expense').reduce((a,f)=>a+(Number(f.amount)||0),0);
  const pendingAccruals = entries.filter(f => f.type==='accrual' && f.status==='pending').reduce((a,f)=>a+(Number(f.amount)||0),0);
  return { income, expense, net: income - expense, pendingAccruals };
}

function computePettyCashBalance(companyId) {
  return allPettyCash
    .filter(t => !companyId || t.companyId === companyId)
    .reduce((bal, t) => bal + (t.txType==='topup' ? (Number(t.amount)||0) : -(Number(t.amount)||0)), 0);
}

function renderFinance() {
  const companyId = el('finance-company-filter')?.value || '';
  const filtered = getFilteredFinance();
  const stats = computeFinanceStats(filtered);
  el('fin-total-income').textContent = fmtMoney(stats.income);
  el('fin-total-expense').textContent = fmtMoney(stats.expense);
  el('fin-net-balance').textContent = fmtMoney(stats.net);
  el('fin-pending-accruals').textContent = fmtMoney(stats.pendingAccruals);
  el('fin-pettycash-balance').textContent = fmtMoney(computePettyCashBalance(companyId));
  el('pc-balance-display').textContent = fmtMoney(computePettyCashBalance(companyId));

  renderFinanceMonthlyChart(filtered);
  renderFinanceCategoryChart(filtered);
  renderFinanceBudgetCard();
  renderFinanceScopeChart();
  renderFinanceRecentList(filtered);
  renderFinanceTable(filtered);
  renderPettyCashTable(companyId);
}

// ─── Finance: Budgeting ──────────────────────────────────
function renderFinanceBudgetCard() {
  const card = el('finance-budget-card');
  if (!card) return;
  const companyId = el('finance-company-filter')?.value || '';
  const projectId = el('finance-project-filter')?.value || '';
  const monthKey = new Date().toISOString().slice(0,7);
  const isThisMonthExpense = f => f.type === 'expense' && (f.date||'').slice(0,7) === monthKey;

  if (projectId) {
    const proj = allProjects.find(p => p.id === projectId);
    if (!proj) { card.innerHTML = ''; return; }
    const spend = allFinance.filter(f => f.projectId === projectId).filter(isThisMonthExpense).reduce((a,f)=>a+(Number(f.amount)||0),0);
    card.innerHTML = budgetGaugeHtml(`${esc(proj.name)} — This Month's Budget`, spend, proj.budget || 0, 'pr-budget', proj.id, 'project');
  } else if (companyId) {
    const co = allCompanies.find(c => c.id === companyId);
    if (!co) { card.innerHTML = ''; return; }
    const spend = allFinance.filter(f => f.companyId === companyId).filter(isThisMonthExpense).reduce((a,f)=>a+(Number(f.amount)||0),0);
    card.innerHTML = budgetGaugeHtml(`${esc(co.name)} — This Month's Budget`, spend, co.budget || 0, 'co-budget', co.id, 'company');
  } else {
    card.innerHTML = '<div class="card-header"><span class="card-title">Budget</span></div><div class="empty-state" style="padding:1rem 0">Pick a company (or project) above to see its monthly budget vs. actual spend.</div>';
  }
  card.querySelector('[data-edit-budget]')?.addEventListener('click', () => {
    const kind = card.querySelector('[data-edit-budget]').dataset.kind;
    const id = card.querySelector('[data-edit-budget]').dataset.id;
    if (kind === 'project') openProjectModal(id); else openCompanyModal(id);
  });
}

function budgetGaugeHtml(title, spend, budget, fieldId, entityId, kind) {
  if (!budget) {
    return `<div class="card-header"><span class="card-title">${title}</span></div>
      <div class="empty-state" style="padding:1rem 0">No monthly budget set yet.
        <button class="text-link" data-edit-budget data-kind="${kind}" data-id="${entityId}" style="background:none;border:none;cursor:pointer;font-weight:600">Set a budget →</button>
      </div>`;
  }
  const pct = Math.round(spend/budget*100);
  const over = spend > budget;
  const cls = over ? 'over' : pct>=80 ? 'warn' : 'ok';
  const color = over ? '#ef4444' : pct>=80 ? '#f59e0b' : '#22c55e';
  return `
    <div class="card-header"><span class="card-title">${title}</span><button class="text-link" data-edit-budget data-kind="${kind}" data-id="${entityId}" style="background:none;border:none;cursor:pointer;font-size:.75rem">Edit budget</button></div>
    <div class="budget-gauge">
      <div class="budget-gauge-row"><span>${fmtMoney(spend)} spent</span><span>${fmtMoney(budget)} budget</span></div>
      <div class="progress-bar-wrap md"><div class="progress-bar-fill" style="width:${Math.min(100,pct)}%;background:${color}"></div></div>
      <div class="budget-gauge-note ${cls}">${over ? `Over budget by ${fmtMoney(spend-budget)}` : `${fmtMoney(budget-spend)} remaining · ${pct}% used`}</div>
    </div>`;
}

// ─── Finance: Roll-up chart (per-project → per-company) ──
function renderFinanceScopeChart() {
  const companyId = el('finance-company-filter')?.value || '';
  const projectId = el('finance-project-filter')?.value || '';
  const titleEl = el('finance-scope-chart-title');
  if (projectId) {
    // A single project is already fully scoped by the charts above it —
    // here, show how its category spend compares within itself for context.
    const proj = allProjects.find(p => p.id === projectId);
    titleEl.textContent = `Category Breakdown — ${proj ? proj.name : 'Project'}`;
    const entries = allFinance.filter(f => f.projectId === projectId && matchesFinanceTypeStatusMonth(f) && f.type === 'expense');
    const byCat = {};
    entries.forEach(f => { const c = f.category || 'Uncategorized'; byCat[c] = (byCat[c]||0) + (Number(f.amount)||0); });
    const data = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([label,value],i) => ({ label, value, color: PROJECT_COLORS[i%PROJECT_COLORS.length] }));
    renderBarChart('finance-scope-chart', data, fmtMoney);
  } else if (companyId) {
    const co = allCompanies.find(c => c.id === companyId);
    titleEl.textContent = `Spend by Project — ${co ? co.name : 'Company'}`;
    const entries = allFinance.filter(f => f.companyId === companyId && matchesFinanceTypeStatusMonth(f) && f.type === 'expense');
    const byProj = {};
    entries.forEach(f => {
      const p = f.projectId ? allProjects.find(p => p.id === f.projectId) : null;
      const label = p ? p.name : 'No project';
      byProj[label] = (byProj[label]||0) + (Number(f.amount)||0);
    });
    const data = Object.entries(byProj).sort((a,b)=>b[1]-a[1]).map(([label,value],i) => ({ label, value, color: PROJECT_COLORS[i%PROJECT_COLORS.length] }));
    renderBarChart('finance-scope-chart', data, fmtMoney);
  } else {
    titleEl.textContent = 'Spend by Company';
    const entries = allFinance.filter(f => matchesFinanceTypeStatusMonth(f) && f.type === 'expense');
    const byCo = {};
    entries.forEach(f => {
      const co = f.companyId ? allCompanies.find(c => c.id === f.companyId) : null;
      const label = co ? co.name : 'No company';
      byCo[label] = (byCo[label]||0) + (Number(f.amount)||0);
    });
    const data = Object.entries(byCo).sort((a,b)=>b[1]-a[1]).map(([label,value],i) => ({ label, value, color: PROJECT_COLORS[i%PROJECT_COLORS.length] }));
    renderBarChart('finance-scope-chart', data, fmtMoney);
  }
}

function populateFinanceProjectFilter() {
  const sel = el('finance-project-filter');
  if (!sel) return;
  const companyId = el('finance-company-filter')?.value || '';
  const cur = sel.value;
  const projects = allProjects
    .filter(p => !companyId || p.companyId === companyId)
    .sort((a,b) => (a.name||'').localeCompare(b.name||''));
  sel.innerHTML = '<option value="">All Projects</option>' + projects.map(p => `<option value="${p.id}" ${cur===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
}

function renderFinanceMonthlyChart(entries) {
  const byMonth = {};
  entries.forEach(f => {
    if (f.type==='accrual') return; // only realized income/expense in the monthly view
    const m = (f.date||'').slice(0,7);
    if (!m) return;
    byMonth[m] = byMonth[m] || { income: 0, expense: 0 };
    byMonth[m][f.type] += Number(f.amount)||0;
  });
  const months = Object.keys(byMonth).sort().slice(-6);
  const data = [];
  months.forEach(m => {
    const label = new Date(m+'-01').toLocaleDateString('en-US',{month:'short',year:'2-digit'});
    data.push({ label: `${label} · Income`, value: byMonth[m].income, color: '#22c55e' });
    data.push({ label: `${label} · Expense`, value: byMonth[m].expense, color: '#ef4444' });
  });
  renderBarChart('finance-monthly-chart', data, fmtMoney);
}

function renderFinanceCategoryChart(entries) {
  const byCat = {};
  entries.filter(f => f.type==='expense').forEach(f => {
    const c = f.category || 'Uncategorized';
    byCat[c] = (byCat[c]||0) + (Number(f.amount)||0);
  });
  const data = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([label,value],i) => ({ label, value, color: PROJECT_COLORS[i%PROJECT_COLORS.length] }));
  renderBarChart('finance-category-chart', data, fmtMoney);
}

function renderFinanceRecentList(entries) {
  const listEl = el('finance-recent-list');
  const recent = entries.slice(0, 6);
  if (!recent.length) { listEl.innerHTML = '<div class="empty-state">No transactions yet.</div>'; return; }
  listEl.innerHTML = recent.map(f => {
    const pname = f.projectId ? (allProjects.find(p=>p.id===f.projectId)?.name || '') : '';
    return `
    <div class="finance-recent-row" data-id="${f.id}">
      <div>
        <div class="fin-recent-desc" style="font-weight:600;font-size:.875rem">${esc(f.description || f.category || capitalize(f.type))}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">${esc(f.date||'')} · ${esc(f.category||capitalize(f.type))}${pname?` · 📁 ${esc(pname)}`:''}</div>
      </div>
      <span class="fin-amount ${f.type}">${f.type==='expense'?'-':'+'}${fmtMoney(f.amount)}</span>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.finance-recent-row').forEach(row => row.addEventListener('click', () => openFinanceModal(row.dataset.id)));
}

function renderFinanceTable(entries) {
  const listEl = el('finance-table-list');
  if (!entries.length) { listEl.innerHTML = '<div class="empty-state">No finance entries match your filters.</div>'; return; }
  listEl.innerHTML = entries.map(f => {
    const pname = f.projectId ? (allProjects.find(p=>p.id===f.projectId)?.name || '') : '';
    return `
    <div class="finance-table-row" data-id="${f.id}">
      <div style="font-size:.8125rem;color:var(--text-muted)">${esc(f.date||'')}</div>
      <div style="font-weight:500">${esc(f.description || '—')}${pname?`<div style="font-size:.7rem;font-weight:400;color:var(--text-light)">📁 ${esc(pname)}</div>`:''}</div>
      <div style="font-size:.8125rem;color:var(--text-muted)">${esc(f.category||'—')}</div>
      <div><span class="fin-type-badge ${f.type}">${f.type}</span></div>
      <div>${f.type==='accrual' ? `<span class="fin-status-badge ${f.status||'pending'}">${f.status||'pending'}</span>` : '<span class="fin-status-badge na">—</span>'}</div>
      <div class="fin-amount ${f.type}">${f.type==='expense'?'-':'+'}${fmtMoney(f.amount)}</div>
      <div>${(f.type==='accrual' && f.status==='pending') ? `<button class="icon-btn" title="Mark settled" data-settle="${f.id}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></button>` : ''}</div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.finance-table-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('[data-settle]')) return;
      openFinanceModal(row.dataset.id);
    });
  });
  listEl.querySelectorAll('[data-settle]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await markAccrualSettled(btn.dataset.settle);
    });
  });
}

function renderPettyCashTable(companyId) {
  const listEl = el('pettycash-table-list');
  const entries = allPettyCash.filter(t => !companyId || t.companyId === companyId);
  if (!entries.length) { listEl.innerHTML = '<div class="empty-state">No petty cash transactions yet.</div>'; return; }
  // Compute running balance chronologically (oldest first), then display newest first
  const chrono = [...entries].sort((a,b) => new Date(a.date||0) - new Date(b.date||0) || ts(a)-ts(b));
  let running = 0;
  const withBalance = chrono.map(t => {
    running += t.txType==='topup' ? (Number(t.amount)||0) : -(Number(t.amount)||0);
    return { ...t, _balance: running };
  });
  const display = [...withBalance].reverse();
  listEl.innerHTML = display.map(t => `
    <div class="pettycash-table-row" data-id="${t.id}">
      <div style="font-size:.8125rem;color:var(--text-muted)">${esc(t.date||'')}</div>
      <div style="font-weight:500">${esc(t.description || '—')}</div>
      <div style="font-size:.8125rem;color:var(--text-muted)">${esc(t.category||'—')}</div>
      <div><span class="fin-type-badge ${t.txType==='topup'?'income':'expense'}">${t.txType==='topup'?'In':'Out'}</span></div>
      <div class="fin-amount ${t.txType==='topup'?'income':'expense'}">${t.txType==='topup'?'+':'-'}${fmtMoney(t.amount)}</div>
      <div class="fin-amount" style="color:var(--text)">${fmtMoney(t._balance)}</div>
      <div style="font-size:.8125rem;color:var(--text-muted)">${esc(t.createdByName||'')}</div>
    </div>`).join('');
  listEl.querySelectorAll('.pettycash-table-row').forEach(row => row.addEventListener('click', () => openPettyCashModal(row.dataset.id)));
}

function switchFinTab(name) {
  document.querySelectorAll('.fin-tab').forEach(t => t.classList.toggle('active', t.dataset.fintab===name));
  document.querySelectorAll('.fin-tab-panel').forEach(p => p.classList.toggle('active', p.id===`fintab-${name}`));
}

function setFinType(type) {
  currentFinType = type;
  document.querySelectorAll('#finance-type-selector .type-opt').forEach(b => b.classList.toggle('active', b.dataset.fintype===type));
  el('fin-accrual-row').style.display = type==='accrual' ? '' : 'none';
  el('fin-category-list').innerHTML = (FIN_CATEGORIES[type]||[]).map(c => `<option value="${esc(c)}"></option>`).join('');
}

function setPcType(type) {
  currentPcType = type;
  document.querySelectorAll('#pettycash-type-selector .type-opt').forEach(b => b.classList.toggle('active', b.dataset.pctype===type));
  el('pc-category-row').style.display = type==='expense' ? '' : 'none';
}

function openFinanceModal(id) {
  currentFinanceId = id;
  el('finance-id').value = id || '';
  el('delete-finance-btn').style.display = id ? '' : 'none';
  if (id) {
    const f = allFinance.find(x => x.id === id);
    if (!f) return;
    el('finance-modal-title').textContent = 'Edit Finance Entry';
    setFinType(f.type||'income');
    el('fin-amount').value = f.amount || '';
    el('fin-date').value = f.date || '';
    el('fin-category').value = f.category || '';
    el('fin-payment-method').value = f.paymentMethod || '';
    el('fin-company').value = f.companyId || '';
    populateCascadingProjectSelect('fin-project', 'fin-company');
    el('fin-project').value = f.projectId || '';
    el('fin-description').value = f.description || '';
    el('fin-accrual-direction').value = f.accrualDirection || 'receivable';
    el('fin-status').value = f.status || 'pending';
  } else {
    el('finance-modal-title').textContent = 'New Finance Entry';
    setFinType('income');
    el('fin-amount').value = '';
    el('fin-date').value = new Date().toISOString().split('T')[0];
    el('fin-category').value = '';
    el('fin-payment-method').value = '';
    el('fin-company').value = el('finance-company-filter')?.value || activeCompanyId || '';
    populateCascadingProjectSelect('fin-project', 'fin-company');
    el('fin-project').value = el('finance-project-filter')?.value || '';
    el('fin-description').value = '';
    el('fin-accrual-direction').value = 'receivable';
    el('fin-status').value = 'pending';
  }
  showModal('finance-modal-overlay');
}

function openPettyCashModal(id) {
  currentPettyCashId = id;
  el('pettycash-id').value = id || '';
  el('delete-pettycash-btn').style.display = id ? '' : 'none';
  if (id) {
    const t = allPettyCash.find(x => x.id === id);
    if (!t) return;
    el('pettycash-modal-title').textContent = 'Edit Petty Cash Transaction';
    setPcType(t.txType||'topup');
    el('pc-amount').value = t.amount || '';
    el('pc-date').value = t.date || '';
    el('pc-category').value = t.category || '';
    el('pc-description').value = t.description || '';
  } else {
    el('pettycash-modal-title').textContent = 'Petty Cash Transaction';
    setPcType('topup');
    el('pc-amount').value = '';
    el('pc-date').value = new Date().toISOString().split('T')[0];
    el('pc-category').value = '';
    el('pc-description').value = '';
  }
  showModal('pettycash-modal-overlay');
}

async function createFinanceEntry(data) {
  try { await addDoc(collection(db,'financeEntries'), { ...data, createdBy: currentUser.uid, createdByName: userProfile?.name||currentUser.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); showToast('Finance entry saved!','success'); }
  catch { showToast('Failed to save entry.','error'); throw new Error(); }
}
async function updateFinanceEntry(id, data) {
  try { await updateDoc(doc(db,'financeEntries',id), { ...data, updatedAt: serverTimestamp() }); showToast('Entry updated!','success'); }
  catch { showToast('Update failed.','error'); }
}
async function deleteFinanceEntry(id) {
  try { await deleteDoc(doc(db,'financeEntries',id)); showToast('Entry deleted.','warning'); }
  catch { showToast('Delete failed.','error'); }
}
async function markAccrualSettled(id) {
  try { await updateDoc(doc(db,'financeEntries',id), { status: 'settled', settledAt: serverTimestamp(), updatedAt: serverTimestamp() }); showToast('Marked as settled!','success'); }
  catch { showToast('Failed to update.','error'); }
}

async function createPettyCashTx(data) {
  try { await addDoc(collection(db,'pettyCash'), { ...data, createdBy: currentUser.uid, createdByName: userProfile?.name||currentUser.email, createdAt: serverTimestamp() }); showToast('Petty cash transaction saved!','success'); }
  catch { showToast('Failed to save transaction.','error'); throw new Error(); }
}
async function updatePettyCashTx(id, data) {
  try { await updateDoc(doc(db,'pettyCash',id), data); showToast('Transaction updated!','success'); }
  catch { showToast('Update failed.','error'); }
}
async function deletePettyCashTx(id) {
  try { await deleteDoc(doc(db,'pettyCash',id)); showToast('Transaction deleted.','warning'); }
  catch { showToast('Delete failed.','error'); }
}

function exportFinanceCSV() {
  const entries = getFilteredFinance();
  const headers = ['Date','Type','Status','Category','Description','Amount','Payment Method','Company','Project'];
  const companyName = id => allCompanies.find(c=>c.id===id)?.name || '';
  const projectName = f => f.projectId ? (allProjects.find(p=>p.id===f.projectId)?.name || f.project || '') : (f.project || '');
  const rows = entries.map(f => [f.date||'', f.type, f.status||'', f.category||'', f.description||'', f.amount||0, f.paymentMethod||'', companyName(f.companyId), projectName(f)].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'finance.csv'; a.click();
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
    const pname = projectNameFor(task);
    if (pname) { proj.textContent = pname; proj.style.display=''; } else proj.style.display='none';
    el('view-desc').textContent = task.description || 'No description provided.';
    el('view-due').textContent = task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric',year:'numeric'}) : 'No due date';
    el('view-assigned').textContent = task.assignedTo || 'Unassigned';
    const co = allCompanies.find(c => c.id === task.companyId);
    el('view-company').textContent = co ? co.name : 'No company';
    renderAttachments(task);
    renderComments(task);
    renderActivityLog(task);
    renderTaskNotes(task);
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
  el('f-company').value = task.companyId||'';
  populateProjectSelects();
  el('f-project').value = task.projectId||'';
  el('f-assigned').value = task.assignedTo||'';
  el('f-recurring').checked = !!task.recurring;
}

function resetTaskForm() {
  el('task-form').reset();
  el('task-id').value='';
  el('f-company').value = activeCompanyId || '';
  populateProjectSelects();
  const kpf = el('kanban-project-filter')?.value;
  if (kpf && currentView === 'kanban') {
    const proj = allProjects.find(p => p.id === kpf);
    if (proj) { el('f-company').value = proj.companyId || ''; populateProjectSelects(); el('f-project').value = kpf; }
  }
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

// ─── Sticky Notes (linked to a task) ──────────────────────
function renderTaskNotes(task) {
  const listEl = el('task-notes-list');
  if (!listEl || !task) return;
  const linked = allNotes.filter(n => n.taskId === task.id);
  listEl.innerHTML = linked.length ? linked.map(n => `
    <div class="sticky-note-chip" style="background:${n.color||'#2563eb'}18;border-color:${n.color||'#2563eb'}55" data-id="${n.id}">
      <button class="sticky-note-unlink" data-id="${n.id}" title="Unlink from this task">&times;</button>
      <div class="sticky-note-chip-title">${esc(n.title||'Untitled')}</div>
      <div class="sticky-note-chip-preview">${esc(stripHtml(n.content).slice(0,90)) || 'No content'}</div>
    </div>`).join('') : '<span style="font-size:.8125rem;color:var(--text-light)">No sticky notes attached yet.</span>';
  listEl.querySelectorAll('.sticky-note-chip').forEach(chip => {
    chip.addEventListener('click', e => {
      if (e.target.closest('.sticky-note-unlink')) return;
      openNoteModal(chip.dataset.id);
    });
  });
  listEl.querySelectorAll('.sticky-note-unlink').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      try { await updateDoc(doc(db,'notes',btn.dataset.id), { taskId: null }); showToast('Note unlinked.','warning'); }
      catch { showToast('Failed to unlink.','error'); }
    });
  });
  populateLinkNoteSelect(task.id);
}

function populateLinkNoteSelect(taskId) {
  const sel = el('link-note-select');
  if (!sel) return;
  const linkable = allNotes.filter(n => !n.taskId || n.taskId === taskId).filter(n => n.taskId !== taskId);
  sel.innerHTML = '<option value="">Link an existing note…</option>' + linkable.map(n => `<option value="${n.id}">${esc(n.title||'Untitled')}</option>`).join('');
}

// ─── Note Modal ──────────────────────────────────────────
function openNoteModal(id, prefillTaskId) {
  currentNoteId = id || null;
  const note = id ? allNotes.find(n => n.id === id) : null;
  el('note-modal-title').textContent = note ? 'Edit Note' : 'New Note';
  el('note-id').value = note?.id || '';
  el('note-title').value = note?.title || '';
  el('note-category').value = note?.category || (prefillTaskId ? 'project' : 'general');
  el('note-color').value = note?.color || '#2563eb';
  el('note-content').innerHTML = note?.content || '';
  el('delete-note-btn').style.display = note ? 'flex' : 'none';
  const taskId = note ? (note.taskId || '') : (prefillTaskId || '');
  el('note-task-id').value = taskId;
  updateNoteTaskBanner(taskId);
  showModal('note-modal-overlay');
}

function updateNoteTaskBanner(taskId) {
  const banner = el('note-task-link-banner');
  if (!banner) return;
  if (taskId) {
    const t = allTasks.find(t => t.id === taskId);
    el('note-task-link-title').textContent = t ? t.title : 'Untitled task';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
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
  el('co-budget').value = co?.budget || '';
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

  // Cascading Company ↔ Project fields in the task form: picking a company
  // narrows the project list to that company's projects; picking a project
  // snaps the company field to match (a project always belongs to one company).
  el('f-company').addEventListener('change', () => { populateProjectSelects(); });
  el('f-project').addEventListener('change', () => {
    const pid = el('f-project').value;
    const proj = pid ? allProjects.find(p => p.id === pid) : null;
    if (proj) el('f-company').value = proj.companyId || '';
  });

  // Save task
  el('save-task-btn').addEventListener('click', async () => {
    const title = el('f-title').value.trim();
    if (!title) { showToast('Title is required.','error'); return; }
    const saveBtn = el('save-task-btn');
    saveBtn.disabled = true;
    saveBtn.querySelector('.btn-loader').classList.remove('hidden');
    saveBtn.querySelector('.btn-text').classList.add('hidden');
    const projectId = el('f-project').value;
    const proj = projectId ? allProjects.find(p => p.id === projectId) : null;
    // A chosen project owns the company relationship; otherwise fall back to
    // whatever was picked directly in the Company field.
    const companyId = proj ? (proj.companyId || '') : el('f-company').value;
    const data = {
      title,
      description: el('f-desc').value.trim(),
      priority: el('f-priority').value,
      status: el('f-status').value,
      dueDate: el('f-due').value,
      projectId: projectId || null,
      project: proj ? proj.name : '',
      assignedTo: el('f-assigned').value.trim(),
      companyId,
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
    const data = { title, category: el('note-category').value, color: el('note-color').value, content: el('note-content').innerHTML, taskId: el('note-task-id').value || null, createdBy: currentUser.uid, updatedAt: serverTimestamp() };
    try {
      const nid = el('note-id').value;
      if (nid) await updateDoc(doc(db,'notes',nid), data);
      else { await addDoc(collection(db,'notes'), { ...data, createdAt: serverTimestamp() }); }
      hideModal('note-modal-overlay'); showToast('Note saved!','success');
    } catch { showToast('Save failed.','error'); }
    finally { btn.disabled=false; btn.querySelector('.btn-loader').classList.add('hidden'); btn.querySelector('.btn-text').classList.remove('hidden'); }
  });
  el('note-task-unlink-btn').addEventListener('click', async () => {
    const nid = el('note-id').value;
    if (nid) {
      try { await updateDoc(doc(db,'notes',nid), { taskId: null }); showToast('Note unlinked.','warning'); } catch { showToast('Failed to unlink.','error'); }
    }
    el('note-task-id').value = '';
    updateNoteTaskBanner('');
  });
  document.querySelectorAll('.editor-btn').forEach(btn => {
    btn.addEventListener('click', () => { document.execCommand(btn.dataset.cmd, false, null); btn.classList.toggle('active'); });
  });

  // Sticky notes linked to the currently open task
  el('new-sticky-note-btn').addEventListener('click', () => {
    if (!currentTaskId) { showToast('Save the task first.','warning'); return; }
    openNoteModal(null, currentTaskId);
  });
  el('link-note-btn').addEventListener('click', async () => {
    const nid = el('link-note-select').value;
    if (!nid || !currentTaskId) return;
    try { await updateDoc(doc(db,'notes',nid), { taskId: currentTaskId }); showToast('Note linked!','success'); }
    catch { showToast('Failed to link note.','error'); }
    el('link-note-select').value = '';
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
    const data = { name, industry: el('co-industry').value, website: el('co-website').value, description: el('co-desc').value, color: el('co-color').value, budget: parseFloat(el('co-budget').value) || 0, createdBy: currentUser.uid };
    try {
      const cid = el('company-id').value;
      if (cid) await updateDoc(doc(db,'companies',cid), data);
      else await addDoc(collection(db,'companies'), { ...data, createdAt: serverTimestamp() });
      hideModal('company-modal-overlay'); showToast('Company saved!','success');
    } catch { showToast('Save failed.','error'); }
    finally { btn.disabled=false; btn.querySelector('.btn-loader').classList.add('hidden'); btn.querySelector('.btn-text').classList.remove('hidden'); }
  });

  // Company switcher dropdown
  el('company-switcher').addEventListener('click', e => {
    e.stopPropagation();
    const dd = el('company-dropdown');
    const opening = dd.classList.contains('hidden');
    dd.classList.toggle('hidden');
    el('company-switcher').classList.toggle('open', opening);
  });
  document.querySelector('.company-dropdown-item[data-company-id=""]').addEventListener('click', () => setActiveCompany(''));
  el('company-dropdown-manage').addEventListener('click', () => {
    el('company-dropdown').classList.add('hidden');
    el('company-switcher').classList.remove('open');
    switchView('companies');
    if (window.innerWidth <= 768) closeSidebar();
  });
  document.addEventListener('click', e => {
    const dd = el('company-dropdown');
    if (!dd.classList.contains('hidden') && !dd.contains(e.target) && !el('company-switcher').contains(e.target)) {
      dd.classList.add('hidden');
      el('company-switcher').classList.remove('open');
    }
  });

  // Projects
  el('new-project-btn')?.addEventListener('click', () => openProjectModal(null));
  el('add-project-btn').addEventListener('click', () => openProjectModal(null));
  el('project-close-btn').addEventListener('click', () => hideModal('project-modal-overlay'));
  el('project-cancel-btn').addEventListener('click', () => hideModal('project-modal-overlay'));
  el('project-modal-overlay').addEventListener('click', e => { if (e.target===el('project-modal-overlay')) hideModal('project-modal-overlay'); });
  el('pr-company').addEventListener('change', () => renderProjectColorSwatches(el('pr-color').value));
  el('projects-company-filter')?.addEventListener('change', renderProjectsGrid);
  el('delete-project-btn').addEventListener('click', async () => {
    if (!currentProjectId) return;
    await deleteProject(currentProjectId);
    hideModal('project-modal-overlay');
  });
  el('save-project-btn').addEventListener('click', async () => {
    const name = el('pr-name-input').value.trim();
    if (!name) { showToast('Project name required.','error'); return; }
    const btn = el('save-project-btn');
    btn.disabled=true; btn.querySelector('.btn-loader').classList.remove('hidden'); btn.querySelector('.btn-text').classList.add('hidden');
    const data = { name, companyId: el('pr-company').value, description: el('pr-desc').value.trim(), color: el('pr-color').value, budget: parseFloat(el('pr-budget').value) || 0, archived: el('pr-archived').checked };
    try {
      const pid = el('project-id').value;
      if (pid) await updateProject(pid, data);
      else await createProject(data);
      hideModal('project-modal-overlay');
    } finally { btn.disabled=false; btn.querySelector('.btn-loader').classList.add('hidden'); btn.querySelector('.btn-text').classList.remove('hidden'); }
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
    window.location.href = 'index.html';
  });

  // Calendar nav
  el('cal-prev').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth()-1); renderCalendar(); });
  el('cal-next').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth()+1); renderCalendar(); });

  // Mobile sidebar
  el('menu-btn').addEventListener('click', () => { el('sidebar').classList.add('open'); el('sidebar-overlay').classList.remove('hidden'); });
  el('sidebar-close').addEventListener('click', closeSidebar);
  el('sidebar-overlay').addEventListener('click', closeSidebar);

  // Export CSV
  el('export-tasks-btn')?.addEventListener('click', exportCSV);

  // Finance
  document.querySelectorAll('.fin-tab').forEach(tab => tab.addEventListener('click', () => switchFinTab(tab.dataset.fintab)));
  document.querySelectorAll('#finance-type-selector .type-opt').forEach(btn => btn.addEventListener('click', () => setFinType(btn.dataset.fintype)));
  document.querySelectorAll('#pettycash-type-selector .type-opt').forEach(btn => btn.addEventListener('click', () => setPcType(btn.dataset.pctype)));

  el('new-finance-btn').addEventListener('click', () => openFinanceModal(null));
  el('finance-close-btn').addEventListener('click', () => hideModal('finance-modal-overlay'));
  el('finance-cancel-btn').addEventListener('click', () => hideModal('finance-modal-overlay'));
  el('finance-modal-overlay').addEventListener('click', e => { if (e.target===el('finance-modal-overlay')) hideModal('finance-modal-overlay'); });
  el('delete-finance-btn').addEventListener('click', async () => {
    if (!currentFinanceId || !confirm('Delete this finance entry?')) return;
    await deleteFinanceEntry(currentFinanceId);
    hideModal('finance-modal-overlay');
  });
  el('save-finance-btn').addEventListener('click', async () => {
    const amount = parseFloat(el('fin-amount').value);
    const date = el('fin-date').value;
    if (!amount || amount <= 0) { showToast('Enter a valid amount.','error'); return; }
    if (!date) { showToast('Date is required.','error'); return; }
    const btn = el('save-finance-btn');
    btn.disabled = true; btn.querySelector('.btn-loader').classList.remove('hidden'); btn.querySelector('.btn-text').classList.add('hidden');
    const finProjectId = el('fin-project').value;
    const finProj = finProjectId ? allProjects.find(p => p.id === finProjectId) : null;
    // A chosen project owns the company relationship, same rule as tasks.
    const finCompanyId = finProj ? (finProj.companyId || '') : el('fin-company').value;
    const data = {
      type: currentFinType,
      amount,
      date,
      category: el('fin-category').value.trim(),
      paymentMethod: el('fin-payment-method').value,
      companyId: finCompanyId,
      projectId: finProjectId || null,
      project: finProj ? finProj.name : '',
      description: el('fin-description').value.trim(),
    };
    if (currentFinType === 'accrual') {
      data.accrualDirection = el('fin-accrual-direction').value;
      data.status = el('fin-status').value;
    } else {
      data.status = null;
      data.accrualDirection = null;
    }
    try {
      const fid = el('finance-id').value;
      if (fid) await updateFinanceEntry(fid, data);
      else await createFinanceEntry(data);
      hideModal('finance-modal-overlay');
    } finally {
      btn.disabled = false; btn.querySelector('.btn-loader').classList.add('hidden'); btn.querySelector('.btn-text').classList.remove('hidden');
    }
  });
  // Cascading Company ↔ Project fields in the finance form, mirroring the task form.
  el('fin-company').addEventListener('change', () => populateCascadingProjectSelect('fin-project', 'fin-company'));
  el('fin-project').addEventListener('change', () => {
    const pid = el('fin-project').value;
    const proj = pid ? allProjects.find(p => p.id === pid) : null;
    if (proj) el('fin-company').value = proj.companyId || '';
  });
  el('finance-company-filter').addEventListener('change', () => { populateFinanceProjectFilter(); renderFinance(); });
  el('finance-project-filter').addEventListener('change', renderFinance);
  el('finance-type-filter').addEventListener('change', renderFinance);
  el('finance-status-filter').addEventListener('change', renderFinance);
  el('finance-month-filter').addEventListener('change', renderFinance);
  el('export-finance-btn').addEventListener('click', exportFinanceCSV);

  // Petty Cash
  el('new-pettycash-btn').addEventListener('click', () => openPettyCashModal(null));
  el('pettycash-close-btn').addEventListener('click', () => hideModal('pettycash-modal-overlay'));
  el('pettycash-cancel-btn').addEventListener('click', () => hideModal('pettycash-modal-overlay'));
  el('pettycash-modal-overlay').addEventListener('click', e => { if (e.target===el('pettycash-modal-overlay')) hideModal('pettycash-modal-overlay'); });
  el('delete-pettycash-btn').addEventListener('click', async () => {
    if (!currentPettyCashId || !confirm('Delete this petty cash transaction?')) return;
    await deletePettyCashTx(currentPettyCashId);
    hideModal('pettycash-modal-overlay');
  });
  el('save-pettycash-btn').addEventListener('click', async () => {
    const amount = parseFloat(el('pc-amount').value);
    const date = el('pc-date').value;
    if (!amount || amount <= 0) { showToast('Enter a valid amount.','error'); return; }
    if (!date) { showToast('Date is required.','error'); return; }
    const btn = el('save-pettycash-btn');
    btn.disabled = true; btn.querySelector('.btn-loader').classList.remove('hidden'); btn.querySelector('.btn-text').classList.add('hidden');
    const data = {
      txType: currentPcType,
      amount,
      date,
      category: currentPcType==='expense' ? el('pc-category').value.trim() : '',
      description: el('pc-description').value.trim(),
    };
    try {
      const pid = el('pettycash-id').value;
      if (pid) await updatePettyCashTx(pid, data);
      else await createPettyCashTx(data);
      hideModal('pettycash-modal-overlay');
    } finally {
      btn.disabled = false; btn.querySelector('.btn-loader').classList.add('hidden'); btn.querySelector('.btn-text').classList.remove('hidden');
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key==='Escape') { hideModal('task-modal-overlay'); hideModal('note-modal-overlay'); hideModal('meeting-modal-overlay'); hideModal('company-modal-overlay'); hideModal('project-modal-overlay'); hideModal('invite-modal-overlay'); hideModal('finance-modal-overlay'); hideModal('pettycash-modal-overlay'); }
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
  if (name==='projects') renderProjectsGrid();
  if (name==='users') renderUsers();
  if (name==='reports') renderReports();
  if (name==='finance') renderFinance();
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
  const headers = ['Title','Description','Priority','Status','Due Date','Project','Company','Assigned To'];
  const rows = tasks.map(t => {
    const co = allCompanies.find(c => c.id === t.companyId);
    return [t.title,t.description||'',t.priority,statusLabel(t.status),t.dueDate||'',projectNameFor(t),co?co.name:'',t.assignedTo||''].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
  });
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
function stripHtml(html) { if(!html) return ''; return String(html).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
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
