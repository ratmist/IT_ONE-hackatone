class UploadManager {
    constructor() {
        this.uploadInProgress = false;
        this.currentUploadStats = null;
        this.listeners = [];
        this.init();
    }

    init() {
        const savedState = localStorage.getItem('uploadState');
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                if (Date.now() - (state.timestamp || 0) < 5 * 60 * 1000) {
                    this.uploadInProgress = state.uploadInProgress;
                    this.currentUploadStats = state.currentUploadStats;
                } else {
                    this.clearState();
                }
            } catch (e) {
                this.clearState();
            }
        }
    }

    saveState() {
        const state = {
            uploadInProgress: this.uploadInProgress,
            currentUploadStats: this.currentUploadStats,
            timestamp: Date.now()
        };
        localStorage.setItem('uploadState', JSON.stringify(state));
    }

    clearState() {
        localStorage.removeItem('uploadState');
        this.uploadInProgress = false;
        this.currentUploadStats = null;
        this.notifyListeners();
    }

    startUpload() {
        this.uploadInProgress = true;
        this.saveState();
        this.notifyListeners();
    }

    finishUpload() {
        this.uploadInProgress = false;
        this.currentUploadStats = null;
        this.clearState();
        this.notifyListeners();
    }

    updateProgress(stats) {
        this.currentUploadStats = stats;
        this.saveState();
        this.notifyListeners();
    }

    cancelUpload() {
        this.uploadInProgress = false;
        this.currentUploadStats = null;
        this.clearState();
        this.notifyListeners();
    }

    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    notifyListeners() {
        setTimeout(() => {
            this.listeners.forEach(callback => {
                try {
                    callback({
                        uploadInProgress: this.uploadInProgress,
                        currentUploadStats: this.currentUploadStats
                    });
                } catch (error) {
                    console.error('Error in upload listener:', error);
                }
            });
        }, 0);
    }

    getState() {
        return {
            uploadInProgress: this.uploadInProgress,
            currentUploadStats: this.currentUploadStats
        };
    }
}

const globalUploadManager = new UploadManager();
export { globalUploadManager };