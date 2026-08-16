// ============================================================
// Starks Galaxy — PWA install prompt + service worker lifecycle.
// Loaded (as a plain, non-module script) on every page: index.html,
// signup.html and dashboard.html, so install/update banners behave
// the same everywhere regardless of which page the user lands on.
// ============================================================
(function () {
  const SNOOZE_DAYS = 7;
  const INSTALL_SNOOZE_KEY = 'sg-pwa-install-snoozed-until';
  const IOS_SNOOZE_KEY = 'sg-pwa-ios-snoozed-until';

  let deferredPrompt = null;
  let bannerEl = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true; // iOS Safari's own flag

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isSafari = () => /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);

  function snoozed(key) {
    const until = Number(localStorage.getItem(key) || 0);
    return Date.now() < until;
  }
  function snooze(key) {
    localStorage.setItem(key, String(Date.now() + SNOOZE_DAYS * 86400000));
  }

  // ─── Shared banner styling (self-contained so it looks right on the
  // dark sidebar dashboard AND the auth pages, no dependency on page CSS) ──
  function injectStyles() {
    if (document.getElementById('sg-pwa-styles')) return;
    const style = document.createElement('style');
    style.id = 'sg-pwa-styles';
    style.textContent = `
      .sg-pwa-banner {
        position: fixed;
        left: 50%;
        bottom: 1rem;
        transform: translateX(-50%);
        z-index: 9999;
        width: min(420px, calc(100vw - 1.5rem));
        background: #0d1424;
        color: #fff;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 14px;
        box-shadow: 0 12px 32px rgba(0,0,0,.35);
        padding: .875rem 1rem;
        display: flex;
        align-items: flex-start;
        gap: .75rem;
        font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
        animation: sgPwaSlideUp .3s ease;
      }
      @keyframes sgPwaSlideUp { from { opacity:0; transform: translateX(-50%) translateY(12px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
      .sg-pwa-banner-icon {
        width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
        background: linear-gradient(135deg,#2563eb,#1d4ed8);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(37,99,235,.4);
      }
      .sg-pwa-banner-body { flex: 1; min-width: 0; }
      .sg-pwa-banner-title { font-weight: 700; font-size: .875rem; margin-bottom: .2rem; letter-spacing: -.01em; }
      .sg-pwa-banner-text { font-size: .78rem; color: rgba(255,255,255,.65); line-height: 1.45; }
      .sg-pwa-banner-actions { display: flex; gap: .5rem; margin-top: .625rem; }
      .sg-pwa-btn {
        border: none; border-radius: 8px; padding: .4rem .8rem;
        font-size: .78rem; font-weight: 600; cursor: pointer;
        font-family: inherit; transition: opacity .15s ease;
      }
      .sg-pwa-btn:hover { opacity: .88; }
      .sg-pwa-btn-primary { background: #2563eb; color: #fff; }
      .sg-pwa-btn-ghost { background: rgba(255,255,255,.08); color: rgba(255,255,255,.8); }
      .sg-pwa-close {
        background: none; border: none; color: rgba(255,255,255,.4);
        cursor: pointer; font-size: 1rem; line-height: 1; padding: .15rem;
        flex-shrink: 0;
      }
      .sg-pwa-close:hover { color: #fff; }
      .sg-pwa-kbd {
        display: inline-flex; align-items: center; justify-content: center;
        width: 18px; height: 18px; border-radius: 4px;
        background: rgba(255,255,255,.12); font-size: .7rem; margin: 0 .15rem;
      }
      @media (max-width: 480px) {
        .sg-pwa-banner { bottom: .625rem; }
      }
    `;
    document.head.appendChild(style);
  }

  function removeBanner() {
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  }

  function showBanner({ id, iconSvg, title, text, primaryLabel, onPrimary, onDismiss }) {
    removeBanner();
    injectStyles();
    const el = document.createElement('div');
    el.className = 'sg-pwa-banner';
    el.id = id;
    el.innerHTML = `
      <div class="sg-pwa-banner-icon">${iconSvg}</div>
      <div class="sg-pwa-banner-body">
        <div class="sg-pwa-banner-title">${title}</div>
        <div class="sg-pwa-banner-text">${text}</div>
        <div class="sg-pwa-banner-actions">
          <button class="sg-pwa-btn sg-pwa-btn-primary" id="${id}-primary">${primaryLabel}</button>
          <button class="sg-pwa-btn sg-pwa-btn-ghost" id="${id}-later">Not now</button>
        </div>
      </div>
      <button class="sg-pwa-close" id="${id}-close" aria-label="Dismiss">&times;</button>
    `;
    document.body.appendChild(el);
    bannerEl = el;
    el.querySelector(`#${id}-primary`).addEventListener('click', onPrimary);
    const dismiss = () => { removeBanner(); if (onDismiss) onDismiss(); };
    el.querySelector(`#${id}-later`).addEventListener('click', dismiss);
    el.querySelector(`#${id}-close`).addEventListener('click', dismiss);
    return el;
  }

  const logoSvg = `<svg width="20" height="20" viewBox="0 0 48 48" fill="none"><path d="M12 24L20 32L36 16" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const refreshSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

  // ─── Native install prompt (Chrome/Edge/Android) ──────────
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('sg-pwa-installable', { detail: { installable: true } }));
    if (isStandalone() || snoozed(INSTALL_SNOOZE_KEY)) return;
    showInstallBanner();
  });

  function showInstallBanner() {
    if (!deferredPrompt || isStandalone()) return;
    showBanner({
      id: 'sg-pwa-install-banner',
      iconSvg: logoSvg,
      title: 'Install Starks Galaxy',
      text: 'Add it to your device for a full-screen, app-like experience with faster loading and offline access.',
      primaryLabel: 'Install',
      onPrimary: promptInstall,
      onDismiss: () => snooze(INSTALL_SNOOZE_KEY),
    });
  }

  async function promptInstall() {
    if (!deferredPrompt) return;
    removeBanner();
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome !== 'accepted') snooze(INSTALL_SNOOZE_KEY);
    deferredPrompt = null;
  }

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    removeBanner();
    localStorage.setItem('sg-pwa-installed', '1');
    window.dispatchEvent(new CustomEvent('sg-pwa-installable', { detail: { installable: false } }));
  });

  // ─── iOS Safari: no beforeinstallprompt, show manual instructions ──
  function maybeShowIOSBanner() {
    if (!isIOS() || !isSafari() || isStandalone() || snoozed(IOS_SNOOZE_KEY)) return;
    showBanner({
      id: 'sg-pwa-ios-banner',
      iconSvg: logoSvg,
      title: 'Install Starks Galaxy',
      text: `Tap the Share icon, then "Add to Home Screen" for quick, full-screen access.`,
      primaryLabel: 'Got it',
      onPrimary: () => { removeBanner(); snooze(IOS_SNOOZE_KEY); },
      onDismiss: () => snooze(IOS_SNOOZE_KEY),
    });
  }

  // ─── Manual trigger for an in-app "Install app" button/menu item ──
  window.StarksPWA = {
    isInstalled: isStandalone,
    isInstallable: () => !!deferredPrompt,
    promptInstall: () => {
      if (deferredPrompt) { promptInstall(); return true; }
      if (isIOS()) { maybeShowIOSBanner(); return true; }
      return false;
    },
  };

  // ─── Service worker: register + handle updates ────────────
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((registration) => {
        // A worker was already waiting when we registered (e.g. update
        // downloaded on a previous visit while this tab wasn't focused).
        if (registration.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner(registration);
        }
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(registration);
            }
          });
        });
      }).catch((err) => console.warn('[SW] Registration failed:', err));

      // Reload once the new worker has taken control, so the update
      // banner's "Refresh" button actually serves the new files.
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  function showUpdateBanner(registration) {
    showBanner({
      id: 'sg-pwa-update-banner',
      iconSvg: refreshSvg,
      title: 'Update available',
      text: 'A newer version of Starks Galaxy is ready. Refresh to get the latest features and fixes.',
      primaryLabel: 'Refresh',
      onPrimary: () => {
        removeBanner();
        if (registration.waiting) registration.waiting.postMessage('SKIP_WAITING');
      },
      onDismiss: () => {},
    });
  }

  registerServiceWorker();

  // Give the install banner a moment after load so it doesn't fight with
  // page transition animations, then check the iOS path (which has no
  // triggering browser event to wait for).
  window.addEventListener('load', () => {
    setTimeout(maybeShowIOSBanner, 2500);
    // Let any listener (e.g. the dashboard sidebar button) that attaches
    // after this script has already run know the current installable state.
    if (!isStandalone() && (deferredPrompt || (isIOS() && isSafari()))) {
      window.dispatchEvent(new CustomEvent('sg-pwa-installable', { detail: { installable: true } }));
    }
  });
})();
