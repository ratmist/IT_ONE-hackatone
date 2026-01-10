import { esc } from './core.js';
import { TransactionsAPI } from './data.js';
import { globalUploadManager } from './upload-manager.js';

const state = { 
  transactions: [], 
  q: '', 
  type: '', 
  status: '', 
  sort: 'raw', 
  page: 1, 
  pageSize: 50,
  totalCount: 0,
  totalPages: 1 
};

let isLocalProgressVisible = false;
let isUpdatingProgress = false;

export async function initTransactionPage() {
  await loadTransactions();
  initCustomFilters();
  initFileUpload();
  initUploadListeners();
  initCSVExport();
}

function initUploadListeners() {
  globalUploadManager.subscribe((state) => {
    if (state.uploadInProgress && state.currentUploadStats) {
      if (isLocalProgressVisible) {
        updateProgressBarUI(
          state.currentUploadStats.percentage,
          state.currentUploadStats.current,
          state.currentUploadStats.total,
          state.currentUploadStats.chunkInfo
        );
      }
    }
  });
}

async function loadTransactions() {
  const filters = {
    type: state.type,
    status: state.status,
    search: state.q,
    sort: state.sort
  };
  
  const result = await TransactionsAPI.list(state.page, state.pageSize, filters);
  state.transactions = result.transactions;
  state.totalCount = result.totalCount;
  state.totalPages = result.totalPages;
  render();
  scrollToTop();
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'auto'
  });
}

function initCustomFilters() {
  document.addEventListener('click', e => {
    document.querySelectorAll('.select-ui.open').forEach(el => {
      if (!el.contains(e.target)) el.classList.remove('open');
    });
  });

  document.querySelectorAll('.select-ui').forEach(wrap => {
    const btn = wrap.querySelector('.select-btn');
    const menu = wrap.querySelector('.select-menu');
    const name = wrap.dataset.name;
    const def = wrap.dataset.default ?? '';

    const initLi = menu.querySelector(`[data-value="${def}"]`) || menu.querySelector('li');
    if (initLi) {
      menu.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === initLi));
      btn.textContent = initLi.textContent;
    }

    btn.addEventListener('click', () => wrap.classList.toggle('open'));
    menu.addEventListener('click', async e => {
      const li = e.target.closest('li');
      if (!li) return;

      menu.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === li));
      btn.textContent = li.textContent;
      wrap.classList.remove('open');

      const val = li.dataset.value;
      if (name === 'type') state.type = val;
      if (name === 'status') state.status = val;
      if (name === 'date') state.sort = val;
      if (name === 'amount') state.sort = val;

      state.page = 1;
      await loadTransactions();
    });
  });

  const searchInput = document.querySelector('input[type="search"]');
  if (searchInput) {
    const debounce = (func, wait) => {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    };

    searchInput.addEventListener('input', debounce(async (e) => {
      state.q = e.target.value.toLowerCase();
      state.page = 1;
      await loadTransactions();
    }, 300));
  }
}

function initFileUpload() {
  const createBtn = document.getElementById('createBtn');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.style.display = 'none';
  
  createBtn.addEventListener('click', () => fileInput.click());
  
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      showProgressBar();
      await processJsonFile(file);
      state.page = 1;
      await loadTransactions();
    } catch (error) {
      alert('Ошибка при загрузке файла: ' + error.message);
    } finally {
      fileInput.value = '';
    }
  });
  
  document.body.appendChild(fileInput);
}

function showProgressBar() {
  showProgressBarWithData();
}

function showProgressBarWithData(stats = null) {
  const globalProgress = document.getElementById('globalMiniProgressContainer');
  if (globalProgress) {
    globalProgress.remove();
  }
  
  isLocalProgressVisible = true;
  
  let progressContainer = document.getElementById('uploadProgressContainer');
  if (progressContainer) {
    progressContainer.classList.remove('minimized');
    if (stats) {
      updateProgressBarUI(
        stats.percentage,
        stats.current,
        stats.total,
        stats.chunkInfo
      );
    }
    return;
  }

  progressContainer = document.createElement('div');
  progressContainer.id = 'uploadProgressContainer';
  progressContainer.className = 'progress-container';

  const progressBox = document.createElement('div');
  progressBox.className = 'progress-box';

  const progressHeader = document.createElement('div');
  progressHeader.className = 'progress-header';

  const progressTitle = document.createElement('h3');
  progressTitle.textContent = 'Загрузка транзакций';
  progressTitle.className = 'progress-title';

  const closeButton = document.createElement('button');
  closeButton.innerHTML = '&times;';
  closeButton.className = 'progress-close-btn';
  closeButton.onclick = () => {
    isLocalProgressVisible = false;
    hideProgressBar();
  };

  progressHeader.appendChild(progressTitle);
  progressHeader.appendChild(closeButton);

  const progressBarContainer = document.createElement('div');
  progressBarContainer.className = 'progress-bar-container';

  const progressBar = document.createElement('div');
  progressBar.id = 'uploadProgressBar';
  progressBar.className = 'progress-bar';

  const progressText = document.createElement('div');
  progressText.id = 'uploadProgressText';
  progressText.className = 'progress-text';

  const progressDetails = document.createElement('div');
  progressDetails.id = 'uploadProgressDetails';
  progressDetails.className = 'progress-details';

  const minimizeButton = document.createElement('button');
  minimizeButton.id = 'minimizeProgressBtn';
  minimizeButton.textContent = 'Свернуть';
  minimizeButton.className = 'btn-minimize';
  minimizeButton.onclick = () => {
    minimizeProgressBar();
  };

  progressBarContainer.appendChild(progressBar);
  progressBox.appendChild(progressHeader);
  progressBox.appendChild(progressText);
  progressBox.appendChild(progressBarContainer);
  progressBox.appendChild(progressDetails);
  progressBox.appendChild(minimizeButton);
  progressContainer.appendChild(progressBox);

  document.body.appendChild(progressContainer);
  if (stats) {
    updateProgressBarUI(
      stats.percentage,
      stats.current,
      stats.total,
      stats.chunkInfo
    );
  } else {
    progressText.textContent = 'Подготовка к загрузке...';
  }
}

function minimizeProgressBar() {
  const progressContainer = document.getElementById('uploadProgressContainer');
  if (progressContainer) {
    progressContainer.classList.add('minimized');
    isLocalProgressVisible = false;
    const currentStats = globalUploadManager.getState().currentUploadStats;
    if (currentStats) {
      let miniProgress = document.getElementById('miniProgressContainer');
      if (!miniProgress) {
        miniProgress = document.createElement('div');
        miniProgress.id = 'miniProgressContainer';
        miniProgress.className = 'mini-progress-container';
        
        const progressPercent = currentStats.percentage || 0;
        
        miniProgress.innerHTML = `
          <div class="mini-progress-content">
            <span>Загрузка... ${progressPercent}%</span>
            <div class="mini-progress-bar">
              <div id="miniProgressBar" class="mini-progress-bar-fill" style="width: ${progressPercent}%"></div>
            </div>
            <button id="expandProgressBtn" class="btn-expand">↑</button>
            <button id="cancelUploadBtn" class="btn-cancel">×</button>
          </div>
        `;
        document.body.appendChild(miniProgress);
        document.getElementById('expandProgressBtn').onclick = expandProgressBar;
        document.getElementById('cancelUploadBtn').onclick = cancelUpload;
      }
    }
  }
}

function expandProgressBar() {
  const progressContainer = document.getElementById('uploadProgressContainer');
  if (progressContainer) {
    progressContainer.classList.remove('minimized');
    isLocalProgressVisible = true;
    const currentStats = globalUploadManager.getState().currentUploadStats;
    if (currentStats) {
      updateProgressBarUI(
        currentStats.percentage,
        currentStats.current,
        currentStats.total,
        currentStats.chunkInfo
      );
    }
  }
  
  const miniProgress = document.getElementById('miniProgressContainer');
  if (miniProgress) {
    miniProgress.remove();
  }
}

function hideProgressBar() {
  minimizeProgressBar();
}

function cancelUpload() {
  if (confirm('Вы уверены, что хотите отменить загрузку?')) {
    isLocalProgressVisible = false;
    globalUploadManager.cancelUpload();
    
    const miniProgress = document.getElementById('miniProgressContainer');
    if (miniProgress) {
      miniProgress.remove();
    }
    
    const progressContainer = document.getElementById('uploadProgressContainer');
    if (progressContainer) {
      progressContainer.remove();
    }
    
    const globalProgress = document.getElementById('globalMiniProgressContainer');
    if (globalProgress) {
      globalProgress.remove();
    }
  }
}

function updateProgressBar(percentage, current, total, chunkInfo = '') {
  isUpdatingProgress = true;
  globalUploadManager.updateProgress({ percentage, current, total, chunkInfo });
  isUpdatingProgress = false;
  updateProgressBarUI(percentage, current, total, chunkInfo);
}

function updateProgressBarUI(percentage, current, total, chunkInfo = '') {
  const progressBar = document.getElementById('uploadProgressBar');
  const progressText = document.getElementById('uploadProgressText');
  const progressDetails = document.getElementById('uploadProgressDetails');
  const miniProgressBar = document.getElementById('miniProgressBar');
  const globalMiniProgressBar = document.getElementById('globalMiniProgressBar');

  if (progressBar) {
    progressBar.style.width = `${percentage}%`;
  }

  if (miniProgressBar) {
    miniProgressBar.style.width = `${percentage}%`;
  }

  if (globalMiniProgressBar) {
    globalMiniProgressBar.style.width = `${percentage}%`;
    const globalText = document.querySelector('#globalMiniProgressContainer span');
    if (globalText) {
      globalText.textContent = `Загрузка транзакций... ${percentage}%`;
    }
  }

  if (progressText) {
    progressText.textContent = `Загружено: ${current} из ${total} транзакций (${percentage}%)`;
  }

  if (progressDetails && chunkInfo) {
    progressDetails.textContent = chunkInfo;
  }
}

async function processJsonFile(file) {
  globalUploadManager.startUpload();
  
  const text = await readFileAsText(file);
  const data = JSON.parse(text);
  const transactions = Array.isArray(data) ? data : data.transactions ? data.transactions : [data];
  
  if (!transactions.length) {
    globalUploadManager.finishUpload();
    isLocalProgressVisible = false;
    throw new Error('Файл не содержит транзакций');
  }
  
  updateProgressBar(0, 0, transactions.length, `Обнаружено ${transactions.length} транзакций. Начинаем загрузку...`);

  const CHUNK_SIZE = 90000;
  let successfulUploads = 0;
  let failedUploads = 0;
  
  for (let i = 0; i < transactions.length && globalUploadManager.getState().uploadInProgress; i += CHUNK_SIZE) {
    const chunk = transactions.slice(i, i + CHUNK_SIZE);
    const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(transactions.length / CHUNK_SIZE);
    
    try {
      updateProgressBar(
        Math.round((i / transactions.length) * 100),
        i,
        transactions.length,
        `Обрабатывается чанк ${chunkNumber}/${totalChunks}`
      );
      
      await uploadChunk(chunk);
      successfulUploads += chunk.length;
      
      const currentProgress = Math.min(Math.round(((i + chunk.length) / transactions.length) * 100), 100);
      updateProgressBar(
        currentProgress,
        i + chunk.length,
        transactions.length,
        `Успешно загружено: ${successfulUploads} транзакций`
      );
      
    } catch (error) {
      if (!globalUploadManager.getState().uploadInProgress) break;
      
      failedUploads += chunk.length;
      updateProgressBar(
        Math.round((i / transactions.length) * 100),
        i,
        transactions.length,
        `Ошибка при загрузке чанка ${chunkNumber}/${totalChunks}: ${error.message}`
      );
    }
  }
  
  if (globalUploadManager.getState().uploadInProgress) {
    updateProgressBar(100, transactions.length, transactions.length, 'Загрузка завершена!');
    await new Promise(resolve => setTimeout(resolve, 1000));
    showUploadResult(successfulUploads, failedUploads);
    isLocalProgressVisible = false;
    const miniProgress = document.getElementById('miniProgressContainer');
    if (miniProgress) {
      miniProgress.remove();
    }
    
    const progressContainer = document.getElementById('uploadProgressContainer');
    if (progressContainer) {
      progressContainer.remove();
    }
    
    const globalProgress = document.getElementById('globalMiniProgressContainer');
    if (globalProgress) {
      globalProgress.remove();
    }
    
    globalUploadManager.finishUpload();
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsText(file);
  });
}

async function uploadChunk(chunk) {
  const response = await fetch('http://127.0.0.1:8000/api/transactions/stream/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transactions: chunk })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${response.status}`);
  }
  
  return await response.json();
}

function showUploadResult(successful, failed) {
  let message = `Успешно загружено: ${successful} транзакций`;
  if (failed > 0) {
    message += `\nНе удалось загрузить: ${failed} транзакций`;
  }
  if (globalUploadManager.getState().uploadInProgress) {
    setTimeout(() => {
      alert(message);
    }, 100);
  }
}

function render() {
  const box = document.getElementById('list');
  box.innerHTML = '';

  state.transactions.forEach(r => {
    const el = document.createElement('div');
    el.className = 'row';
    el.innerHTML = `
      <div class="muted">${esc(r.correlation_id)}</div>
      <div>${esc(r.typeLabel)}</div>
      <div class="muted">${r.tsLabel}</div>
      <div><strong>${r.amountLabel}</strong></div>
      <div><span class="badge ${r.status}">${r.statusLabel}</span></div>
      <div>${getReviewedBadge(r.is_reviewed)}</div>
      <div><a class="link" href="./transaction-details.html?correlation_id=${encodeURIComponent(r.correlation_id)}" title="Подробнее">Подробнее</a></div>
    `;
    box.appendChild(el);
  });

  if (!state.transactions.length) {
    const e = document.createElement('div');
    e.style.cssText = 'padding:24px;color:#9aa4b2;text-align:center;border-top:1px solid var(--border);';
    e.textContent = 'Ничего не найдено';
    box.appendChild(e);
  }

  renderPagination();
}

function renderPagination() {
  const pager = document.getElementById('pager');
  pager.innerHTML = '';

  const makeBtn = (label, page, disabled = false, active = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'page-btn' + (active ? ' active' : '');
    b.disabled = disabled;
    b.onclick = async () => { 
      state.page = page; 
      await loadTransactions();
    };
    return b;
  };

  pager.appendChild(makeBtn('‹', state.page - 1, state.page === 1));
  const windowSize = 1;
  const start = Math.max(1, state.page - windowSize);
  const end = Math.min(state.totalPages, state.page + windowSize);

  if (start > 1) {
    pager.appendChild(makeBtn(1, 1, false, state.page === 1));
    if (start > 2) pager.appendChild(ellipsis());
  }

  for (let p = start; p <= end; p++) {
    pager.appendChild(makeBtn(p, p, false, p === state.page));
  }

  if (end < state.totalPages) {
    if (end < state.totalPages - 1) pager.appendChild(ellipsis());
    pager.appendChild(makeBtn(state.totalPages, state.totalPages, false, state.page === state.totalPages));
  }
  pager.appendChild(makeBtn('›', state.page + 1, state.page === state.totalPages));
  const stat = document.createElement('div');
  stat.className = 'pager-stat';
  const startItem = (state.page - 1) * state.pageSize + 1;
  const endItem = Math.min(state.page * state.pageSize, state.totalCount);
  stat.textContent = `Показано ${startItem}-${endItem} из ${state.totalCount} записей`;
  pager.appendChild(stat);
}

function ellipsis() {
  const span = document.createElement('span');
  span.textContent = '…';
  span.className = 'ellipsis';
  return span;
}

function getReviewedBadge(is_reviewed) {
  if (is_reviewed) {
    return '<span class="pill pill-reviewed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg></span>';
  } else {
    return '<span class="pill pill-not-reviewed"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>';
  }
}

function elSet(id, text, opts = {}) {
  const el = document.getElementById(id);
  if (el) {
    if (opts.html) {
      el.innerHTML = text;
    } else {
      el.textContent = text;
    }
  }
}

function badge(status) {
  const label = status === 'danger' ? 'Подозрительная' : 'Успешная';
  const cls = status === 'danger' ? 'danger' : 'success';
  return `<span class="badge ${cls}">${label}</span>`;
}

export async function initTransactionDetailPage() {
  const correlation_id = new URLSearchParams(location.search).get('correlation_id');
  if (!correlation_id) return;
  const data = await TransactionsAPI.detail(correlation_id);
  if (!data) return;
  elSet('txTitle', `Транзакция: ${correlation_id}`);
  elSet('txId', data.transaction_id || '—');
  elSet('txCorrelationId', correlation_id);
  elSet('txTime', data.ts);
  elSet('txAmount', data.amount);
  elSet('txStatus', badge(data.status), { html: true });
  elSet('txSender', data.sender_account || '—', { html: true });
  elSet('txReceiver', data.receiver_account || '—', { html: true });
  elSet('txLocation', data.location || '—', { html: true });
  elSet('txType', data.type);
  elSet('txMerchant', data.merchant_category || '—', { html: true });
  elSet('txDevice', data.device_used || '—', { html: true });
  elSet('txChannel', data.payment_channel || '—', { html: true });
  elSet('txIp', data.ip_address || '—', { html: true });
  elSet('txHash', data.device_hash || '—', { html: true });
  elSet('txLast', data.time_since_last_transaction || '0', { html: true });
  elSet('txFraudScore', data.spending_deviation_score || '—', { html: true });
  elSet('txVelocityScore', data.velocity_score || '—', { html: true });
  elSet('txGeoScore', data.geo_anomaly_score || '—', { html: true });
  elSet('txReviewed', data.is_reviewed ? 'Да' : 'Нет', { html: true });
  elSet('txBlock', data.is_fraud ? 'Да' : 'Нет', { html: true });
  addActionButtons(data, correlation_id);
}

function addActionButtons(data, correlation_id) {
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'action-buttons';
  actionsContainer.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); display: flex; gap: 12px; flex-wrap: wrap;';

  const fraudButton = document.createElement('button');
  fraudButton.className = data.is_fraud ? 'btn-accept' : 'btn-decline';
  fraudButton.innerHTML = data.is_fraud ? 
    'Разблокировать транзакцию' : 
    'Заблокировать транзакцию';
  fraudButton.onclick = () => toggleFraudStatus(correlation_id, data.is_fraud);
  
  const reviewButton = document.createElement('button');
  reviewButton.className = data.is_reviewed ? 'btn-muted' : 'btn-check';
  reviewButton.innerHTML = data.is_reviewed ? 
    'Проверено' : 
    'Подтвердить проверку';
  reviewButton.disabled = data.is_reviewed;
  reviewButton.onclick = () => markAsReviewed(correlation_id);

  actionsContainer.appendChild(fraudButton);
  actionsContainer.appendChild(reviewButton);

  const summaryCard = document.getElementById('summary');
  if (summaryCard) {
    summaryCard.appendChild(actionsContainer);
  }
}

async function markAsReviewed(correlation_id) {
  try {
    await TransactionsAPI.markAsReviewed(correlation_id);
    showNotification('Транзакция отмечена как проверенная', 'success');
    setTimeout(() => {
      location.reload();
    }, 1000);
  } catch (err) {
    alert('Ошибка при подтверждении просмотра: ' + err.message);
  }
}

async function toggleFraudStatus(correlation_id, currentStatus) {
  try {
    await TransactionsAPI.toggleFraudStatus(correlation_id, currentStatus);
    showNotification(`Статус блокировки обновлен: ${!currentStatus ? 'Заблокировано' : 'Разблокировано'}`, 'success');
    setTimeout(() => {
      location.reload();
    }, 1000);
  } catch (err) {
    alert('Ошибка при изменении статуса: ' + err.message);
  }
}

function showNotification(message, type = 'info') {
  document.querySelectorAll('.notification').forEach(notification => {
    notification.remove();
  });
  
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#3280fd' : '#f35050'};
    color: white;
    border-radius: 4px;
    z-index: 10000;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    transition: opacity 0.3s ease;
  `;
  
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.opacity = '1';
  }, 10);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 300);
  }, 3000);
}

function initCSVExport() {
  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn-blue';
  exportBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    Выгрузить в CSV
  `;
  exportBtn.addEventListener('click', showExportModal);
  const createBtn = document.getElementById('createBtn');
  createBtn.parentNode.insertBefore(exportBtn, createBtn.nextSibling);
}

function mountSelectUI(container, options, selectedValue = '') {
  if (!container) return;
  
  const name = container.dataset.name;
  const selectedOption = options.find(opt => opt.value === selectedValue) || options[0];
  
  container.innerHTML = `
    <button type="button" class="select-btn">${selectedOption.label}</button>
    <ul class="select-menu">
      ${options.map(opt => `
        <li data-value="${opt.value}" class="${opt.value === selectedValue ? 'active' : ''}">
          ${opt.label}
        </li>
      `).join('')}
    </ul>
  `;

  const btn = container.querySelector('.select-btn');
  const menu = container.querySelector('.select-menu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.select-ui.open').forEach(el => {
      if (el !== container) el.classList.remove('open');
    });
    container.classList.toggle('open');
  });

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const li = e.target.closest('li');
    if (!li) return;

    menu.querySelectorAll('li').forEach(item => item.classList.remove('active'));
    li.classList.add('active');
    btn.textContent = li.textContent;
    container.classList.remove('open');
  });
}


function showExportModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="dialog">
      <div class="rule-header"> 
        <h2>Выгрузка транзакций в CSV</h2>
      </div>
      
      <div class="form-section">
        <div class="form-grid pattern-grid">
          <label class="fieldTitle">Дата начала
            <input type="date" id="exportStartDate" class="input" />
          </label>
          
          <label class="fieldTitle">Дата окончания
            <input type="date" id="exportEndDate" class="input" />
          </label>
          
          <label class="fieldTitle">Тип транзакции
            <div class="select-ui" data-name="exportType"></div>
          </label>
          
          <label class="fieldTitle">Статус
            <div class="select-ui" data-name="exportStatus"></div>
          </label>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn-red" id="cancelExport">Отмена</button>
        <button class="btn-blue" id="confirmExport">Выгрузить в CSV</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  document.getElementById('exportStartDate').value = startDate.toISOString().split('T')[0];
  document.getElementById('exportEndDate').value = endDate.toISOString().split('T')[0];

  const TYPE_OPTIONS = [
    { value: '', label: 'Все типы' },
    { value: 'deposit', label: 'Депозит' },
    { value: 'withdrawal', label: 'Снятие' },
    { value: 'payment', label: 'Оплата' },
    { value: 'transfer', label: 'Перевод' }
  ];

  const STATUS_OPTIONS = [
    { value: '', label: 'Все статусы' },
    { value: 'processed', label: 'Успешные' },
    { value: 'alerted', label: 'Подозрительные' }
  ];

  const typeSelect = modal.querySelector('.select-ui[data-name="exportType"]');
  const statusSelect = modal.querySelector('.select-ui[data-name="exportStatus"]');

  mountSelectUI(typeSelect, TYPE_OPTIONS, '');
  mountSelectUI(statusSelect, STATUS_OPTIONS, '');

  document.getElementById('cancelExport').addEventListener('click', () => {
    modal.remove();
  });

  document.getElementById('confirmExport').addEventListener('click', () => {
    const startDate = document.getElementById('exportStartDate').value;
    const endDate = document.getElementById('exportEndDate').value;
    const type = getSelectValueFromUI(typeSelect);
    const status = getSelectValueFromUI(statusSelect);
    
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      showNotification('Дата начала не может быть больше даты окончания', 'error');
      return;
    }
    
    modal.remove();
    exportToCSV(startDate, endDate, type, status);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.select-ui')) {
      modal.querySelectorAll('.select-ui.open').forEach(el => {
        el.classList.remove('open');
      });
    }
  });
}

function getSelectValueFromUI(selectContainer) {
  if (!selectContainer) return '';
  const activeLi = selectContainer.querySelector('.select-menu li.active');
  return activeLi ? activeLi.dataset.value : '';
}


async function exportToCSV(startDate, endDate, type, status) {
  try {
    showNotification('Начинаем выгрузку данных...', 'info');
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (type) params.append('type', type);
    if (status) params.append('status', status);
    
    const response = await fetch(`http://127.0.0.1:8000/api/transactions/export/?${params}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка сервера: ${response.status} - ${errorText}`);
    }
    
    const blob = await response.blob();
    if (blob.size === 0) {
      throw new Error('Получен пустой файл');
    }
    
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const timestamp = new Date().toISOString().slice(0, 10);
    a.download = `transactions_${timestamp}.csv`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    showNotification('Выгрузка завершена успешно!', 'success');
    
  } catch (error) {
    showNotification(`Ошибка при выгрузке: ${error.message}`, 'error');
  }
}

window.showProgressBar = showProgressBar;
window.showProgressBarWithData = showProgressBarWithData;
window.globalUploadManager = globalUploadManager;