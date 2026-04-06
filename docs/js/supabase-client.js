(function () {
  let _configPromise = null;
  let _clientPromise = null;
  let _client = null;

  async function fetchPublicConfig() {
    if (_configPromise) return _configPromise;
    _configPromise = fetch('/api/public-config', { credentials: 'same-origin' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load public config');
        return data || {};
      })
      .catch((err) => {
        _configPromise = null;
        throw err;
      });
    return _configPromise;
  }

  async function initClient() {
    if (_client) return _client;
    if (_clientPromise) return _clientPromise;
    _clientPromise = (async () => {
      const config = await fetchPublicConfig();
      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        throw new Error('Supabase browser client is not loaded');
      }
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error('Supabase public config is incomplete');
      }
      _client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      return _client;
    })().catch((err) => {
      _clientPromise = null;
      throw err;
    });
    return _clientPromise;
  }

  window.rcSupabase = {
    getConfig: fetchPublicConfig,
    init: initClient,
    getClient: function () { return _client; },
  };
})();
