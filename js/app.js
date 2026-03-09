// ============================================
// TaskFlow – Main Application Script
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, getDoc, arrayUnion, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";

// ─── Init ──────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ─── State ─────────────────────────────────
let currentUser = null;
let allTasks = [];
let unsubTasks = null;
let currentTaskId = null;
let isEditMode = false;
let calendarDate = new Date();
const PROJECT_COLORS = ['#2563eb','#8b5cf6','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899'];

// ─── Auth Guard ────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  initApp();
});

// ─── App Init ──────────────────────────────
function initApp() {
  // Set user info in sidebar
  const name = currentUser.displayName || currentUser.email.split('@')[0];
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-email').textContent = currentUser.email;
  document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('comment-avatar').textContent = name.charAt(0).toUpperCase();

  // Set today's date
  document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Bind UI events
  bindEvents();

  // Subscribe to tasks
  subscribeTasks();

  // Dark mode
  const savedTheme = localStorage.getItem('tf-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  // Check auth redirect
  if (window.location.pathname.includes('login') || window.location.pathname.includes('signup')) {
    window.location.href = 'dashboard.html';
  }
}

// ─── Firestore: Subscribe to Tasks ─────────
function subscribeTasks() {
  if (unsubTasks) unsubTasks();

  const q = query(
    collection(db, 'tasks'),
    where('createdBy', '==', currentUser.uid),
    orderBy('createdAt', 'desc')
  );

  unsubTasks = onSnapshot(q, (snap) => {
    allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
    checkNotifications();
  }, (err) => {
    // Fallback for missing index
    const q2 = query(collection(db, 'tasks'), where('createdBy', '==', currentUser.uid));
    unsubTasks = onSnapshot(q2, (snap) => {
      allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      });
      renderAll();
      checkNotifications();
    });
  });
}

// ─── Firebase CRUD ─────────────────────────
async function createTask(data) {
  try {
    const docRef = await addDoc(collection(db, 'tasks'), {
      ...data,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      comments: [],
      attachments: [],
      activityLog: [`Task created by ${currentUser.displayName || currentUser.email}`]
    });
    showToast('Task created!', 'success');
    return docRef.id;
  } catch (e) {
    showToast('Failed to create task.', 'error');
    throw e;
  }
}

async function updateTask(id, data) {
  try {
    await updateDoc(doc(db, 'tasks', id), { ...data, updatedAt: serverTimestamp() });
    showToast('Task updated!', 'success');
  } catch (e) {
    showToast('Failed to update task.', 'error');
    throw e;
  }
}

async function deleteTask(id) {
  try {
    await deleteDoc(doc(db, 'tasks', id));
    showToast('Task deleted.', 'warning');
  } catch (e) {
    showToast('Failed to delete task.', 'error');
    throw e;
  }
}

async function addComment(taskId, text) {
  const comment = {
    id: Date.now().toString(),
    text,
    userName: currentUser.displayName || currentUser.email.split('@')[0],
    userEmail: currentUser.email,
    createdAt: new Date().toISOString()
  };
  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      comments: arrayUnion(comment),
      updatedAt: serverTimestamp()
    });
    return comment;
  } catch (e) {
    showToast('Failed to add comment.', 'error');
    throw e;
  }
}

async function uploadAttachment(taskId, file) {
  try {
    const path = `attachments/${currentUser.uid}/${taskId}/${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    const attachment = { name: file.name, url, size: file.size, type: file.type };
    await updateDoc(doc(db, 'tasks', taskId), {
      attachments: arrayUnion(attachment),
      updatedAt: serverTimestamp()
    });
    showToast(`${file.name} uploaded!`, 'success');
    return attachment;
  } catch (e) {
    showToast('Upload failed. Check Firebase Storage rules.', 'error');
    throw e;
  }
}

// ─── Render All Views ──────────────────────
function renderAll() {
  const filtered = getFilteredTasks();
  renderStats(filtered);
  renderDashboard(filtered);
  renderKanban(filtered);
  renderAllTasks(filtered);
  renderCalendar();
  renderProjects();
  populateProjectFilter();
}

function getFilteredTasks() {
  const priority = document.getElementById('filter-priority')?.value || '';
  const project = document.getElementById('filter-project')?.value || '';
  return allTasks.filter(t => {
    if (priority && t.priority !== priority) return false;
    if (project && t.project !== project) return false;
    return true;
  });
}

// ─── Stats ─────────────────────────────────
function renderStats(tasks) {
  const now = new Date(); now.setHours(0,0,0,0);
  document.getElementById('stat-total').textContent = tasks.length;
  document.getElementById('stat-done').textContent = tasks.filter(t => t.status === 'completed').length;
  document.getElementById('stat-progress').textContent = tasks.filter(t => t.status === 'inprogress').length;
  document.getElementById('stat-overdue').textContent = tasks.filter(t => {
    if (!t.dueDate || t.status === 'completed') return false;
    return new Date(t.dueDate) < now;
  }).length;
}

// ─── Dashboard ─────────────────────────────
function renderDashboard(tasks) {
  // Recent tasks
  const recentEl = document.getElementById('recent-tasks');
  const recent = tasks.slice(0, 8);
  if (!recent.length) {
    recentEl.innerHTML = '<div class="empty-state">No tasks yet. Create your first task!</div>';
  } else {
    recentEl.innerHTML = recent.map(t => `
      <div class="recent-task-row" data-id="${t.id}">
        <div class="task-check ${t.status === 'completed' ? 'done' : ''}" data-id="${t.id}"></div>
        <span class="task-row-title ${t.status === 'completed' ? 'done-text' : ''}">${esc(t.title)}</span>
        <span class="priority-badge ${t.priority}">${t.priority || 'low'}</span>
      </div>
    `).join('');
    recentEl.querySelectorAll('.task-check').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const task = allTasks.find(t => t.id === el.dataset.id);
        if (task) await updateTask(task.id, { status: task.status === 'completed' ? 'todo' : 'completed' });
      });
    });
    recentEl.querySelectorAll('.recent-task-row').forEach(el => {
      el.addEventListener('click', () => openTask(el.dataset.id));
    });
  }

  // Upcoming deadlines
  const upcomingEl = document.getElementById('upcoming-list');
  const now = new Date(); now.setHours(0,0,0,0);
  const upcoming = tasks
    .filter(t => t.dueDate && t.status !== 'completed')
    .map(t => ({ ...t, dueDateObj: new Date(t.dueDate) }))
    .sort((a, b) => a.dueDateObj - b.dueDateObj)
    .slice(0, 7);

  if (!upcoming.length) {
    upcomingEl.innerHTML = '<div class="empty-state">No upcoming deadlines.</div>';
  } else {
    upcomingEl.innerHTML = upcoming.map(t => {
      const diff = Math.ceil((t.dueDateObj - now) / 86400000);
      let chipClass = 'soon', chipLabel = `${diff}d`;
      if (diff < 0) { chipClass = 'overdue'; chipLabel = `${Math.abs(diff)}d ago`; }
      else if (diff === 0) { chipClass = 'today'; chipLabel = 'Today'; }
      else if (diff === 1) { chipClass = 'today'; chipLabel = 'Tomorrow'; }
      return `<div class="upcoming-item" data-id="${t.id}">
        <span class="due-chip ${chipClass}">${chipLabel}</span>
        <span style="flex:1;font-size:.875rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</span>
      </div>`;
    }).join('');
    upcomingEl.querySelectorAll('.upcoming-item').forEach(el => {
      el.addEventListener('click', () => openTask(el.dataset.id));
    });
  }
}

// ─── Kanban ────────────────────────────────
function renderKanban(tasks) {
  const cols = ['todo', 'inprogress', 'review', 'completed'];
  cols.forEach(status => {
    const col = document.getElementById(`col-${status}`);
    const colTasks = tasks.filter(t => t.status === status);
    document.getElementById(`count-${status}`).textContent = colTasks.length;
    col.innerHTML = colTasks.map(t => buildTaskCard(t)).join('');
    col.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', () => openTask(card.dataset.id));
      setupDrag(card);
    });
    setupDrop(col);
  });
}

function buildTaskCard(t) {
  const now = new Date(); now.setHours(0,0,0,0);
  let dueLabel = '', dueClass = '';
  if (t.dueDate) {
    const due = new Date(t.dueDate);
    const diff = Math.ceil((due - now) / 86400000);
    if (diff < 0) { dueLabel = `Overdue ${Math.abs(diff)}d`; dueClass = 'overdue'; }
    else if (diff === 0) { dueLabel = 'Due today'; dueClass = 'today'; }
    else if (diff === 1) { dueLabel = 'Due tomorrow'; dueClass = 'today'; }
    else { dueLabel = `Due ${due.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`; }
  }
  const commentCount = (t.comments || []).length;
  return `
    <div class="task-card" data-id="${t.id}" draggable="true">
      <div class="card-top">
        <span class="card-title-text ${t.status==='completed'?'done-text':''}">${esc(t.title)}</span>
        <div class="priority-dot ${t.priority || 'low'}"></div>
      </div>
      ${t.description ? `<p class="card-desc">${esc(t.description)}</p>` : ''}
      <div class="card-footer">
        ${dueLabel ? `<span class="card-due ${dueClass}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${dueLabel}</span>` : '<span></span>'}
        <div style="display:flex;gap:.375rem;align-items:center;">
          ${t.project ? `<span class="card-project">${esc(t.project)}</span>` : ''}
          ${commentCount ? `<span class="card-comment-count">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            ${commentCount}</span>` : ''}
        </div>
      </div>
    </div>`;
}

// ─── Drag & Drop ───────────────────────────
let dragId = null;

function setupDrag(card) {
  card.addEventListener('dragstart', (e) => {
    dragId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.col-cards').forEach(c => c.classList.remove('drag-over'));
  });
}

function setupDrop(col) {
  col.addEventListener('dragover', (e) => {
    e.preventDefault();
    col.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
  });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drag-over');
    if (!dragId) return;
    const newStatus = col.dataset.status;
    const task = allTasks.find(t => t.id === dragId);
    if (task && task.status !== newStatus) {
      await updateTask(dragId, { status: newStatus });
    }
    dragId = null;
  });
}

// ─── All Tasks Table ───────────────────────
function renderAllTasks(tasks) {
  const el = document.getElementById('all-tasks-list');
  if (!tasks.length) {
    el.innerHTML = '<div class="empty-state" style="padding:3rem">No tasks found. Create your first task!</div>';
    return;
  }
  el.innerHTML = `
    <div class="task-list-row header-row">
      <div></div>
      <div>Title</div>
      <div>Priority</div>
      <div>Status</div>
      <div>Due Date</div>
      <div>Project</div>
    </div>
    ${tasks.map(t => {
      const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—';
      return `<div class="task-list-row" data-id="${t.id}">
        <div class="task-check ${t.status==='completed'?'done':''}" data-id="${t.id}"></div>
        <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${t.status==='completed'?'text-decoration:line-through;color:var(--text-light)':''}">${esc(t.title)}</div>
        <div><span class="priority-badge ${t.priority||'low'}">${t.priority||'low'}</span></div>
        <div><span class="status-badge ${t.status||'todo'}">${statusLabel(t.status)}</span></div>
        <div style="color:var(--text-muted);font-size:.82rem">${due}</div>
        <div>${t.project?`<span class="project-tag">${esc(t.project)}</span>`:''}</div>
      </div>`;
    }).join('')}`;

  el.querySelectorAll('.task-check').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const task = allTasks.find(t => t.id === el.dataset.id);
      if (task) await updateTask(task.id, { status: task.status === 'completed' ? 'todo' : 'completed' });
    });
  });
  el.querySelectorAll('.task-list-row:not(.header-row)').forEach(row => {
    row.addEventListener('click', () => openTask(row.dataset.id));
  });
}

// ─── Calendar ──────────────────────────────
function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  document.getElementById('cal-month-label').textContent =
    new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const today = new Date();

  const tasksByDate = {};
  allTasks.forEach(t => {
    if (t.dueDate) {
      tasksByDate[t.dueDate] = tasksByDate[t.dueDate] || [];
      tasksByDate[t.dueDate].push(t);
    }
  });

  let html = '<div class="cal-weekdays">';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
    html += `<div class="cal-weekday">${d}</div>`;
  });
  html += '</div><div class="cal-days">';

  // Prev month
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month"><div class="cal-day-num">${daysInPrev - i}</div></div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = today.getFullYear()===year && today.getMonth()===month && today.getDate()===d;
    const dayTasks = tasksByDate[dateStr] || [];
    html += `<div class="cal-day${isToday?' today':''}">
      <div class="cal-day-num">${d}</div>
      ${dayTasks.slice(0,3).map(t => {
        const color = t.priority==='high'?'#fee2e2,#b91c1c':t.priority==='medium'?'#fef3c7,#b45309':'#dcfce7,#15803d';
        const [bg,fg] = color.split(',');
        return `<div class="cal-task-dot" style="background:${bg};color:${fg}" data-id="${t.id}" title="${esc(t.title)}">${esc(t.title)}</div>`;
      }).join('')}
      ${dayTasks.length > 3 ? `<div style="font-size:.65rem;color:var(--text-light)">+${dayTasks.length-3} more</div>` : ''}
    </div>`;
  }

  // Next month
  const total = firstDay + daysInMonth;
  const remaining = (7 - (total % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    html += `<div class="cal-day other-month"><div class="cal-day-num">${d}</div></div>`;
  }
  html += '</div>';
  grid.innerHTML = html;
  grid.querySelectorAll('.cal-task-dot').forEach(el => {
    el.addEventListener('click', () => openTask(el.dataset.id));
  });
}

// ─── Projects Sidebar ──────────────────────
function renderProjects() {
  const projects = [...new Set(allTasks.map(t => t.project).filter(Boolean))];
  const el = document.getElementById('project-list');
  el.innerHTML = projects.map((p, i) => `
    <div class="project-item" data-project="${esc(p)}">
      <div class="project-dot" style="background:${PROJECT_COLORS[i % PROJECT_COLORS.length]}"></div>
      <span>${esc(p)}</span>
    </div>`).join('');
  el.querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => {
      document.getElementById('filter-project').value = item.dataset.project;
      renderAll();
      if (window.innerWidth <= 768) closeSidebar();
    });
  });
}

function populateProjectFilter() {
  const projects = [...new Set(allTasks.map(t => t.project).filter(Boolean))];
  const sel = document.getElementById('filter-project');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Projects</option>' +
    projects.map(p => `<option value="${esc(p)}" ${current===p?'selected':''}>${esc(p)}</option>`).join('');
}

// ─── Notifications ─────────────────────────
function checkNotifications() {
  const now = new Date(); now.setHours(0,0,0,0);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const notifs = [];

  allTasks.forEach(t => {
    if (!t.dueDate || t.status === 'completed') return;
    const due = new Date(t.dueDate);
    if (due < now) notifs.push({ type: 'overdue', task: t, color: '#ef4444' });
    else if (due.toDateString() === now.toDateString()) notifs.push({ type: 'today', task: t, color: '#f59e0b' });
    else if (due.toDateString() === tomorrow.toDateString()) notifs.push({ type: 'tomorrow', task: t, color: '#3b82f6' });
  });

  const badge = document.getElementById('notif-badge');
  const dropdown = document.getElementById('notif-dropdown');
  badge.textContent = notifs.length;
  badge.classList.toggle('hidden', notifs.length === 0);

  dropdown.innerHTML = `<div class="notif-header">Notifications (${notifs.length})</div>` +
    (notifs.length ? notifs.map(n => `
      <div class="notif-item" data-id="${n.task.id}">
        <div class="notif-dot" style="background:${n.color}"></div>
        <div>
          <div style="font-weight:500;color:var(--text);font-size:.82rem">${esc(n.task.title)}</div>
          <div>${n.type==='overdue'?'⚠️ Overdue':n.type==='today'?'📅 Due today':'🔔 Due tomorrow'}</div>
        </div>
      </div>`).join('') : '<div class="notif-item">All caught up! 🎉</div>');

  dropdown.querySelectorAll('.notif-item[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      openTask(el.dataset.id);
      dropdown.classList.add('hidden');
    });
  });
}

// ─── Task Modal ────────────────────────────
function openTask(id, defaultStatus = 'todo') {
  const task = allTasks.find(t => t.id === id);
  currentTaskId = id || null;

  const overlay = document.getElementById('task-modal-overlay');
  overlay.classList.remove('hidden');

  if (task) {
    // View mode
    document.getElementById('modal-title').textContent = task.title;
    document.getElementById('view-priority').className = `priority-badge ${task.priority||'low'}`;
    document.getElementById('view-priority').textContent = task.priority || 'low';
    document.getElementById('view-status').className = `status-badge ${task.status||'todo'}`;
    document.getElementById('view-status').textContent = statusLabel(task.status);
    document.getElementById('view-project').textContent = task.project || '';
    document.getElementById('view-project').style.display = task.project ? 'inline-flex' : 'none';
    document.getElementById('view-desc').textContent = task.description || 'No description provided.';
    document.getElementById('view-due').textContent = task.dueDate
      ? new Date(task.dueDate).toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric',year:'numeric'})
      : 'No due date';
    document.getElementById('view-assigned').textContent = task.assignedTo || 'Unassigned';
    renderAttachments(task);
    renderComments(task);
    showModalView();
    document.getElementById('modal-edit-btn').style.display = 'flex';
    document.getElementById('modal-delete-btn').style.display = 'flex';
  } else {
    // New task – go straight to edit
    openNewTaskModal(defaultStatus);
  }
}

function openNewTaskModal(defaultStatus = 'todo') {
  currentTaskId = null;
  document.getElementById('modal-title').textContent = 'New Task';
  document.getElementById('modal-edit-btn').style.display = 'none';
  document.getElementById('modal-delete-btn').style.display = 'none';
  resetTaskForm();
  document.getElementById('f-status').value = defaultStatus;
  showModalEdit();
  document.getElementById('task-modal-overlay').classList.remove('hidden');
}

function showModalView() {
  document.getElementById('modal-view').classList.remove('hidden');
  document.getElementById('modal-edit').classList.add('hidden');
}
function showModalEdit() {
  document.getElementById('modal-view').classList.add('hidden');
  document.getElementById('modal-edit').classList.remove('hidden');
}

function populateEditForm(task) {
  document.getElementById('task-id').value = task.id;
  document.getElementById('f-title').value = task.title || '';
  document.getElementById('f-desc').value = task.description || '';
  document.getElementById('f-priority').value = task.priority || 'medium';
  document.getElementById('f-status').value = task.status || 'todo';
  document.getElementById('f-due').value = task.dueDate || '';
  document.getElementById('f-project').value = task.project || '';
  document.getElementById('f-assigned').value = task.assignedTo || '';
  document.getElementById('f-recurring').checked = task.recurring || false;
}

function resetTaskForm() {
  document.getElementById('task-form').reset();
  document.getElementById('task-id').value = '';
}

function renderAttachments(task) {
  const el = document.getElementById('view-attachments');
  const list = task.attachments || [];
  el.innerHTML = list.map(a => `
    <a href="${a.url}" target="_blank" class="attachment-chip">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      ${esc(a.name)}
    </a>`).join('') || '<span style="font-size:.8rem;color:var(--text-light)">No attachments</span>';
}

function renderComments(task) {
  const comments = task.comments || [];
  document.getElementById('comment-count').textContent = `(${comments.length})`;
  const el = document.getElementById('comments-list');
  if (!comments.length) {
    el.innerHTML = '<div style="font-size:.82rem;color:var(--text-light)">No comments yet. Be the first!</div>';
    return;
  }
  el.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="avatar sm">${(c.userName || 'U').charAt(0).toUpperCase()}</div>
      <div class="comment-body">
        <div class="comment-meta">
          <strong>${esc(c.userName || 'User')}</strong>
          · ${formatTime(c.createdAt)}
        </div>
        <div class="comment-text">${esc(c.text)}</div>
      </div>
    </div>`).join('');
}

// ─── Event Bindings ────────────────────────
function bindEvents() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      switchView(view);
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // New task button
  document.getElementById('new-task-btn').addEventListener('click', () => openNewTaskModal());

  // Add task buttons in kanban columns
  document.querySelectorAll('.add-card-btn').forEach(btn => {
    btn.addEventListener('click', () => openNewTaskModal(btn.dataset.status));
  });

  // Modal close
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('task-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Modal edit button
  document.getElementById('modal-edit-btn').addEventListener('click', () => {
    const task = allTasks.find(t => t.id === currentTaskId);
    if (task) {
      populateEditForm(task);
      showModalEdit();
    }
  });

  // Modal delete button
  document.getElementById('modal-delete-btn').addEventListener('click', async () => {
    if (!currentTaskId) return;
    if (confirm('Delete this task? This cannot be undone.')) {
      await deleteTask(currentTaskId);
      closeModal();
    }
  });

  // Cancel edit
  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    if (currentTaskId) showModalView();
    else closeModal();
  });

  // Task form submit
  document.getElementById('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('f-title').value.trim();
    if (!title) { showToast('Task title is required.', 'error'); return; }
    const saveBtn = document.getElementById('save-task-btn');
    saveBtn.disabled = true;
    saveBtn.querySelector('.btn-loader').classList.remove('hidden');
    saveBtn.querySelector('.btn-text').classList.add('hidden');
    const data = {
      title,
      description: document.getElementById('f-desc').value.trim(),
      priority: document.getElementById('f-priority').value,
      status: document.getElementById('f-status').value,
      dueDate: document.getElementById('f-due').value,
      project: document.getElementById('f-project').value.trim(),
      assignedTo: document.getElementById('f-assigned').value.trim(),
      recurring: document.getElementById('f-recurring').checked
    };
    try {
      const tid = document.getElementById('task-id').value;
      if (tid) {
        await updateTask(tid, data);
        currentTaskId = tid;
        showModalView();
      } else {
        const newId = await createTask(data);
        currentTaskId = newId;
        // Wait briefly for snapshot to arrive then open
        setTimeout(() => {
          const t = allTasks.find(t => t.id === newId);
          if (t) { populateEditForm(t); openTask(newId); }
          else closeModal();
        }, 600);
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.querySelector('.btn-loader').classList.add('hidden');
      saveBtn.querySelector('.btn-text').classList.remove('hidden');
    }
  });

  // Comment
  document.getElementById('add-comment-btn').addEventListener('click', async () => {
    if (!currentTaskId) return;
    const text = document.getElementById('comment-text').value.trim();
    if (!text) return;
    document.getElementById('comment-text').value = '';
    await addComment(currentTaskId, text);
    // Re-render comments
    const task = allTasks.find(t => t.id === currentTaskId);
    if (task) renderComments(task);
  });

  // Attachment upload
  document.getElementById('attachment-input').addEventListener('change', async (e) => {
    if (!currentTaskId) return;
    const files = Array.from(e.target.files);
    for (const file of files) {
      await uploadAttachment(currentTaskId, file);
    }
    const task = allTasks.find(t => t.id === currentTaskId);
    if (task) renderAttachments(task);
    e.target.value = '';
  });

  // Search
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { searchResults.classList.remove('open'); return; }
    const results = allTasks.filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      t.project?.toLowerCase().includes(q)
    ).slice(0, 8);
    if (!results.length) {
      searchResults.innerHTML = '<div class="search-result-item">No results found.</div>';
    } else {
      searchResults.innerHTML = results.map(t => `
        <div class="search-result-item" data-id="${t.id}">
          <span class="result-title">${esc(t.title)}</span>
          <span class="result-project">${t.project || ''}</span>
          <span class="priority-badge ${t.priority||'low'}" style="font-size:.65rem">${t.priority||'low'}</span>
        </div>`).join('');
      searchResults.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
          openTask(el.dataset.id);
          searchInput.value = '';
          searchResults.classList.remove('open');
        });
      });
    }
    searchResults.classList.add('open');
  });
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.remove('open');
    }
  });

  // Filters
  document.getElementById('filter-priority').addEventListener('change', renderAll);
  document.getElementById('filter-project').addEventListener('change', renderAll);

  // Notifications bell
  document.getElementById('notif-bell').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('notif-dropdown').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('notif-dropdown');
    if (!document.getElementById('notif-bell').contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (unsubTasks) unsubTasks();
    await signOut(auth);
    window.location.href = 'login.html';
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tf-theme', next);
    updateThemeIcon(next);
  });

  // Calendar nav
  document.getElementById('cal-prev').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendar();
  });

  // Mobile sidebar
  document.getElementById('menu-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.remove('hidden');
  });
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // Add project
  document.getElementById('add-project-btn').addEventListener('click', () => {
    const name = prompt('Enter project name:');
    if (name && name.trim()) {
      // Projects are derived from tasks; prompt to create a task under it
      openNewTaskModal();
      setTimeout(() => {
        document.getElementById('f-project').value = name.trim();
      }, 100);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openNewTaskModal(); }
  });
}

// ─── View Switching ────────────────────────
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const view = document.getElementById(`view-${name}`);
  if (view) view.classList.add('active');
  const navItem = document.querySelector(`[data-view="${name}"]`);
  if (navItem) navItem.classList.add('active');
}

// ─── Modal Helpers ─────────────────────────
function closeModal() {
  document.getElementById('task-modal-overlay').classList.add('hidden');
  currentTaskId = null;
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

// ─── Theme ─────────────────────────────────
function updateThemeIcon(theme) {
  document.getElementById('sun-icon').classList.toggle('hidden', theme === 'dark');
  document.getElementById('moon-icon').classList.toggle('hidden', theme !== 'dark');
}

// ─── Toasts ────────────────────────────────
function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut .2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// ─── Utilities ─────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusLabel(status) {
  return { todo: 'To Do', inprogress: 'In Progress', review: 'Review', completed: 'Completed' }[status] || status;
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}
