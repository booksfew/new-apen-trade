const state = {
  user: null,
  csrfToken: '',
  accounts: [],
  trades: [],
  risk: { daily_loss_percent: 2, max_drawdown_percent: 12, exposure_percent: 4.5, last_changed_date: null },
  stats: { total_trades: 0, win_rate: 0, pnl: 0 },
  authMode: 'login',
  editingTradeId: null,
  selectedAccount: 'all',
  frequency: 'monthly',
};

const LOCAL_PREVIEW = window.location.protocol === 'file:';
const PREVIEW_USER_KEY = 'tradersheild-preview-user';
const PREVIEW_DISPLAY_NAME_KEY = 'tradersheild-preview-display-name';
const PREVIEW_USERS_KEY = 'tradersheild-preview-users';

const toast = document.getElementById('toast');
const authMessage = document.getElementById('authMessage');

if (LOCAL_PREVIEW) {
  const notice = document.createElement('div');
  notice.className = 'status-banner';
  notice.textContent = 'LOCAL PREVIEW ONLY — sign-in and journal data stay in this browser session; no real account is created.';
  document.querySelector('.topbar').after(notice);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 2600);
}

function showAuthMessage(message, isError = true) {
  authMessage.hidden = false;
  authMessage.textContent = message;
  authMessage.style.borderColor = isError ? 'rgba(248,113,113,0.3)' : 'rgba(32,201,151,0.3)';
  authMessage.style.background = isError ? 'rgba(248,113,113,0.1)' : 'rgba(32,201,151,0.1)';
}

function clearAuthMessage() {
  authMessage.hidden = true;
  authMessage.textContent = '';
}

function previewRecord(email) {
  const key = `tradersheild-journal:${encodeURIComponent(email.toLowerCase())}`;
  const defaults = {
    accounts: [],
    trades: [],
    risk: { daily_loss_percent: 2, max_drawdown_percent: 12, exposure_percent: 4.5, last_changed_date: null },
    profile: { timezone: 'UTC', base_currency: 'USD' },
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem(key)) || {};
    return { ...defaults, ...saved, profile: { ...defaults.profile, ...saved.profile } };
  } catch {
    return defaults;
  }
}

function savePreviewRecord(email, record) {
  const key = `tradersheild-journal:${encodeURIComponent(email.toLowerCase())}`;
  sessionStorage.setItem(key, JSON.stringify(record));
}

async function previewApi(action, method, data) {
  if (action === 'csrf') return { csrf_token: 'local-preview-only' };
  const activeEmail = sessionStorage.getItem(PREVIEW_USER_KEY);

  if (action === 'register' || action === 'login') {
    const email = String(data?.email || '').trim().toLowerCase();
    const password = String(data?.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
      throw new Error('Enter a valid email and a password with at least 12 characters.');
    }
    let users = [];
    try {
      users = JSON.parse(sessionStorage.getItem(PREVIEW_USERS_KEY) || '[]')
        .map(user => typeof user === 'string'
          ? { email: user, display_name: user.split('@')[0], timezone: 'UTC', base_currency: 'USD' }
          : { timezone: 'UTC', base_currency: 'USD', ...user });
    } catch {
      users = [];
    }
    let displayName = String(data?.display_name || '').trim();
    if (action === 'register') {
      if (displayName.length < 2 || displayName.length > 80) {
        throw new Error('Display name must be between 2 and 80 characters.');
      }
      if (users.some(user => user.email === email)) throw new Error('This email already has a local preview account. Sign in instead.');
      users.push({ email, display_name: displayName, timezone: 'UTC', base_currency: 'USD' });
      sessionStorage.setItem(PREVIEW_USERS_KEY, JSON.stringify(users));
    } else {
      const user = users.find(item => item.email === email);
      if (!user) throw new Error('No local preview account found. Choose Sign up first.');
      displayName = user.display_name;
      data.profile = user;
    }
    sessionStorage.setItem(PREVIEW_USER_KEY, email);
    sessionStorage.setItem(PREVIEW_DISPLAY_NAME_KEY, displayName);
    return { user: { email, display_name: displayName }, csrf_token: 'local-preview-only' };
  }

  if (action === 'logout') {
    sessionStorage.removeItem(PREVIEW_USER_KEY);
    sessionStorage.removeItem(PREVIEW_DISPLAY_NAME_KEY);
    return { ok: true };
  }
  if (!activeEmail) throw new Error('Please sign in to continue.');

  const record = previewRecord(activeEmail);
  if (action === 'profile-save') {
    const display_name = String(data?.display_name || '').trim();
    const timezone = String(data?.timezone || 'UTC');
    const base_currency = String(data?.base_currency || 'USD');
    if (display_name.length < 2 || display_name.length > 80) throw new Error('Display name must be between 2 and 80 characters.');
    if (!['UTC', 'Asia/Dhaka', 'America/New_York', 'Europe/London'].includes(timezone)) throw new Error('Choose a supported timezone.');
    if (!['USD', 'EUR', 'GBP', 'BDT'].includes(base_currency)) throw new Error('Choose a supported base currency.');
    const users = JSON.parse(sessionStorage.getItem(PREVIEW_USERS_KEY) || '[]');
    const user = users.find(item => typeof item !== 'string' && item.email === activeEmail);
    if (user) Object.assign(user, { display_name, timezone, base_currency });
    sessionStorage.setItem(PREVIEW_USERS_KEY, JSON.stringify(users));
    sessionStorage.setItem(PREVIEW_DISPLAY_NAME_KEY, display_name);
    record.profile = { display_name, timezone, base_currency };
    savePreviewRecord(activeEmail, record);
    return { user: { email: activeEmail, display_name, timezone, base_currency } };
  }
  if (action === 'me') return { user: { email: activeEmail, display_name: sessionStorage.getItem(PREVIEW_DISPLAY_NAME_KEY) || '', ...record.profile }, csrf_token: 'local-preview-only' };
  if (action === 'state') {
    const users = JSON.parse(sessionStorage.getItem(PREVIEW_USERS_KEY) || '[]');
    const user = users.find(item => typeof item !== 'string' && item.email === activeEmail);
    const wins = record.trades.filter(trade => Number(trade.pnl) > 0).length;
    const totalPnl = record.trades.reduce((sum, trade) => sum + Number(trade.pnl), 0);
    return {
      user: { email: activeEmail, display_name: user?.display_name || sessionStorage.getItem(PREVIEW_DISPLAY_NAME_KEY) || '', timezone: user?.timezone || record.profile.timezone, base_currency: user?.base_currency || record.profile.base_currency },
      accounts: record.accounts,
      trades: [...record.trades].sort((left, right) => right.date.localeCompare(left.date)),
      risk: record.risk,
      stats: {
        total_trades: record.trades.length,
        win_rate: record.trades.length ? Math.round(wins / record.trades.length * 1000) / 10 : 0,
        pnl: Math.round(totalPnl * 100) / 100,
      },
      csrf_token: 'local-preview-only',
    };
  }
  if (action === 'account-create') {
    const account = { ...data, id: Date.now(), status: 'Manual — Not Connected' };
    record.accounts.push(account);
    savePreviewRecord(activeEmail, record);
    return { id: account.id };
  }
  if (action === 'account-delete') {
    record.accounts = record.accounts.filter(account => Number(account.id) !== Number(data.id));
    record.trades = record.trades.filter(trade => Number(trade.account_id) !== Number(data.id));
    savePreviewRecord(activeEmail, record);
    return { ok: true };
  }
  if (action === 'trade-create' || action === 'trade-update') {
    const trade = {
      ...data,
      id: action === 'trade-update' ? Number(data.id) : Date.now(),
      account: record.accounts.find(account => Number(account.id) === Number(data.account_id))?.name || 'Manual account',
      entry: String(data.entry),
      exit: String(data.exit),
      date: data.traded_at,
    };
    if (action === 'trade-update') {
      record.trades = record.trades.map(item => Number(item.id) === trade.id ? trade : item);
    } else {
      record.trades.push(trade);
    }
    savePreviewRecord(activeEmail, record);
    return { id: trade.id };
  }
  if (action === 'trade-delete') {
    record.trades = record.trades.filter(trade => Number(trade.id) !== Number(data.id));
    savePreviewRecord(activeEmail, record);
    return { ok: true };
  }
  if (action === 'risk-save') {
    const today = new Date().toISOString().slice(0, 10);
    if (record.risk.last_changed_date === today) {
      throw new Error('Risk settings can only be changed once per UTC day. Try again after 00:00 UTC tomorrow.');
    }
    record.risk = data;
    record.risk.last_changed_date = today;
    savePreviewRecord(activeEmail, record);
    return { ok: true, last_changed_date: today };
  }
  throw new Error('This action is not available in the local preview.');
}

async function api(action, method = 'GET', data = null) {
  if (LOCAL_PREVIEW) return previewApi(action, method, data);
  if (method !== 'GET' && !state.csrfToken) {
    const tokenResponse = await fetch('api.php?action=csrf', { credentials: 'same-origin' });
    const tokenData = await responseData(tokenResponse);
    if (!tokenResponse.ok) throw new Error(tokenData.error || 'Server setup is incomplete.');
    state.csrfToken = tokenData.csrf_token;
  }

  const headers = {};
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = state.csrfToken;
  }
  const response = await fetch(`api.php?action=${encodeURIComponent(action)}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: data === null ? undefined : JSON.stringify(data),
  });
  const result = await responseData(response);
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  if (result.csrf_token) state.csrfToken = result.csrf_token;
  return result;
}

async function responseData(response) {
  try {
    return await response.json();
  } catch {
    throw new Error('The PHP API did not return JSON. Check PHP hosting and MySQL setup in README.md.');
  }
}

function showPage(name) {
  const publicPages = new Set(['home', 'auth', 'pricing', 'terms', 'privacy', 'refund', 'disclaimer', 'cookies']);
  if (!state.user && !publicPages.has(name)) {
    name = 'auth';
    showToast('Sign in to access your journal.');
  }
  const isAuthenticated = Boolean(state.user);
  document.getElementById('workspaceNav').hidden = !isAuthenticated;
  document.getElementById('accountNav').hidden = !isAuthenticated;
  document.getElementById('workspacePromo').hidden = !isAuthenticated;
  document.querySelectorAll('.page').forEach(section => {
    section.classList.toggle('active', section.dataset.pageName === name);
  });
  document.querySelectorAll('.nav-item').forEach(button => {
    button.classList.toggle('active', button.dataset.page === name);
  });
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function accountOptions(select, includeAll = false) {
  const previous = select.value;
  select.replaceChildren();
  if (includeAll) select.add(new Option('All accounts', 'all'));
  state.accounts.forEach(account => select.add(new Option(account.name, String(account.id))));
  if (!state.accounts.length && !includeAll) select.add(new Option('Add an account first', ''));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function accountName(accountId) {
  return state.accounts.find(account => String(account.id) === String(accountId))?.name || 'Unknown account';
}

function selectedTrades() {
  return state.selectedAccount === 'all'
    ? state.trades
    : state.trades.filter(trade => String(trade.account_id) === state.selectedAccount);
}

function renderAccounts() {
  const container = document.getElementById('accountList');
  container.replaceChildren();
  if (!state.accounts.length) {
    container.innerHTML = '<div class="support-item muted">No accounts yet. Add a manual account to start your journal.</div>';
  }
  state.accounts.forEach(account => {
    const item = document.createElement('div');
    item.className = 'account-item';
    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <div><strong>${escapeHtml(account.name)}</strong><br><span class="muted">${escapeHtml(account.platform)} • ${escapeHtml(account.type)}</span></div>
        <span class="badge amber">Manual — Not Connected</span>
      </div>
      <div style="margin-top:10px;display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <span class="muted">${escapeHtml(account.broker)}</span>
        <span class="money neutral">${formatMoney(account.balance)}</span>
        <button class="tiny-btn" type="button" data-delete-account="${Number(account.id)}">Delete</button>
      </div>`;
    container.appendChild(item);
  });
  document.getElementById('accountBalanceTotal').textContent = formatMoney(state.accounts.reduce((sum, account) => sum + Number(account.balance), 0));
  document.getElementById('accountTradeTotal').textContent = String(state.stats.total_trades);
  accountOptions(document.getElementById('dashboardAccount'), true);
  accountOptions(document.getElementById('tradeAccount'));
  accountOptions(document.getElementById('historyAccountFilter'), true);
  document.getElementById('historyAccountFilter').options[0].textContent = 'All';
  document.getElementById('historyAccountFilter').options[0].value = 'All';
  if (state.selectedAccount !== 'all' && !state.accounts.some(account => String(account.id) === state.selectedAccount)) {
    state.selectedAccount = 'all';
  }
  document.getElementById('dashboardAccount').value = state.selectedAccount;
  const instrumentFilter = document.getElementById('historyInstrumentFilter');
  const selectedInstrument = instrumentFilter.value;
  instrumentFilter.replaceChildren(new Option('All', 'All'));
  [...new Set(state.trades.map(trade => trade.symbol))].sort().forEach(symbol => instrumentFilter.add(new Option(symbol, symbol)));
  if ([...instrumentFilter.options].some(option => option.value === selectedInstrument)) instrumentFilter.value = selectedInstrument;
}

function renderHistory() {
  const body = document.querySelector('#historyTable tbody');
  const search = document.getElementById('historySearch').value.trim().toLowerCase();
  const accountFilter = document.getElementById('historyAccountFilter').value;
  const symbolFilter = document.getElementById('historyInstrumentFilter').value;
  const outcomeFilter = document.getElementById('historyOutcomeFilter').value;
  const dateFilter = document.getElementById('historyDateFilter').value;
  const filtered = state.trades.filter(trade => {
    const outcome = Number(trade.pnl) >= 0 ? 'Win' : 'Loss';
    const searchMatches = !search || `${trade.symbol} ${trade.account} ${trade.notes || ''}`.toLowerCase().includes(search);
    return searchMatches
      && (accountFilter === 'All' || String(trade.account_id) === accountFilter)
      && (symbolFilter === 'All' || trade.symbol === symbolFilter)
      && (outcomeFilter === 'All' || outcome === outcomeFilter)
      && (!dateFilter || trade.date === dateFilter);
  });

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="8" class="muted">No matching journal trades found.</td></tr>';
    return;
  }
  body.innerHTML = filtered.map(trade => {
    const pnl = Number(trade.pnl);
    const outcome = pnl >= 0 ? 'Win' : 'Loss';
    return `<tr>
      <td>${escapeHtml(trade.account)}</td><td>${escapeHtml(trade.symbol)}</td><td>${escapeHtml(trade.side)}</td>
      <td>${escapeHtml(trade.entry)}</td><td>${escapeHtml(trade.exit)}</td>
      <td><span class="badge ${outcome === 'Win' ? 'green' : 'red'}">${outcome}</span></td>
      <td class="money ${pnl >= 0 ? 'up' : 'down'}">${formatMoney(pnl)}</td>
      <td class="table-actions"><button class="tiny-btn" type="button" data-edit-trade="${Number(trade.id)}">Edit</button><button class="tiny-btn" type="button" data-delete-trade="${Number(trade.id)}">Delete</button></td>
    </tr>`;
  }).join('');
}

function renderAnalytics() {
  const range = Number(document.getElementById('analyticsRange').value || 1);
  const today = new Date().toISOString().slice(0, 10);
  const startDate = new Date(`${today}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - range + 1);
  const start = startDate.toISOString().slice(0, 10);
  const trades = state.trades.filter(trade => trade.date >= start && trade.date <= today);
  const total = trades.reduce((sum, trade) => sum + Number(trade.pnl), 0);
  const rangeLabel = { 1: '1 day', 3: '3 days', 7: '7 days', 15: '15 days', 30: '1 month', 90: '3 months', 180: '6 months', 365: '1 year' }[range] || `${range} days`;
  const pnl = document.getElementById('analyticsPnl');
  pnl.textContent = formatMoney(total);
  pnl.className = `value money ${total < 0 ? 'down' : 'up'}`;
  document.getElementById('analyticsRangeLabel').textContent = `Last ${rangeLabel}`;
  document.getElementById('analyticsEmpty').hidden = trades.length > 0;
  document.getElementById('analyticsEmpty').textContent = trades.length ? '' : 'No journal trades in this period.';

  const daily = new Map();
  trades.forEach(trade => daily.set(trade.date, (daily.get(trade.date) || 0) + Number(trade.pnl)));
  const values = [...daily.entries()].sort(([left], [right]) => left.localeCompare(right));
  const chart = document.getElementById('analyticsChart');
  chart.replaceChildren();
  if (!values.length) return;
  let cumulative = 0;
  const series = values.map(([, value]) => cumulative += value);
  const low = Math.min(0, ...series);
  const high = Math.max(0, ...series);
  const span = high - low || 1;
  const points = series.map((value, index) => `${values.length === 1 ? 360 : 24 + index / (values.length - 1) * 672},${190 - (value - low) / span * 160}`);
  const color = total < 0 ? '#f87171' : '#20c997';
  if (points.length === 1) {
    chart.innerHTML = `<circle cx="360" cy="${points[0].split(',')[1]}" r="7" fill="${color}"/>`;
  } else {
    chart.innerHTML = `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
}

function renderDashboard() {
  const trades = selectedTrades();
  const wins = trades.filter(trade => Number(trade.pnl) > 0).length;
  const pnl = trades.reduce((sum, trade) => sum + Number(trade.pnl), 0);
  const accountIds = state.selectedAccount === 'all' ? null : new Set([state.selectedAccount]);
  const accounts = accountIds ? state.accounts.filter(account => accountIds.has(String(account.id))) : state.accounts;
  const balance = accounts.reduce((sum, account) => sum + Number(account.balance), 0);
  const totalTrades = state.selectedAccount === 'all' ? Number(state.stats.total_trades) : trades.length;
  const totalPnl = state.selectedAccount === 'all' ? Number(state.stats.pnl) : pnl;
  const winRate = state.selectedAccount === 'all'
    ? Number(state.stats.win_rate)
    : (trades.length ? wins / trades.length * 100 : 0);
  document.getElementById('metricTrades').textContent = String(totalTrades);
  document.getElementById('metricWin').textContent = `${winRate.toFixed(1)}%`;
  document.getElementById('metricPnl').textContent = formatMoney(totalPnl);
  document.getElementById('metricPnl').className = `value ${totalPnl >= 0 ? 'money up' : 'money down'}`;
  document.getElementById('metricEquity').textContent = formatMoney(balance);

  const recent = document.getElementById('recentTrades');
  recent.replaceChildren();
  if (!trades.length) {
    recent.innerHTML = '<div class="support-item muted">Add a trade to see journal activity.</div>';
  } else {
    trades.slice(0, 5).forEach(trade => {
      const pnlValue = Number(trade.pnl);
      const row = document.createElement('div');
      row.className = 'trade-item';
      row.innerHTML = `<div><strong>${escapeHtml(trade.symbol)}</strong><div class="muted">${escapeHtml(trade.side)} • ${escapeHtml(trade.lots)} lots</div></div><div>${escapeHtml(trade.date)}</div><span class="badge ${pnlValue >= 0 ? 'green' : 'red'}">${pnlValue >= 0 ? 'Win' : 'Loss'}</span><div class="money ${pnlValue >= 0 ? 'up' : 'down'}">${formatMoney(pnlValue)}</div>`;
      recent.appendChild(row);
    });
  }

  const riskLocked = state.risk.last_changed_date === new Date().toISOString().slice(0, 10);
  const saveRiskButton = document.getElementById('saveRiskSettings');
  saveRiskButton.disabled = riskLocked;
  saveRiskButton.textContent = riskLocked ? 'Saved today' : 'Save settings';
  ['dailyLossLimit', 'drawdownLimit', 'exposureLimit'].forEach(id => {
    document.getElementById(id).disabled = riskLocked;
  });
  const nextRiskChange = new Date();
  nextRiskChange.setUTCHours(24, 0, 0, 0);
  const lockNotice = riskLocked ? ` Next change after ${nextRiskChange.toISOString().slice(0, 16).replace('T', ' ')} UTC.` : '';
  const riskText = `Saved limits: daily ${Number(state.risk.daily_loss_percent).toFixed(1)}%, drawdown ${Number(state.risk.max_drawdown_percent).toFixed(1)}%, exposure ${Number(state.risk.exposure_percent).toFixed(1)}%. Not enforced on broker trades.${lockNotice}`;
  document.getElementById('riskSummary').textContent = riskText;
  document.getElementById('riskDetail').textContent = riskText;
  document.getElementById('dailyLossLimit').value = state.risk.daily_loss_percent;
  document.getElementById('drawdownLimit').value = state.risk.max_drawdown_percent;
  document.getElementById('exposureLimit').value = state.risk.exposure_percent;

  const points = [...trades].reverse().slice(-24);
  const curve = document.getElementById('equityCurve');
  if (points.length) {
    let running = 0;
    const values = points.map(trade => running += Number(trade.pnl));
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const span = max - min || 1;
    const coords = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 420},${72 - ((value - min) / span) * 60}`);
    curve.innerHTML = `<polyline points="${coords.join(' ')}" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else {
    curve.replaceChildren();
  }
  const bars = document.getElementById('performanceBars');
  bars.replaceChildren();
  const barValues = points.slice(-8).map(trade => Number(trade.pnl));
  const largest = Math.max(1, ...barValues.map(value => Math.abs(value)));
  barValues.forEach(value => {
    const bar = document.createElement('span');
    bar.style.height = `${Math.max(12, Math.abs(value) / largest * 90)}%`;
    bar.style.background = value >= 0 ? 'linear-gradient(180deg, #4ade80, #22c55e)' : 'linear-gradient(180deg, #f87171, #dc2626)';
    bars.appendChild(bar);
  });
  if (!barValues.length) bars.innerHTML = '<span class="muted">No trades yet</span>';
}

async function loadState() {
  const result = await api('state');
  state.user = result.user;
  state.accounts = result.accounts;
  state.trades = result.trades;
  state.risk = result.risk;
  state.stats = result.stats;
  renderAccounts();
  renderHistory();
  renderDashboard();
  renderAnalytics();
  document.getElementById('profileDisplayName').value = state.user.display_name || '';
  document.getElementById('profileEmail').value = state.user.email || '';
  document.getElementById('profileTimezone').value = state.user.timezone || 'UTC';
  document.getElementById('profileCurrency').value = state.user.base_currency || 'USD';
  const authAction = document.getElementById('authAction');
  authAction.textContent = state.user.display_name || state.user.email;
  authAction.dataset.page = 'settings';
  document.getElementById('logoutBtn').hidden = false;
}

function openModal(id) {
  document.getElementById(id)?.classList.add('visible');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('visible');
}

function resetTradeForm() {
  state.editingTradeId = null;
  document.getElementById('tradeModalTitle').textContent = 'Add trade';
  document.getElementById('submitTradeBtn').textContent = 'Save trade';
  document.getElementById('tradeDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('tradePnl').value = '0';
  document.getElementById('tradeNotes').value = '';
}

document.querySelectorAll('.nav-item, [data-page]').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    showPage(button.dataset.page);
  });
});

const searchInput = document.getElementById('globalSearch');
const searchResults = document.getElementById('searchResults');
const searchablePages = [
  ['Account Overview', 'dashboard'], ['Trading Accounts', 'accounts'], ['Trading History', 'history'],
  ['Trading Calendar', 'calendar'], ['Analytics', 'analytics'], ['Risk Guard', 'risk'],
  ['Prediction Game', 'prediction'], ['Pricing', 'pricing'], ['Subscription & Billing', 'billing'],
  ['Settings', 'settings'], ['Notifications', 'notifications'], ['Support', 'support'],
  ['Terms of Service', 'terms'], ['Privacy Policy', 'privacy'], ['Refund Policy', 'refund'],
  ['Trading Risk Disclaimer', 'disclaimer'], ['Cookie Policy', 'cookies'],
];

function renderSearchResults() {
  const query = searchInput.value.trim().toLowerCase();
  searchResults.replaceChildren();
  if (!query) {
    searchResults.hidden = true;
    return;
  }
  const results = searchablePages
    .filter(([label, page]) => label.toLowerCase().includes(query) && (state.user || ['pricing', 'terms', 'privacy', 'refund', 'disclaimer', 'cookies'].includes(page)))
    .slice(0, 5)
    .map(([label, page]) => ({ label, detail: 'Page', page }));
  if (state.user) {
    state.accounts.filter(account => account.name.toLowerCase().includes(query)).slice(0, 3)
      .forEach(account => results.push({ label: account.name, detail: 'Trading account', page: 'accounts' }));
    state.trades.filter(trade => `${trade.symbol} ${trade.account} ${trade.notes || ''}`.toLowerCase().includes(query)).slice(0, 5)
      .forEach(trade => results.push({ label: `${trade.symbol} · ${trade.account}`, detail: 'Journal trade', page: 'history', query: trade.symbol }));
  }
  if (!results.length) results.push({ label: 'No matching pages or journal entries', detail: '', page: '' });
  results.forEach(result => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';
    button.setAttribute('role', 'option');
    button.textContent = result.detail ? `${result.label} · ${result.detail}` : result.label;
    button.disabled = !result.page;
    button.addEventListener('click', () => {
      if (!result.page) return;
      showPage(result.page);
      if (result.query) {
        document.getElementById('historySearch').value = result.query;
        renderHistory();
      }
      searchResults.hidden = true;
      searchInput.value = '';
    });
    searchResults.appendChild(button);
  });
  searchResults.hidden = false;
}

searchInput.addEventListener('input', renderSearchResults);
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') searchResults.hidden = true;
  if (event.key === 'Enter') {
    event.preventDefault();
    searchResults.querySelector('.search-result:not(:disabled)')?.click();
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.search-wrap')) searchResults.hidden = true;
});
document.getElementById('analyticsRange').addEventListener('change', renderAnalytics);

document.querySelectorAll('[data-close-modal]').forEach(button => {
  button.addEventListener('click', () => closeModal(button.dataset.closeModal));
});

document.querySelectorAll('.auth-toggle button').forEach(button => {
  button.addEventListener('click', () => {
    state.authMode = button.dataset.authMode;
    document.querySelectorAll('.auth-toggle button').forEach(tab => tab.classList.toggle('active', tab === button));
    document.getElementById('authSubmit').textContent = state.authMode === 'register' ? 'Create account' : 'Sign in';
    document.getElementById('authPassword').autocomplete = state.authMode === 'register' ? 'new-password' : 'current-password';
    document.querySelectorAll('[data-register-only]').forEach(field => {
      field.hidden = state.authMode !== 'register';
      field.querySelector('input').required = state.authMode === 'register';
    });
    clearAuthMessage();
  });
});

document.getElementById('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearAuthMessage();
  const submit = document.getElementById('authSubmit');
  submit.disabled = true;
  try {
    const password = document.getElementById('authPassword').value;
    if (state.authMode === 'register' && password !== document.getElementById('authConfirmPassword').value) {
      throw new Error('Passwords do not match.');
    }
    const result = await api(state.authMode, 'POST', {
      display_name: document.getElementById('authDisplayName').value.trim(),
      email: document.getElementById('authEmail').value,
      password,
    });
    state.user = result.user;
    await loadState();
    showPage('dashboard');
    document.getElementById('authForm').reset();
    const message = state.authMode === 'register' ? 'Account created.' : 'Signed in.';
    showToast(LOCAL_PREVIEW ? `${message} Local preview only; credentials are not verified.` : message);
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    submit.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api('logout', 'POST', {});
    state.user = null;
    state.accounts = [];
    state.trades = [];
    document.getElementById('logoutBtn').hidden = true;
    document.getElementById('authAction').textContent = 'Log in';
    document.getElementById('authAction').dataset.page = 'auth';
    showPage('auth');
    showToast('Signed out.');
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById('profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('profileMessage');
  const submit = document.getElementById('saveProfileBtn');
  const display_name = document.getElementById('profileDisplayName').value.trim();
  if (display_name.length < 2 || display_name.length > 80) {
    message.hidden = false;
    message.textContent = 'Display name must be between 2 and 80 characters.';
    return;
  }
  submit.disabled = true;
  message.hidden = true;
  try {
    await api('profile-save', 'POST', {
      display_name,
      timezone: document.getElementById('profileTimezone').value,
      base_currency: document.getElementById('profileCurrency').value,
    });
    await loadState();
    message.hidden = false;
    message.textContent = 'Profile saved.';
    message.style.borderColor = 'rgba(32,201,151,0.3)';
    message.style.background = 'rgba(32,201,151,0.1)';
  } catch (error) {
    message.hidden = false;
    message.textContent = error.message;
    message.style.borderColor = 'rgba(248,113,113,0.3)';
    message.style.background = 'rgba(248,113,113,0.1)';
  } finally {
    submit.disabled = false;
  }
});

document.getElementById('addAccountBtn').addEventListener('click', () => openModal('addAccountModal'));
document.getElementById('saveAccountBtn').addEventListener('click', async () => {
  const name = document.getElementById('accountNameInput').value.trim();
  const balanceField = document.getElementById('accountBalanceInput');
  const balance = balanceField.value;
  if (!name || balance === '' || !balanceField.checkValidity()) {
    showToast('Enter an account name and a valid starting balance.');
    return;
  }
  try {
    await api('account-create', 'POST', {
      name,
      broker: document.getElementById('accountBrokerInput').value.trim() || 'Manual',
      platform: document.getElementById('accountPlatformInput').value,
      type: document.getElementById('accountTypeInput').value,
      balance: Number(balance),
    });
    document.getElementById('accountNameInput').value = '';
    document.getElementById('accountBrokerInput').value = '';
    closeModal('addAccountModal');
    await loadState();
    showToast('Manual account saved. Not connected to a broker.');
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById('accountList').addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-account]');
  if (!button) return;
  if (!window.confirm('Delete this account and its journal trades?')) return;
  try {
    await api('account-delete', 'POST', { id: Number(button.dataset.deleteAccount) });
    await loadState();
    showToast('Account and its trades deleted.');
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById('dashboardAccount').addEventListener('change', event => {
  state.selectedAccount = event.target.value;
  renderDashboard();
});

['historySearch', 'historyAccountFilter', 'historyInstrumentFilter', 'historyOutcomeFilter', 'historyDateFilter'].forEach(id => {
  document.getElementById(id).addEventListener('input', renderHistory);
  document.getElementById(id).addEventListener('change', renderHistory);
});

document.getElementById('addTradeBtn').addEventListener('click', () => {
  if (!state.accounts.length) {
    showToast('Add a manual account before adding a trade.');
    showPage('accounts');
    return;
  }
  resetTradeForm();
  accountOptions(document.getElementById('tradeAccount'));
  openModal('addTradeModal');
});

document.querySelector('#historyTable tbody').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit-trade]');
  const remove = event.target.closest('[data-delete-trade]');
  if (edit) {
    const trade = state.trades.find(item => String(item.id) === edit.dataset.editTrade);
    if (!trade) return;
    state.editingTradeId = Number(trade.id);
    accountOptions(document.getElementById('tradeAccount'));
    document.getElementById('tradeAccount').value = String(trade.account_id);
    document.getElementById('tradeSymbol').value = trade.symbol;
    document.getElementById('tradeSide').value = trade.side;
    document.getElementById('tradeLots').value = trade.lots;
    document.getElementById('tradeEntry').value = trade.entry;
    document.getElementById('tradeExit').value = trade.exit;
    document.getElementById('tradePnl').value = trade.pnl;
    document.getElementById('tradeDate').value = trade.date;
    document.getElementById('tradeNotes').value = trade.notes || '';
    document.getElementById('tradeModalTitle').textContent = 'Edit trade';
    document.getElementById('submitTradeBtn').textContent = 'Save changes';
    openModal('addTradeModal');
  }
  if (remove) {
    if (!window.confirm('Delete this journal trade?')) return;
    try {
      await api('trade-delete', 'POST', { id: Number(remove.dataset.deleteTrade) });
      await loadState();
      showToast('Trade deleted.');
    } catch (error) {
      showToast(error.message);
    }
  }
});

document.getElementById('submitTradeBtn').addEventListener('click', async () => {
  const fields = ['tradeAccount', 'tradeSymbol', 'tradeLots', 'tradeEntry', 'tradeExit', 'tradePnl', 'tradeDate'];
  const invalidField = fields.map(id => document.getElementById(id)).find(field => !field.value || !field.checkValidity());
  if (invalidField) {
    invalidField.reportValidity();
    return;
  }
  const payload = {
    id: state.editingTradeId,
    account_id: Number(document.getElementById('tradeAccount').value),
    symbol: document.getElementById('tradeSymbol').value,
    side: document.getElementById('tradeSide').value,
    lots: Number(document.getElementById('tradeLots').value),
    entry: Number(document.getElementById('tradeEntry').value),
    exit: Number(document.getElementById('tradeExit').value),
    pnl: Number(document.getElementById('tradePnl').value),
    traded_at: document.getElementById('tradeDate').value,
    notes: document.getElementById('tradeNotes').value,
  };
  try {
    await api(state.editingTradeId ? 'trade-update' : 'trade-create', 'POST', payload);
    closeModal('addTradeModal');
    await loadState();
    showToast(state.editingTradeId ? 'Trade updated.' : 'Trade saved.');
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById('saveRiskSettings').addEventListener('click', async () => {
  if (state.risk.last_changed_date === new Date().toISOString().slice(0, 10)) {
    showToast('Risk settings can only be changed once per UTC day.');
    return;
  }
  const payload = {
    daily_loss_percent: Number(document.getElementById('dailyLossLimit').value),
    max_drawdown_percent: Number(document.getElementById('drawdownLimit').value),
    exposure_percent: Number(document.getElementById('exposureLimit').value),
  };
  if (Object.values(payload).some(value => !Number.isFinite(value) || value <= 0 || value > 100)) {
    showToast('Risk preferences must be between 0 and 100%.');
    return;
  }
  try {
    await api('risk-save', 'POST', payload);
    await loadState();
    showToast('Risk preferences saved. They do not enforce broker limits.');
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById('simulateLimitBtn').addEventListener('click', () => openModal('riskLockModal'));

document.querySelectorAll('.pricing-toggle button').forEach(button => {
  button.addEventListener('click', () => {
    state.frequency = button.dataset.frequency;
    document.querySelectorAll('.pricing-toggle button').forEach(tab => tab.classList.toggle('active', tab === button));
    const prices = {
      monthly: ['$0', '$29', '$59', '/mo'],
      quarterly: ['$0', '$79', '$159', '/3 mo'],
      semiannual: ['$0', '$149', '$299', '/6 mo'],
      yearly: ['$0', '$279', '$549', '/yr'],
    }[state.frequency];
    document.querySelector('[data-price-free]').textContent = prices[0];
    document.querySelector('[data-price-premium]').textContent = prices[1];
    document.querySelector('[data-price-elite]').textContent = prices[2];
    document.querySelectorAll('.plan .frequency').forEach(label => label.textContent = prices[3]);
  });
});

document.querySelectorAll('[data-demo-checkout]').forEach(button => {
  button.textContent = 'Payments not enabled';
  button.classList.add('secondary-btn');
  button.disabled = true;
});

document.querySelectorAll('.page[data-page-name="home"], .page[data-page-name="analytics"], .page[data-page-name="calendar"], .page[data-page-name="prediction"], .page[data-page-name="billing"], .page[data-page-name="settings"], .page[data-page-name="notifications"], .page[data-page-name="support"], .page.legal-page').forEach(section => {
  const notice = document.createElement('div');
  notice.className = 'status-banner';
  notice.textContent = 'Preview only. This page is not connected to live market, payment, or broker services.';
  section.prepend(notice);
});

let selectedDirection = null;
function chooseDirection(direction) {
  selectedDirection = direction;
  document.getElementById('buyChoice').style.outline = direction === 'Buy' ? '2px solid rgba(59,130,246,0.8)' : 'none';
  document.getElementById('sellChoice').style.outline = direction === 'Sell' ? '2px solid rgba(59,130,246,0.8)' : 'none';
  document.getElementById('buyChoice').setAttribute('aria-pressed', String(direction === 'Buy'));
  document.getElementById('sellChoice').setAttribute('aria-pressed', String(direction === 'Sell'));
}
document.getElementById('buyChoice').addEventListener('click', () => chooseDirection('Buy'));
document.getElementById('sellChoice').addEventListener('click', () => chooseDirection('Sell'));
let gameAttempts = 3;
document.getElementById('attemptCount').textContent = String(gameAttempts);
let syntheticClose = 50;
function createSyntheticCandle(direction = null) {
  const open = syntheticClose;
  const sign = direction === null ? (Math.random() > 0.5 ? 1 : -1) : direction ? 1 : -1;
  const movement = direction === null ? (Math.random() - 0.5) * 14 : sign * (4 + Math.random() * 8) + (Math.random() - 0.5) * 3;
  const close = Math.min(94, Math.max(6, open + movement));
  const high = Math.min(98, Math.max(open, close) + Math.random() * 9);
  const low = Math.max(2, Math.min(open, close) - Math.random() * 9);
  syntheticClose = close;
  const candle = document.createElement('div');
  candle.className = `candle ${close >= open ? 'up' : 'down'}`;
  candle.setAttribute('aria-hidden', 'true');
  const wick = document.createElement('span');
  wick.className = 'wick';
  wick.style.top = `${100 - high}%`;
  wick.style.height = `${high - low}%`;
  const body = document.createElement('span');
  body.className = 'body';
  body.style.top = `${100 - Math.max(open, close)}%`;
  body.style.height = `${Math.max(2, Math.abs(close - open))}%`;
  candle.append(wick, body);
  return { candle, isUp: close >= open };
}
function renderSyntheticCandles() {
  const chart = document.getElementById('syntheticCandles');
  chart.replaceChildren();
  for (let index = 0; index < 60; index += 1) {
    chart.appendChild(createSyntheticCandle().candle);
  }
}
renderSyntheticCandles();
document.getElementById('confirmPrediction').addEventListener('click', () => {
  const result = document.getElementById('predictionResult');
  if (!selectedDirection) {
    result.textContent = 'Choose Buy or Sell first. Result is synthetic, not a market prediction.';
    return;
  }
  if (!gameAttempts) {
    result.textContent = 'Attempts exhausted. The result is a simulation, not a market prediction.';
    return;
  }
  const isWin = Math.random() > 0.5;
  const candleDirection = selectedDirection === 'Buy' ? isWin : !isWin;
  const chart = document.getElementById('syntheticCandles');
  chart.appendChild(createSyntheticCandle(candleDirection).candle);
  chart.firstElementChild?.remove();
  gameAttempts -= 1;
  document.getElementById('attemptCount').textContent = String(gameAttempts);
  result.textContent = `Simulated ${isWin ? 'WIN' : 'LOSS'} — the one-hour synthetic chart moved. Not a market prediction.`;
  chooseDirection(null);
});

async function initialize() {
  const submit = document.getElementById('authSubmit');
  submit.disabled = true;
  try {
    const csrfResult = await api('csrf');
    state.csrfToken = csrfResult.csrf_token;
    await loadState();
    showPage('dashboard');
  } catch (error) {
    state.user = null;
    showPage('auth');
    if (error.message.includes('Please sign in')) {
      clearAuthMessage();
    } else {
      showAuthMessage(error.message);
    }
  } finally {
    submit.disabled = false;
  }
}

initialize();