(function () {
  const state = {
    ready: false,
    session: null,
    user: null,
    profile: null,
    error: '',
  };

  function $(id) { return document.getElementById(id); }

  function getEmailInput() {
    const signupVisible = $('signup-page') && !$('signup-page').classList.contains('hidden-section');
    return signupVisible ? $('signup-email') : $('auth-email');
  }
  function getPasswordInput() {
    const signupVisible = $('signup-page') && !$('signup-page').classList.contains('hidden-section');
    return signupVisible ? $('signup-password') : $('auth-password');
  }

  function getActiveMessageEl() {
    const signupVisible = $('signup-page') && !$('signup-page').classList.contains('hidden-section');
    return signupVisible ? $('signup-message') : $('auth-message');
  }

  function normalizeAuthError(err, fallback) {
    const raw = String(err?.message || '').trim();
    if (!raw) return fallback;
    const lower = raw.toLowerCase();
    if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) {
      return 'We could not reach the sign-in service. Please try again in a moment.';
    }
    if (lower.includes('invalid login credentials')) return 'That email or password did not match. Please try again.';
    if (lower.includes('email not confirmed')) return 'Check your email to confirm your account, then sign in.';
    return raw;
  }

  function setAuthMessage(message, type) {
    const authEl = $('auth-message');
    const signupEl = $('signup-message');
    [authEl, signupEl].forEach((el) => {
      if (!el) return;
      el.textContent = '';
      el.dataset.state = '';
      el.style.display = 'none';
    });
    const el = getActiveMessageEl();
    if (!el) return;
    el.textContent = message || '';
    el.dataset.state = type || '';
    el.style.display = message ? 'block' : 'none';
  }

  function deriveDisplayName(user) {
    if (!user) return 'Reader';
    const meta = user.user_metadata || {};
    const full = String(meta.full_name || meta.name || meta.display_name || '').trim();
    if (full) return full;
    const email = String(user.email || '').trim();
    if (!email) return 'Reader';
    return email.split('@')[0];
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setInputBusy(isBusy) {
    ['auth-signin-btn', 'auth-reset-btn', 'profile-reset-btn', 'manage-billing-btn', 'signup-register-btn'].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = !!isBusy;
    });
  }

  function applyUserUi() {
    const user = state.user;
    const isAuthed = !!user;
    const displayName = deriveDisplayName(user);
    const email = user?.email || 'Create an account to save your library and settings';

    setText('nav-user-name', displayName);
    setText('profile-name-main', displayName);
    setText('profile-name-settings', displayName);
    setText('profile-email-main', email);
    setText('profile-email-settings', email);
    setText('dashboard-subtitle', isAuthed
      ? "Your signed-in settings and progress are ready to sync."
      : "Start with the sample book. Create an account when you want to save your own library.");

    const navAvatar = $('nav-user-avatar');
    const profileAvatar = $('profile-avatar-main');
    const settingsAvatar = $('profile-avatar-settings');
    const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(displayName)}`;
    [navAvatar, profileAvatar, settingsAvatar].forEach((img) => { if (img) img.src = avatarUrl; });

    const supportLogout = $('logout-btn');
    if (supportLogout) supportLogout.style.display = isAuthed ? '' : 'none';

    const landingControls = $('nav-landing-controls');
    const userControls = $('nav-user-controls');
    if (userControls) userControls.classList.toggle('hidden-section', !isAuthed);
    if (landingControls) landingControls.style.display = isAuthed ? 'none' : 'flex';
    try { if (typeof window.syncShellAuthPresentation === 'function') window.syncShellAuthPresentation(); } catch (_) {}
  }

  async function upsertUserProfile(user) {
    try {
      const client = await window.rcSupabase.init();
      const payload = {
        id: user.id,
        email: user.email || null,
        display_name: deriveDisplayName(user),
        auth_provider: user?.app_metadata?.provider || 'email',
        status: 'active',
        updated_at: new Date().toISOString(),
      };
      await client.from('users').upsert(payload, { onConflict: 'id' });
    } catch (err) {
      console.warn('[auth] profile upsert failed', err);
    }
  }

  async function handleSession(session) {
    state.session = session || null;
    state.user = session?.user || null;
    applyUserUi();

    if (state.user) {
      await upsertUserProfile(state.user);
      if ((document.getElementById('landing-page') && !document.getElementById('landing-page').classList.contains('hidden-section')) || (document.getElementById('login-page') && !document.getElementById('login-page').classList.contains('hidden-section')) || (document.getElementById('signup-page') && !document.getElementById('signup-page').classList.contains('hidden-section'))) {
        try { showSection('dashboard'); } catch (_) {}
      }
      try {
        const pendingPlan = sessionStorage.getItem('rc_pending_plan');
        if (pendingPlan && typeof window.startCheckout === 'function') {
          sessionStorage.removeItem('rc_pending_plan');
          setTimeout(() => { window.startCheckout(pendingPlan); }, 120);
        }
      } catch (_) {}
    } else {
      try {
        const activeSectionIsPrivate = ['profile-page'].some((id) => {
          const el = document.getElementById(id);
          return el && !el.classList.contains('hidden-section');
        });
        if (activeSectionIsPrivate) showSection('landing-page');
      } catch (_) {}
    }

    if (window.rcSync && typeof window.rcSync.handleAuthStateChange === 'function') {
      try { await window.rcSync.handleAuthStateChange({ session: state.session, user: state.user }); } catch (err) { console.warn('[auth] sync handoff failed', err); }
    }
  }

  async function initAuth() {
    if (state.ready) return state;
    const client = await window.rcSupabase.init();
    const sessionResult = await client.auth.getSession();
    await handleSession(sessionResult?.data?.session || null);
    client.auth.onAuthStateChange(async (_event, session) => {
      await handleSession(session || null);
    });
    state.ready = true;
    return state;
  }

  async function signIn() {
    const email = String(getEmailInput()?.value || '').trim();
    const password = String(getPasswordInput()?.value || '');
    if (!email || !password) {
      showSection('login-page');
      setAuthMessage('Enter your email and password to sign in.', 'error');
      return false;
    }
    setInputBusy(true);
    setAuthMessage('', '');
    try {
      const client = await window.rcSupabase.init();
      const out = await client.auth.signInWithPassword({ email, password });
      if (out.error) throw out.error;
      setAuthMessage('Signed in.', 'success');
      return true;
    } catch (err) {
      setAuthMessage(normalizeAuthError(err, 'We could not sign you in right now.'), 'error');
      return false;
    } finally {
      setInputBusy(false);
    }
  }

  async function register() {
    const email = String(getEmailInput()?.value || '').trim();
    const password = String(getPasswordInput()?.value || '');
    if (!email || !password) {
      showSection('signup-page');
      setAuthMessage('Enter your email and password to create an account.', 'error');
      return false;
    }
    setInputBusy(true);
    setAuthMessage('', '');
    try {
      const client = await window.rcSupabase.init();
      const config = await window.rcSupabase.getConfig();
      const out = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: config?.authRedirectUrl || window.location.origin,
        },
      });
      if (out.error) throw out.error;
      if (out.data?.session) {
        setAuthMessage("Account created. You're ready to keep exploring.", 'success');
      } else {
        setAuthMessage("Account created. Check your email to confirm your sign in when you're ready.", 'success');
      }
      return true;
    } catch (err) {
      setAuthMessage(normalizeAuthError(err, 'We could not create your account right now.'), 'error');
      return false;
    } finally {
      setInputBusy(false);
    }
  }

  async function signOut() {
    setInputBusy(true);
    try {
      const client = await window.rcSupabase.init();
      await client.auth.signOut();
      setAuthMessage('Signed out.', 'success');
      return true;
    } catch (err) {
      setAuthMessage(normalizeAuthError(err, 'We could not sign you out right now.'), 'error');
      return false;
    } finally {
      setInputBusy(false);
    }
  }


  async function signInWithGoogle() {
    setInputBusy(true);
    try {
      const client = await window.rcSupabase.init();
      const config = await window.rcSupabase.getConfig();
      const out = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: config?.authRedirectUrl || window.location.origin,
        },
      });
      if (out.error) throw out.error;
      return true;
    } catch (err) {
      setAuthMessage(normalizeAuthError(err, 'Google sign in is not available right now.'), 'error');
      return false;
    } finally {
      setInputBusy(false);
    }
  }

  async function sendPasswordReset() {
    const email = String(getEmailInput()?.value || state.user?.email || '').trim();
    if (!email) {
      setAuthMessage('Enter your account email first.', 'error');
      return false;
    }
    setInputBusy(true);
    try {
      const client = await window.rcSupabase.init();
      const config = await window.rcSupabase.getConfig();
      const out = await client.auth.resetPasswordForEmail(email, {
        redirectTo: config?.authRedirectUrl || window.location.origin,
      });
      if (out.error) throw out.error;
      setAuthMessage('Password reset email sent.', 'success');
      return true;
    } catch (err) {
      setAuthMessage(normalizeAuthError(err, 'We could not send the reset email right now.'), 'error');
      return false;
    } finally {
      setInputBusy(false);
    }
  }

  function bindAuthUi() {
    const form = $('login-form');
    if (form && !form.__rcBound) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        signIn();
      });
      form.__rcBound = true;
    }
    const signupForm = $('signup-form');
    if (signupForm && !signupForm.__rcBound) {
      signupForm.addEventListener('submit', function (event) {
        event.preventDefault();
        register();
      });
      signupForm.__rcBound = true;
    }
  }

  window.rcAuth = {
    init: initAuth,
    getState: function () { return { ...state }; },
    getSession: function () { return state.session; },
    getUser: function () { return state.user; },
    signIn,
    register,
    signOut,
    sendPasswordReset,
    signInWithGoogle,
  };

  window.login = signIn;
  window.register = register;
  window.logout = signOut;
  window.sendPasswordReset = sendPasswordReset;
  window.signInWithGoogle = signInWithGoogle;

  document.addEventListener('DOMContentLoaded', function () {
    bindAuthUi();
    initAuth().catch((err) => {
      console.warn('[auth] init failed', err);
      setAuthMessage(normalizeAuthError(err, 'We could not reach the sign-in service. Please try again in a moment.'), 'error');
    });
  });
})();
