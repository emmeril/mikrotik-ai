window.consoleApp = function () {
  return {
    menuOpen: false, routerPanelOpen: false, theme: 'light', submittedPrompt: '',
    authReady: false, user: null, authMode: 'login', authForm: { name: '', email: '', password: '' },
    aiReady: false, routerStoreReady: false,
    busy: '', error: '', notice: '',
    connection: { host: '', port: 8729, username: 'admin', password: '', secure: true, allowSelfSigned: false },
    savedRouters: [], selectedRouterId: '', routerName: '',
    routerInfo: null, testedConnection: '', prompt: '', plan: null, preflight: null, templateType: null, templateValues: {},
    templateLabels: { identity: 'Nama router', dns: 'DNS server', address: 'Alamat IP', route: 'Static route' },
    showConfirm: false, confirmText: '', results: null, planApplied: false,
    async init() {
      const savedTheme = localStorage.getItem('mikrotik-ai-theme');
      this.theme = savedTheme === 'dark' || savedTheme === 'light'
        ? savedTheme
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = this.theme;
      try {
        const response = await fetch('/api/status');
        const status = await response.json();
        this.aiReady = status.aiReady; this.routerStoreReady = status.routerStoreReady;
        const session = await fetch('/api/auth/me').then(value => value.json());
        this.user = session.user;
        if (this.user) await this.loadRouters();
      }
      catch { this.error = 'Status server tidak dapat dibaca.'; }
      finally { this.authReady = true; }
    },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;
      localStorage.setItem('mikrotik-ai-theme', this.theme);
    },
    newConversation() {
      this.prompt = ''; this.submittedPrompt = ''; this.plan = null; this.preflight = null;
      this.results = null; this.planApplied = false; this.error = ''; this.notice = '';
      this.menuOpen = false;
      this.$nextTick(() => document.getElementById('prompt')?.focus());
    },
    async request(url, body, method = 'POST') {
      const options = { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'mikrotik-ai-console' } };
      if (body !== undefined) options.body = JSON.stringify(body);
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 && !url.startsWith('/api/auth/')) { this.user = null; this.savedRouters = []; }
        const error = new Error(data.error || 'Permintaan gagal.');
        error.payload = data;
        throw error;
      }
      return data;
    },
    async submitAuth() {
      await this.run('auth', async () => {
        const endpoint = this.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const data = await this.request(endpoint, this.authForm);
        this.user = data.user; this.authForm = { name: '', email: '', password: '' };
        await this.loadRouters(); this.notice = this.authMode === 'register' ? 'Akun berhasil dibuat.' : 'Login berhasil.';
      });
    },
    async logout() {
      await this.run('logout', async () => {
        await this.request('/api/auth/logout', {});
        this.user = null; this.savedRouters = []; this.selectedRouterId = ''; this.routerInfo = null; this.plan = null; this.notice = ''; this.routerPanelOpen = false;
      });
    },
    async loadRouters() {
      const data = await this.request('/api/routers', undefined, 'GET');
      this.savedRouters = data.routers;
    },
    selectSavedRouter() {
      const router = this.savedRouters.find(item => item.id === this.selectedRouterId);
      this.routerInfo = null; this.testedConnection = '';
      if (!router) return;
      this.connection = { host: router.host, port: router.port, username: router.username, password: '', secure: router.secure, allowSelfSigned: router.allowSelfSigned };
      this.routerName = router.name;
    },
    editConnection() { this.selectedRouterId = ''; this.routerInfo = null; this.testedConnection = ''; this.preflight = null; },
    connectionPayload() { return this.selectedRouterId ? { savedRouterId: this.selectedRouterId } : { connection: this.connection }; },
    async deleteSavedRouter() {
      if (!this.selectedRouterId || !confirm('Hapus profil router tersimpan ini?')) return;
      await this.run('delete-router', async () => {
        await this.request(`/api/routers/${encodeURIComponent(this.selectedRouterId)}`, undefined, 'DELETE');
        this.selectedRouterId = ''; this.routerInfo = null; this.testedConnection = ''; this.routerName = '';
        await this.loadRouters(); this.notice = 'Profil router dihapus.';
      });
    },
    async run(kind, task) {
      this.busy = kind; this.error = ''; this.notice = '';
      try { await task(); } catch (error) {
        this.error = error.message;
        if (error.payload?.preflight) { this.preflight = error.payload.preflight; this.showConfirm = false; this.confirmText = ''; }
      }
      finally { this.busy = ''; }
    },
    async connectRouter(save = false) {
      if (save && !this.routerName.trim()) { this.error = 'Isi nama profil router sebelum menyimpan.'; return; }
      await this.run(save ? 'save-router' : 'test', async () => {
        this.routerInfo = null;
        this.routerInfo = await this.request('/api/router/test', { ...this.connectionPayload(), saveRouter: save ? { name: this.routerName } : undefined });
        if (this.routerInfo.savedRouter) {
          this.selectedRouterId = this.routerInfo.savedRouter.id;
          this.connection.password = '';
          await this.loadRouters();
        }
        this.testedConnection = this.connectionKey();
        this.notice = save ? `Router ${this.routerName} berhasil disimpan.` : `Terhubung ke ${this.routerInfo.identity} (${this.routerInfo.version}).`;
      });
    },
    async testConnection() { await this.connectRouter(false); },
    async saveRouter() { await this.connectRouter(true); },
    connectionKey() { return JSON.stringify({ selectedRouterId: this.selectedRouterId, connection: this.connection }); },
    get canApply() { return Boolean(this.routerInfo && this.testedConnection === this.connectionKey()); },
    async generate() {
      await this.run('generate', async () => {
        this.submittedPrompt = this.prompt.trim();
        this.plan = await this.request('/api/plan/generate', { prompt: this.prompt, version: this.routerInfo?.version, ...this.connectionPayload() });
        this.results = null; this.preflight = null; this.planApplied = false;
        this.notice = 'Rencana siap ditinjau.';
        this.$nextTick(() => document.getElementById('plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      });
    },
    openTemplate(type) { this.templateType = type; this.templateValues = {}; this.error = ''; },
    async createTemplate() {
      await this.run('template', async () => {
        this.submittedPrompt = `Formulir cepat: ${this.templateLabels[this.templateType]}`;
        this.plan = await this.request('/api/plan/template', { type: this.templateType, values: this.templateValues });
        this.results = null; this.preflight = null; this.planApplied = false;
        this.templateType = null;
        this.notice = 'Rencana siap ditinjau.';
        this.$nextTick(() => document.getElementById('plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      });
    },
    async copyScript() {
      try { await navigator.clipboard.writeText(this.plan.script); this.notice = 'Perintah terminal disalin.'; }
      catch { this.error = 'Tidak dapat menyalin otomatis. Pilih dan salin perintah dari kotak terminal.'; }
    },
    async applyPlan() {
      await this.run('apply', async () => {
        const data = await this.request('/api/plan/apply', { id: this.plan.id, confirm: this.confirmText, ...this.connectionPayload() });
        this.showConfirm = false; this.confirmText = '';
        this.preflight = data.preflight; this.results = data.results;
        const failed = data.results.find(item => !item.ok);
        if (failed) {
          this.error = `${failed.title} gagal: ${failed.error}. Langkah sebelumnya mungkin sudah diterapkan. Periksa router sebelum mencoba lagi.`;
        } else {
          const count = data.results.length;
          this.planApplied = true;
          await this.testConnection();
          this.notice = data.results.some(item => item.kind === 'read') ? 'Snapshot traffic berhasil diambil.' : `${count} perubahan berhasil diterapkan.`;
        }
      });
    }
  };
};
