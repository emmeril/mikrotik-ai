window.consoleApp = function () {
  return {
    menuOpen: false, sidebarCollapsed: false, routerPanelOpen: false, theme: 'light', submittedPrompt: '',
    authReady: false, user: null, authMode: 'login', authForm: { name: '', email: '', password: '' },
    aiReady: false, routerStoreReady: false,
    busy: '', error: '', notice: '',
    connection: { host: '', port: 8728, username: 'admin', password: '' },
    savedRouters: [], selectedRouterId: '', routerName: '',
    routerInfo: null, testedConnection: '', prompt: '', plan: null, preflight: null, templateType: null, templateValues: {},
    conversationId: '', conversations: [], previousEntries: [], historyReady: false,
    templateLabels: { identity: 'Nama router', dns: 'DNS server', address: 'Alamat IP', route: 'Static route' },
    showConfirm: false, confirmAccepted: false, results: null, planApplied: false,
    async init() {
      const savedTheme = localStorage.getItem('mikrotik-ai-theme');
      this.theme = savedTheme === 'dark' || savedTheme === 'light'
        ? savedTheme
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      this.sidebarCollapsed = localStorage.getItem('mikrotik-ai-sidebar-collapsed') === 'true';
      document.documentElement.dataset.theme = this.theme;
      try {
        const response = await fetch('/api/status');
        const status = await response.json();
        this.aiReady = status.aiReady; this.routerStoreReady = status.routerStoreReady;
        const session = await fetch('/api/auth/me').then(value => value.json());
        this.user = session.user;
        if (this.user) {
          await Promise.all([this.loadRouters(), this.loadConversations()]);
          await this.restoreRouterConnection();
        }
      }
      catch { this.error = 'Status server tidak dapat dibaca.'; }
      finally { this.authReady = true; }
    },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;
      localStorage.setItem('mikrotik-ai-theme', this.theme);
    },
    minimizeSidebar() {
      this.sidebarCollapsed = true;
      this.menuOpen = false;
      localStorage.setItem('mikrotik-ai-sidebar-collapsed', 'true');
    },
    maximizeSidebar() {
      this.sidebarCollapsed = false;
      localStorage.setItem('mikrotik-ai-sidebar-collapsed', 'false');
    },
    newConversation() {
      this.prompt = ''; this.submittedPrompt = ''; this.plan = null; this.preflight = null;
      this.conversationId = ''; this.previousEntries = []; this.results = null;
      this.planApplied = false; this.error = ''; this.notice = '';
      this.menuOpen = false;
      this.$nextTick(() => document.getElementById('prompt')?.focus());
    },
    async request(url, body, method = 'POST') {
      const options = { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'mikrotik-ai-console' } };
      if (body !== undefined) options.body = JSON.stringify(body);
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 && !url.startsWith('/api/auth/')) { this.user = null; this.savedRouters = []; this.conversations = []; }
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
        await Promise.all([this.loadRouters(), this.loadConversations()]);
        await this.restoreRouterConnection();
        this.notice = this.authMode === 'register' ? 'Akun berhasil dibuat.' : 'Login berhasil.';
      });
    },
    async logout() {
      await this.run('logout', async () => {
        await this.request('/api/auth/logout', {});
        this.user = null; this.savedRouters = []; this.conversations = []; this.selectedRouterId = ''; this.routerInfo = null;
        this.conversationId = ''; this.previousEntries = []; this.plan = null; this.notice = ''; this.routerPanelOpen = false;
      });
    },
    async loadRouters() {
      const data = await this.request('/api/routers', undefined, 'GET');
      this.savedRouters = data.routers;
    },
    async loadConversations() {
      const data = await this.request('/api/conversations', undefined, 'GET');
      this.conversations = data.conversations;
      this.historyReady = true;
    },
    async openConversation(id) {
      await this.run('history', async () => {
        const data = await this.request(`/api/conversations/${encodeURIComponent(id)}`, undefined, 'GET');
        const entries = data.conversation.entries || [];
        const latest = entries.at(-1);
        if (!latest) throw new Error('Percakapan ini belum memiliki pesan.');
        this.conversationId = data.conversation.id;
        this.previousEntries = entries.slice(0, -1).map(entry => ({ ...entry, plan: { ...entry.plan, historyOnly: true } }));
        this.submittedPrompt = latest.prompt;
        this.plan = { ...latest.plan, historyOnly: true };
        this.prompt = ''; this.preflight = null; this.results = null; this.planApplied = false; this.menuOpen = false;
        this.$nextTick(() => document.getElementById('chat-main')?.scrollTo({ top: 0, behavior: 'smooth' }));
      });
    },
    async deleteConversation(id) {
      if (!confirm('Hapus riwayat percakapan ini?')) return;
      await this.run('delete-history', async () => {
        await this.request(`/api/conversations/${encodeURIComponent(id)}`, undefined, 'DELETE');
        if (this.conversationId === id) this.newConversation();
        await this.loadConversations();
        this.notice = 'Riwayat percakapan dihapus.';
      });
    },
    routerSelectionKey() { return this.user?.id ? `mikrotik-ai-selected-router:${this.user.id}` : ''; },
    async restoreRouterConnection() {
      const key = this.routerSelectionKey();
      const savedId = key ? localStorage.getItem(key) : '';
      if (!savedId) return;
      if (!this.savedRouters.some(router => router.id === savedId)) {
        localStorage.removeItem(key);
        return;
      }
      this.selectedRouterId = savedId;
      this.selectSavedRouter();
      await this.connectRouter(false, true);
    },
    selectSavedRouter() {
      const router = this.savedRouters.find(item => item.id === this.selectedRouterId);
      this.routerInfo = null; this.testedConnection = '';
      const key = this.routerSelectionKey();
      if (!router) {
        if (key) localStorage.removeItem(key);
        return;
      }
      if (key) localStorage.setItem(key, router.id);
      this.connection = { host: router.host, port: 8728, username: router.username, password: '' };
      this.routerName = router.name;
    },
    editConnection() {
      const key = this.routerSelectionKey();
      if (key) localStorage.removeItem(key);
      this.selectedRouterId = ''; this.routerInfo = null; this.testedConnection = ''; this.preflight = null;
    },
    connectionPayload() { return this.selectedRouterId ? { savedRouterId: this.selectedRouterId } : { connection: this.connection }; },
    async deleteSavedRouter() {
      if (!this.selectedRouterId || !confirm('Hapus profil router tersimpan ini?')) return;
      await this.run('delete-router', async () => {
        await this.request(`/api/routers/${encodeURIComponent(this.selectedRouterId)}`, undefined, 'DELETE');
        const key = this.routerSelectionKey();
        if (key) localStorage.removeItem(key);
        this.selectedRouterId = ''; this.routerInfo = null; this.testedConnection = ''; this.routerName = '';
        await this.loadRouters(); this.notice = 'Profil router dihapus.';
      });
    },
    async run(kind, task) {
      this.busy = kind; this.error = ''; this.notice = '';
      try { await task(); } catch (error) {
        this.error = error.message;
        if (error.payload?.preflight) { this.preflight = error.payload.preflight; this.showConfirm = false; this.confirmAccepted = false; }
      }
      finally { this.busy = ''; }
    },
    async connectRouter(save = false, restoring = false) {
      if (save && !this.routerName.trim()) { this.error = 'Isi nama profil router sebelum menyimpan.'; return; }
      await this.run(save ? 'save-router' : 'test', async () => {
        this.routerInfo = null;
        this.routerInfo = await this.request('/api/router/test', { ...this.connectionPayload(), saveRouter: save ? { name: this.routerName } : undefined });
        if (this.routerInfo.savedRouter) {
          this.selectedRouterId = this.routerInfo.savedRouter.id;
          this.connection.password = '';
          await this.loadRouters();
        }
        const key = this.routerSelectionKey();
        if (this.selectedRouterId && key) localStorage.setItem(key, this.selectedRouterId);
        this.testedConnection = this.connectionKey();
        if (save) this.notice = `Router ${this.routerName} berhasil disimpan.`;
        else if (restoring) this.notice = `Koneksi ke ${this.routerInfo.identity} dipulihkan.`;
        else if (this.selectedRouterId) this.notice = `Terhubung ke ${this.routerInfo.identity} (${this.routerInfo.version}).`;
        else this.notice = `Terhubung ke ${this.routerInfo.identity}. Simpan profil router agar koneksi dapat dipulihkan setelah refresh.`;
      });
    },
    async testConnection() { await this.connectRouter(false); },
    async saveRouter() { await this.connectRouter(true); },
    connectionKey() { return JSON.stringify({ selectedRouterId: this.selectedRouterId, connection: this.connection }); },
    get canApply() { return Boolean(this.routerInfo && this.testedConnection === this.connectionKey()); },
    get isDiagnosticPlan() { return Boolean(this.plan?.actions?.length && this.plan.actions.every(action => action.kind === 'read')); },
    async generate() {
      const requestedPrompt = this.prompt.trim();
      const previous = this.plan && this.submittedPrompt ? { prompt: this.submittedPrompt, plan: { ...this.plan, historyOnly: true } } : null;
      await this.run('generate', async () => {
        const data = await this.request('/api/plan/generate', { prompt: requestedPrompt, conversationId: this.conversationId || undefined, version: this.routerInfo?.version, ...this.connectionPayload() });
        const { conversationId, ...plan } = data;
        if (previous) this.previousEntries.push(previous);
        this.conversationId = conversationId; this.submittedPrompt = requestedPrompt; this.plan = plan; this.prompt = '';
        this.results = null; this.preflight = null; this.planApplied = false;
        await this.loadConversations();
        this.notice = 'Rencana siap ditinjau.';
        this.$nextTick(() => document.getElementById('plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      });
    },
    openTemplate(type) { this.templateType = type; this.templateValues = {}; this.error = ''; },
    async createTemplate() {
      const requestedPrompt = `Formulir cepat: ${this.templateLabels[this.templateType]}`;
      const previous = this.plan && this.submittedPrompt ? { prompt: this.submittedPrompt, plan: { ...this.plan, historyOnly: true } } : null;
      await this.run('template', async () => {
        const data = await this.request('/api/plan/template', { type: this.templateType, values: this.templateValues, conversationId: this.conversationId || undefined });
        const { conversationId, ...plan } = data;
        if (previous) this.previousEntries.push(previous);
        this.conversationId = conversationId; this.submittedPrompt = requestedPrompt; this.plan = plan;
        this.results = null; this.preflight = null; this.planApplied = false;
        this.templateType = null;
        await this.loadConversations();
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
        const data = await this.request('/api/plan/apply', { id: this.plan.id, confirmed: this.isDiagnosticPlan || this.confirmAccepted, ...this.connectionPayload() });
        this.showConfirm = false; this.confirmAccepted = false;
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
