(function () {
  function setBillingMessage(message, type) {
    const el = document.getElementById('billing-message');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.state = type || '';
    el.style.display = message ? 'block' : 'none';
  }

  function normalizeBillingError(err, fallback) {
    const raw = String(err?.message || '').trim();
    if (!raw) return fallback;
    const lower = raw.toLowerCase();
    if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) {
      return 'Billing is unavailable right now. Please try again in a moment.';
    }
    if (lower.includes('sign in')) return 'Sign in to manage billing for your account.';
    return raw;
  }

  function rememberPendingPlan(plan) {
    try { sessionStorage.setItem('rc_pending_plan', String(plan || '')); } catch (_) {}
  }

  function clearPendingPlan() {
    try { sessionStorage.removeItem('rc_pending_plan'); } catch (_) {}
  }

  function continueWithFree() {
    clearPendingPlan();
    setBillingMessage('', '');
    if (typeof closeModal === 'function') closeModal('pricing-modal');
    if (typeof showSection === 'function') showSection('dashboard');
  }

  async function authenticatedPost(url, body) {
    const session = window.rcAuth && typeof window.rcAuth.getSession === 'function' ? window.rcAuth.getSession() : null;
    const accessToken = session?.access_token || '';
    if (!accessToken) throw new Error('Sign in first to manage billing.');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body || {}),
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Request failed.');
    return data;
  }

  async function startCheckout(plan) {
    const normalizedPlan = String(plan || '').trim();
    const session = window.rcAuth && typeof window.rcAuth.getSession === 'function' ? window.rcAuth.getSession() : null;
    if (!session?.access_token) {
      rememberPendingPlan(normalizedPlan);
      setBillingMessage('', '');
      if (typeof closeModal === 'function') closeModal('pricing-modal');
      if (typeof showSection === 'function') showSection('signup-page');
      return;
    }
    try {
      setBillingMessage('', '');
      const out = await authenticatedPost('/api/stripe/checkout', { plan: normalizedPlan });
      if (!out?.url) throw new Error('Stripe checkout URL missing.');
      window.location.assign(out.url);
    } catch (err) {
      const msg = normalizeBillingError(err, 'We could not start checkout right now.');
      setBillingMessage(msg, 'error');
      if (/sign in/i.test(msg) && typeof showSection === 'function') showSection('login-page');
    }
  }

  async function openCustomerPortal() {
    try {
      setBillingMessage('', '');
      const out = await authenticatedPost('/api/stripe/portal', {});
      if (!out?.url) throw new Error('Customer portal URL missing.');
      window.location.assign(out.url);
    } catch (err) {
      const msg = normalizeBillingError(err, 'We could not open billing right now.');
      setBillingMessage(msg, 'error');
      if (/sign in/i.test(msg) && typeof showSection === 'function') showSection('login-page');
    }
  }

  function handleQueryFeedback() {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const portal = params.get('portal');
    if (checkout === 'success') setBillingMessage('Checkout completed. Billing state will refresh shortly.', 'success');
    else if (checkout === 'cancel') setBillingMessage('Checkout canceled.', 'info');
    else if (portal === 'return') setBillingMessage('Returned from billing portal.', 'info');
  }

  window.startCheckout = startCheckout;
  window.openCustomerPortal = openCustomerPortal;
  window.continueWithFree = continueWithFree;
  document.addEventListener('DOMContentLoaded', handleQueryFeedback);
})();
