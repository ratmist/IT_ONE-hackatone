import { initRulesPage } from './rules.js';
import { initTransactionPage, initTransactionDetailPage }    from './transactions.js';
import { initAnalyticsPage } from './analytics.js';
import { initGlobalUploadIndicator } from './global-upload.js';
import { initConnectionsPage } from './connections.js';
import { initNotificationsPage } from './notifications.js';
import { initTransactionMLLog } from './ml.js';

initGlobalUploadIndicator();

const page = document.body.dataset.page;
switch (page) {
  case 'rules': initRulesPage(); break;
  case 'transactions': initTransactionPage(); break;
  case 'transaction-details': initTransactionDetailPage(); initTransactionMLLog();break;
  case 'analytics': initAnalyticsPage(); break;
  case 'connections': initConnectionsPage(); break;
  case 'notifications': initNotificationsPage(); break;
}
