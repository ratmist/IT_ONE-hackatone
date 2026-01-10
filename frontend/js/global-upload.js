import { globalUploadManager } from './upload-manager.js';
export function initGlobalUploadIndicator() {
  const state = globalUploadManager.getState();
  if (state.uploadInProgress && !isLocalProgressVisible()) {
    showGlobalMiniProgress(state.currentUploadStats);
  }
  globalUploadManager.subscribe((state) => {
    if (state.uploadInProgress && !isLocalProgressVisible()) {
      showGlobalMiniProgress(state.currentUploadStats);
    } else {
      removeGlobalMiniProgress();
    }
  });
}

function isLocalProgressVisible() {
  const localProgress = document.getElementById('uploadProgressContainer');
  return localProgress && !localProgress.classList.contains('minimized');
}

function showGlobalMiniProgress(stats) {
  removeGlobalMiniProgress();
  
  const miniProgress = document.createElement('div');
  miniProgress.id = 'globalMiniProgressContainer';
  miniProgress.className = 'mini-progress-container global-upload-indicator';
  
  const progressPercent = stats?.percentage || 0;
  const current = stats?.current || 0;
  const total = stats?.total || 0;
  
  miniProgress.innerHTML = `
    <div class="mini-progress-content">
      <span>Загрузка транзакций... ${progressPercent}%</span>
      <div class="mini-progress-bar">
        <div id="globalMiniProgressBar" class="mini-progress-bar-fill" style="width: ${progressPercent}%"></div>
      </div>
      <button id="globalExpandProgressBtn" class="btn-expand" title="Развернуть">↑</button>
      <button id="globalCancelUploadBtn" class="btn-cancel" title="Отменить">×</button>
    </div>
  `;
  
  document.body.appendChild(miniProgress);
  document.getElementById('globalExpandProgressBtn').onclick = () => {
    if (window.showProgressBarWithData) {
      const currentStats = globalUploadManager.getState().currentUploadStats;
      window.showProgressBarWithData(currentStats);
    }
    removeGlobalMiniProgress();
  };
  
  document.getElementById('globalCancelUploadBtn').onclick = () => {
    if (confirm('Вы уверены, что хотите отменить загрузку?')) {
      globalUploadManager.cancelUpload();
      removeGlobalMiniProgress();
    }
  };
}

function removeGlobalMiniProgress() {
  const existing = document.getElementById('globalMiniProgressContainer');
  if (existing) {
    existing.remove();
  }
}

window.globalUploadManager = globalUploadManager;