const state = {
  user: null,
  csrfToken: '',
  accounts: [],
  trades: [],
  risk: { daily_loss_percent: 2, max_drawdown_percent: 12, exposure_percent: 4.5 },
  stats: { total_trades: 0, win_rate: 0, pnl: 0 },
  authMode: 'login',
  editingTradeId: null,
  selectedAccount: 'all',
  frequency: 'monthly',
};

const LOCAL_PREVIEW = window.location.protocol === 'file:';
const PREVIEW_USER_KEY = 'tradersheild-preview-user';
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
  try {
    return JSON.parse(sessionStorage.getItem(key)) || {
      accounts: [],
      trades: [],
      risk: { daily_loss_percent: 2, max_drawdown_percent: 12, exposure_percent: 4.5 },
    };
  } catch {
    return {
      accounts: [],
      trades: [],
      risk: { daily_loss_percent: 2, max_drawdown_percent: 12, exposure_percent: 4.5 },
    };
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
      users = JSON.parse(sessionStorage.getItem(PREVIEW_USERS_KEY) || '[]');
    } catch {
      users = [];
    }
    if (action === 'register') {
      if (users.includes(email)) throw new Error('This email already has a local preview account. Sign in instead.');
      users.push(email);
      sessionStorage.setItem(PREVIEW_USERS_KEY, JSON.stringify(users));
    } else if (!users.includes(email)) {
      throw new Error('No local preview account found. Choose Sign up first.');
    }
    sessionStorage.setItem(PREVIEW_USER_KEY, email);
    return { user: { email }, csrf_token: 'local-preview-only' };
  }

  if (action === 'logout') {
    sessionStorage.removeItem(PREVIEW_USER_KEY);
    return { ok: true };
  }
  if (!activeEmail) throw new Error('Please sign in to continue.');

  const record = previewRecord(activeEmail);
  if (action === 'me') return { user: { email: activeEmail }, csrf_token: 'local-preview-only' };
  if (action === 'state') {
    const wins = record.trades.filter(trade => Number(trade.pnl) > 0).length;
    const totalPnl = record.trades.reduce((sum, trade) => sum + Number(trade.pnl), 0);
    return {
      user: { email: activeEmail },
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
    record.risk = data;
    savePreviewRecord(activeEmail, record);
    return { ok: true };
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

  const riskText = `Saved limits: daily ${Number(state.risk.daily_loss_percent).toFixed(1)}%, drawdown ${Number(state.risk.max_drawdown_percent).toFixed(1)}%, exposure ${Number(state.risk.exposure_percent).toFixed(1)}%. Not enforced on broker trades.`;
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
  const authAction = document.getElementById('authAction');
  authAction.textContent = state.user.email;
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

document.querySelectorAll('[data-close-modal]').forEach(button => {
  button.addEventListener('click', () => closeModal(button.dataset.closeModal));
});

document.querySelectorAll('.auth-toggle button').forEach(button => {
  button.addEventListener('click', () => {
    state.authMode = button.dataset.authMode;
    document.querySelectorAll('.auth-toggle button').forEach(tab => tab.classList.toggle('active', tab === button));
    document.getElementById('authSubmit').textContent = state.authMode === 'register' ? 'Create account' : 'Sign in';
    document.getElementById('authPassword').autocomplete = state.authMode === 'register' ? 'new-password' : 'current-password';
    clearAuthMessage();
  });
});

document.getElementById('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearAuthMessage();
  const submit = document.getElementById('authSubmit');
  submit.disabled = true;
  try {
    const result = await api(state.authMode, 'POST', {
      email: document.getElementById('authEmail').value,
      password: document.getElementById('authPassword').value,
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

document.getElementById('buyChoice').addEventListener('click', () => {
  document.getElementById('buyChoice').style.outline = '2px solid rgba(59,130,246,0.6)';
  document.getElementById('sellChoice').style.outline = 'none';
});
document.getElementById('sellChoice').addEventListener('click', () => {
  document.getElementById('sellChoice').style.outline = '2px solid rgba(59,130,246,0.6)';
  document.getElementById('buyChoice').style.outline = 'none';
});
let gameAttempts = 5;
document.getElementById('confirmPrediction').addEventListener('click', () => {
  const result = document.getElementById('predictionResult');
  if (!gameAttempts) {
    result.textContent = 'Attempts exhausted. The result is a simulation, not a market prediction.';
    return;
  }
  gameAttempts -= 1;
  document.getElementById('attemptCount').textContent = String(gameAttempts);
  result.textContent = `Simulated ${Math.random() > 0.5 ? 'WIN' : 'LOSS'} — not a market prediction.`;
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