import { AnalyticsAPI } from './data.js';

let typeChart = null;
let statusChart = null;
let channelChart = null;

export async function initAnalyticsPage() {
    await loadAnalyticsData();
    initPeriodSelector();
    initExportButton();
}

async function loadAnalyticsData() {
    try {
        const [stats, detailedStats, typeData, channelData, statusData] = await Promise.all([
            AnalyticsAPI.getStats(),
            AnalyticsAPI.getDetailedStats(),
            AnalyticsAPI.getTypeDistribution(),
            AnalyticsAPI.getChannelDistribution(),
            AnalyticsAPI.getStatusDistribution()
        ]);        
        updateStats(stats);
        renderCharts(stats, typeData, channelData, statusData);
        updateDetailStats(detailedStats);
        
    } catch (error) {
        useFallbackData();
    }
}

function updateStats(stats) {
    document.getElementById('totalTransactions').textContent = stats.total_transactions.toLocaleString();
    document.getElementById('fraudTransactions').textContent = stats.fraud_transactions.toLocaleString();
    document.getElementById('reviewedTransactions').textContent = stats.reviewed_transactions.toLocaleString();
    document.getElementById('fraudRate').textContent = `${stats.fraud_rate}%`;
}

function renderCharts(stats, typeData, channelData, statusData) {
    renderTypeChart(typeData);
    renderStatusChart(statusData || stats);
    renderChannelChart(channelData);
}

function renderTypeChart(typeData) {
    const ctx = document.getElementById('typeChart').getContext('2d');
    
    if (typeChart) {
        typeChart.destroy();
    }

    const labels = Object.keys(typeData).map(type => {
        const typeLabels = {
            'deposit': 'Пополнение',
            'withdrawal': 'Снятие', 
            'payment': 'Оплата',
            'transfer': 'Перевод'
        };
        return typeLabels[type] || type;
    });
    
    const data = Object.values(typeData);
    const backgroundColors = ['#3280fd', '#f35050', '#9ee1b7', '#ecbe32'];

    typeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                borderWidth: 2,
                borderColor: '#101a2b'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#ffffff',
                        font: {
                            size: 11
                        }
                    }
                }
            }
        }
    });
}

function renderStatusChart(statusData) {
  const ctx = document.getElementById('statusChart').getContext('2d');
  if (statusChart) statusChart.destroy();

  const labels = Object.keys(statusData);
  const data = Object.values(statusData);

  const labelMap = {
    'alerted': 'Подозрительные',
    'processed': 'Успешные',
    'reviewed': 'Проверенные',
    'not_reviewed': 'Не проверенные'
  };

  statusChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(l => labelMap[l] || l),
      datasets: [{
        label: 'Количество',
        data,
        backgroundColor: [
          'rgba(243, 80, 80, 0.8)',
          'rgba(158, 225, 183, 0.8)',
          'rgba(50, 128, 253, 0.8)',
          'rgba(236, 190, 50, 0.8)'
        ],
        borderColor: ['#f35050', '#9ee1b7', '#3280fd', '#ecbe32'],
        borderWidth: 1
      }]
    },
    options: getBarChartOptions()
  });
}

function renderChannelChart(channelData) {
  const ctx = document.getElementById('channelChart').getContext('2d');

  if (channelChart) channelChart.destroy();

  const labels = Object.keys(channelData);
  const data = Object.values(channelData);

  channelChart = new Chart(ctx, {
    type: 'polarArea',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: [
          'rgba(50, 128, 253, 0.8)',
          'rgba(158, 225, 183, 0.8)',
          'rgba(243, 80, 80, 0.8)',
          'rgba(236, 190, 50, 0.8)',
          'rgba(156, 102, 255, 0.8)',
          'rgba(255, 99, 132, 0.8)',
          'rgba(75, 192, 192, 0.8)'
        ],
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          ticks: {
            display: false
          },
          grid: {
            color: 'rgba(255,255,255,0.08)'
          },
          angleLines: {
            color: 'rgba(255,255,255,0.05)'
          },
          pointLabels: {
            color: '#fff',
            font: {
              size: 13,
              weight: '500'
            }
          }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#ffffff',
            font: {
              size: 13
            },
            padding: 14
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 25, 45, 0.9)',
          borderColor: 'rgba(255,255,255,0.15)',
          borderWidth: 1,
          titleFont: { size: 13, weight: '600' },
          bodyFont: { size: 12 },
          padding: 10,
          displayColors: false
        }
      },
      animation: {
        duration: 1000,
        easing: 'easeOutCubic'
      }
    }
  });
}

function updateDetailStats(detailedStats) {
    const amountStats = detailedStats.amount_stats;
    const reviewStats = detailedStats.review_stats;

    document.getElementById('avgAmount').textContent = `${amountStats.avg_amount.toFixed(2)} ₽`;
    document.getElementById('maxAmount').textContent = `${amountStats.max_amount.toFixed(2)} ₽`;
    document.getElementById('minAmount').textContent = `${amountStats.min_amount.toFixed(2)} ₽`;
    document.getElementById('totalReviewed').textContent = reviewStats.total_reviewed.toLocaleString();
    document.getElementById('pendingReview').textContent = reviewStats.pending_review.toLocaleString();
    document.getElementById('successCount').textContent = reviewStats.success_count.toLocaleString();
}

function getBarChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false
            }
        },
        scales: {
            x: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: {
                    color: '#ffffff',
                    font: {
                        size: 12
                    },
                    
                }
            },
            y: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: {
                    color: '#ffffff'
                }
            }
        }
    };
}

function initPeriodSelector() {
    const periodSelect = document.querySelector('.select-ui[data-name="period"]');
    if (!periodSelect) return;
    
    const btn = periodSelect.querySelector('.select-btn');
    const menu = periodSelect.querySelector('.select-menu');

    btn.addEventListener('click', () => periodSelect.classList.toggle('open'));
    
    menu.addEventListener('click', async (e) => {
        const li = e.target.closest('li');
        if (li) {
            const period = li.dataset.value;
            menu.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === li));
            btn.textContent = li.textContent;
            periodSelect.classList.remove('open');
            
            await loadAnalyticsDataForPeriod(parseInt(period));
        }
    });
}

async function loadAnalyticsDataForPeriod() {
    try {
        const [stats, detailedStats] = await Promise.all([
            AnalyticsAPI.getStats(),
            AnalyticsAPI.getDetailedStats()
        ]);
        
        updateStats(stats);
        updateDetailStats(detailedStats);
    } catch (error) {
        console.error('Ошибка загрузки данных для периода:', error);
    }
}

function useFallbackData() {
    const fallbackStats = {
        total_transactions: 1500,
        fraud_transactions: 45,
        reviewed_transactions: 1200,
        fraud_rate: 3.0
    };
    
    const fallbackTypeData = {
        deposit: 500,
        withdrawal: 400,
        payment: 350,
        transfer: 250
    };
    
    const fallbackChannelData = {
        'Online': 600,
        'Mobile': 450,
        'ATM': 300,
        'POS': 150
    };
    
    const fallbackDetailedStats = {
        amount_stats: {
            avg_amount: 1250.50,
            max_amount: 50000.00,
            min_amount: 10.00
        },
        review_stats: {
            total_reviewed: 1200,
            pending_review: 300,
            success_count: 1455
        }
    };
    
    updateStats(fallbackStats);
    renderCharts(fallbackStats, fallbackTypeData, fallbackChannelData, fallbackStats);
    updateDetailStats(fallbackDetailedStats);
}


function initExportButton() {
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToCsv);
    }
}

async function exportToCsv() {
    try {
        const exportBtn = document.getElementById('exportCsvBtn');
        const originalText = exportBtn.innerHTML;
        exportBtn.disabled = true;
        const [stats, detailedStats, typeData, channelData] = await Promise.all([
            AnalyticsAPI.getStats(),
            AnalyticsAPI.getDetailedStats(),
            AnalyticsAPI.getTypeDistribution(),
            AnalyticsAPI.getChannelDistribution(),
        ]);
        const csvContent = generateCsvContent(stats, detailedStats, typeData, channelData);
        downloadCsvFile(csvContent, `analytics_${new Date().toISOString().split('T')[0]}.csv`);
        exportBtn.disabled = false;

    } catch (error) {
        alert('Ошибка при экспорте данных. Проверьте консоль для подробностей.');
        const exportBtn = document.getElementById('exportCsvBtn');
        exportBtn.innerHTML = 'Экспорт в CSV';
        exportBtn.disabled = false;
    }
}

function generateCsvContent(stats, detailedStats, typeData, channelData) {
    const rows = [];
    rows.push('Аналитика транзакций');
    rows.push(`Дата экспорта: ${new Date().toLocaleDateString('ru-RU')}`);
    rows.push('');
    rows.push('ОСНОВНАЯ СТАТИСТИКА');
    rows.push('Показатель,Значение');
    rows.push(`Всего транзакций,${stats.total_transactions}`);
    rows.push(`Мошеннических транзакций,${stats.fraud_transactions}`);
    rows.push(`Проверенных транзакций,${stats.reviewed_transactions}`);
    rows.push(`Уровень мошенничества,${stats.fraud_rate}%`);
    rows.push('');
    rows.push('СТАТИСТИКА ПО СУММАМ');
    rows.push('Показатель,Значение');
    rows.push(`Средняя сумма,${detailedStats.amount_stats.avg_amount.toFixed(2)}`);
    rows.push(`Максимальная сумма,${detailedStats.amount_stats.max_amount.toFixed(2)}`);
    rows.push(`Минимальная сумма,${detailedStats.amount_stats.min_amount.toFixed(2)}`);
    rows.push('');
    rows.push('СТАТИСТИКА ПРОВЕРОК');
    rows.push('Показатель,Значение');
    rows.push(`Всего проверено,${detailedStats.review_stats.total_reviewed}`);
    rows.push(`Ожидают проверки,${detailedStats.review_stats.pending_review}`);
    rows.push(`Успешных транзакций,${detailedStats.review_stats.success_count}`);
    rows.push('');
    rows.push('РАСПРЕДЕЛЕНИЕ ПО ТИПАМ ТРАНЗАКЦИЙ');
    rows.push('Тип транзакции,Количество');
    Object.entries(typeData).forEach(([type, count]) => {
        const typeName = getTransactionTypeLabel(type);
        rows.push(`${typeName},${count}`);
    });
    rows.push('');
    rows.push('ТОП КАНАЛОВ ОПЛАТЫ');
    rows.push('Канал оплаты,Количество');
    Object.entries(channelData).forEach(([channel, count]) => {
        rows.push(`${channel},${count}`);
    });
    
    return rows.join('\n');
}

function getTransactionTypeLabel(type) {
    const typeLabels = {
        'deposit': 'Пополнение',
        'withdrawal': 'Снятие', 
        'payment': 'Оплата',
        'transfer': 'Перевод'
    };
    return typeLabels[type] || type;
}

function downloadCsvFile(csvContent, filename) {
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
}