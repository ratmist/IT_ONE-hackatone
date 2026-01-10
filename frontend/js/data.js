export const TransactionsAPI = {
  async list(page = 1, pageSize = 8, filters = {}) {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });

      if (filters.type) params.append('type', filters.type);

      
      if (filters.status) {
        const backendStatusMap = {
          success: 'processed',
          danger: 'alerted',
        };
        const backendStatus = backendStatusMap[filters.status] || filters.status;
        params.append('status', backendStatus);
      }

      if (filters.search) params.append('search', filters.search);
      if (filters.sort) params.append('sort', filters.sort);

      const url = `http://127.0.0.1:8000/api/transactions/?${params}`;
      const res = await fetch(url);

      if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
      const data = await res.json();
      
      const transactions = data.results || [];
      const totalCount = data.count || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      return {
        transactions: transactions.map(item => this._formatTransaction(item)),
        totalCount,
        currentPage: page,
        totalPages,
        hasNext: !!data.next,
        hasPrevious: !!data.previous,
      };

    } catch (err) {
      return {
        transactions: [],
        totalCount: 0,
        currentPage: 1,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      };
    }
  },

 
  _formatTransaction(item) {
    let timestamp;
    let tsLabel = 'Некорректная дата';
    try {
      const cleanTimestamp = item.timestamp?.replace(/\.\d+Z$/, 'Z');
      timestamp = new Date(cleanTimestamp);
      if (!isNaN(timestamp.getTime())) {
        tsLabel = formatDateSimple(timestamp);
      }
    } catch {
      timestamp = new Date();
      tsLabel = formatDateSimple(timestamp);
    }
    let status = 'success';
    let statusLabel = 'Успешная';

    if (item.status === 'alerted') {
      status = 'danger';
      statusLabel = 'Подозрительная';
    } else if (item.status === 'processed') {
      status = 'success';
      statusLabel = 'Успешная';
    }

    return {
      id: item.correlation_id,
      correlation_id: item.correlation_id,
      ts: timestamp.getTime(),
      tsLabel,
      amount: parseFloat(item.amount),
      amountLabel: `${parseFloat(item.amount).toFixed(2)} ₽`,
      type: item.transaction_type,
      typeLabel:
        item.transaction_type === 'withdrawal'
          ? 'Снятие'
          : item.transaction_type === 'deposit'
          ? 'Пополнение'
          : item.transaction_type === 'payment'
          ? 'Оплата'
          : 'Перевод',
      status,
      statusLabel,
      is_reviewed: item.is_reviewed || false,
    };
  },

  async detail(correlation_id) {
    try {
      const res = await fetch(
        `http://127.0.0.1:8000/api/transactions/${encodeURIComponent(
          correlation_id
        )}/`
      );
      if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
      const item = await res.json();

      let formattedDate = 'Некорректная дата';
      try {
        const cleanTimestamp = item.timestamp.replace(/\.\d+Z$/, 'Z');
        const date = new Date(cleanTimestamp);
        if (!isNaN(date.getTime())) {
          formattedDate = formatDateSimple(date);
        }
      } catch (e) {
        throw e;
      }
    
      let status = 'success';
      let statusLabel = 'Успешная';
      if (item.status === 'alerted') {
        status = 'danger';
        statusLabel = 'Подозрительная';
      } else if (item.status === 'processed') {
        status = 'success';
        statusLabel = 'Успешная';
      }
    

      return {
        transaction_id: item.transaction_id,
        correlation_id: item.correlation_id,
        ts: formattedDate,
        amount: `${parseFloat(item.amount).toFixed(2)} ₽`,
        sender_account: item.sender_account,
        receiver_account: item.receiver_account,
        type:
          item.transaction_type === 'withdrawal'
            ? 'Снятие'
            : item.transaction_type === 'deposit'
            ? 'Пополнение'
            : item.transaction_type === 'payment'
            ? 'Оплата'
            : 'Перевод',
        status,
        statusLabel,
        merchant_category: item.merchant_category,
        location: item.location,
        device_used: item.device_used,
        payment_channel: item.payment_channel,
        time_since_last_transaction: item.time_since_last_transaction,
        ip_address: item.ip_address,
        device_hash: item.device_hash,
        spending_deviation_score: item.spending_deviation_score,
        velocity_score: item.velocity_score,
        geo_anomaly_score: item.geo_anomaly_score,
        is_fraud: item.is_fraud,
        is_reviewed: item.is_reviewed
      };
    } catch (e) {
      return null;
    }
  },

  async updateStatus(correlation_id, statusData) {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/transactions/${encodeURIComponent(correlation_id)}/status/`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(statusData)
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Ошибка: ${res.status}`);
      }
      
      return await res.json();
    } catch (err) {
      throw err;
    }
  },

  async toggleFraudStatus(correlation_id, currentFraudStatus) {
    try {
      const statusData = {
        is_fraud: !currentFraudStatus
      };
      return await this.updateStatus(correlation_id, statusData);
    } catch (err) {
      throw err;
    }
  },

  async markAsReviewed(correlation_id) {
    try {
      const statusData = {
        is_reviewed: true
      };
      return await this.updateStatus(correlation_id, statusData);
    } catch (err) {
      throw err;
    }
  }
};

function formatDateSimple(date) {
  try {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
  } catch (e) {
    return 'Ошибка формата';
  }
}

export const RulesAPI = {
  async list() {
    try {
      const url = `http://127.0.0.1:8000/api/rules/`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
      const data = await res.json();

      const thresholdRules = data.threshold_rules?.map(item => 
        this._formatRule(item, 'threshold')
      ) || [];
      const compositeRules = data.composite_rules?.map(item => 
        this._formatRule(item, 'composite')
      ) || [];
      const patternRules = data.pattern_rules?.map(item => 
        this._formatRule(item, 'pattern')
      ) || [];
      const mlRules = data.ml_rules?.map(item => 
        this._formatRule(item, 'ml')
      ) || [];

      const allRules = [...thresholdRules, ...compositeRules, ...patternRules,  ...mlRules];
      return allRules.sort((a, b) => new Date(b.updated) - new Date(a.updated));

    } catch (err) {
      return [];
    }
  },

  async detail(id, ruleType) {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/rules/${encodeURIComponent(ruleType)}/${encodeURIComponent(id)}/`);
      if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
      const item = await res.json();
      return this._formatRule(item, ruleType);
      
    } catch (e) {
      const list = await this.list();
      return list.find(x => String(x.id) === String(id) && x.type.toLowerCase() === ruleType.toLowerCase()) || null;
    }
  },

  async createMLRule(ruleData) {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/rules/ml/create/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ruleData)
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Ошибка: ${res.status}`);
      }
      
      return await res.json();
    } catch (err) {
      throw err;
    }
  },

  async testMLRule(ruleId, testData) {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/rules/ml/test/${ruleId}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transactions: testData })
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Ошибка: ${res.status}`);
      }
      
      return await res.json();
    } catch (err) {
      throw err;
    }
  },

  async create(ruleData) {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/rules/create/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ruleData)
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Ошибка: ${res.status}`);
      }
      
      return await res.json();
    } catch (err) {
      throw err;
    }
  },

  async update(id, ruleType, ruleData) {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/rules/update/${encodeURIComponent(ruleType)}/${encodeURIComponent(id)}/`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ruleData)
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Ошибка: ${res.status}`);
      }
      
      return await res.json();
    } catch (err) {
      throw err;
    }
  },

  async delete(id, ruleType) {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/rules/delete/${encodeURIComponent(ruleType)}/${encodeURIComponent(id)}/`, {
        method: 'DELETE'
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Ошибка: ${res.status}`);
      }
      
      return await res.json();
    } catch (err) {
      throw err;
    }
  },

  async testRule(ruleId, ruleType) {
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/rules/test/?type=${ruleType}&id=${ruleId}`);
      if (!response.ok) throw new Error(`Ошибка: ${response.status}`);
      const result = await response.json();
      
      showTestResults(result, ruleId, ruleType);
    } catch (error) {
      alert(`Ошибка при проверке правила: ${error.message}`);
    }
  },

  async toggleStatus(id, ruleType, currentStatus) {
    try {
      const currentRule = await this.detail(id, ruleType);
      if (!currentRule) throw new Error('Правило не найдено');

      const updatedData = {
        title: currentRule.name,
        description: currentRule.description,
        username: currentRule.by,
        is_active: !currentStatus
      };

      if (ruleType === 'threshold') {
        updatedData.column_name = currentRule.column;
        updatedData.operator = currentRule.op;
        updatedData.value = currentRule.value;
      } else if (ruleType === 'composite') {
        updatedData.rule = this._convertConditionsToRuleFormat(currentRule.conditions);
      } else if (ruleType === 'pattern') {
        updatedData.window_seconds = currentRule.window_seconds;
        updatedData.min_count = currentRule.min_count;
        updatedData.total_amount_limit = currentRule.total_amount_limit;
        updatedData.min_amount_limit = currentRule.min_amount_limit;
        updatedData.group_mode = currentRule.group_mode;
        updatedData.criticality = currentRule.criticality;
      }

      const result = await this.update(id, ruleType, updatedData);
      return result;
      
    } catch (err) {
      throw err;
    }
  },

  _formatRule(item, ruleType) {
  const baseRule = {
    id: item.id,
    name: item.title || 'Без названия',
    description: item.description || '',
    by: item.username || 'Система',
    state: item.is_active ? 'enabled' : 'disabled',
    modified: item.created_at,
    updated: item.updated_at,
    type: ruleType.charAt(0).toUpperCase() + ruleType.slice(1),
    criticality: item.criticality || 'low'
  };

  if (ruleType === 'threshold') {
    baseRule.column = item.column_name;
    baseRule.op = item.operator;
    baseRule.value = item.value;
    baseRule.expr = `${item.column_name} ${item.operator} ${item.value}`;
  } else if (ruleType === 'composite') {
    baseRule.conditions = this._extractCompositeConditions(item.rule);
    baseRule.expr = this._formatCompositeExpr(item.rule);
  } else if (ruleType === 'pattern') {
    baseRule.expr = this._formatPatternExpr(item);
  } else if (ruleType === 'ml') {
    baseRule.model_name = item.model_name;
    baseRule.threshold = item.threshold;
    baseRule.expr = `ML модель: ${item.model_name}, порог ${item.threshold}`;
  }

  return baseRule;
},


  _formatPatternExpr(patternRule) {
    const parts = [];
    
    if (patternRule.window_seconds) {
      const minutes = patternRule.window_seconds / 60;
      parts.push(`окно: ${minutes} мин`);
    }
    
    if (patternRule.min_count) {
      parts.push(`мин. операций: ${patternRule.min_count}`);
    }
    
    if (patternRule.total_amount_limit) {
      parts.push(`общая сумма: ${patternRule.total_amount_limit}`);
    }
    
    if (patternRule.min_amount_limit) {
      parts.push(`мин. сумма: ${patternRule.min_amount_limit}`);
    }
    
    if (patternRule.group_mode) {
      const modeLabels = {
        'sender': 'по отправителю',
        'receiver': 'по получателю', 
        'pair': 'по паре отправитель-получатель'
      };
      parts.push(`группировка: ${modeLabels[patternRule.group_mode] || patternRule.group_mode}`);
    }
    
    return parts.join(', ');
  },

  _extractCompositeConditions(rule) {
    if (!rule) return [];
    
    const extractConditions = (node) => {
      if (!node.conditions || !Array.isArray(node.conditions)) {
        return [];
      }
      
      const conditions = [];
      
      node.conditions.forEach((cond, index) => {
        if (cond.conditions && Array.isArray(cond.conditions)) {
          conditions.push({
            logic: cond.logic || 'AND',
            conditions: extractConditions(cond),
            isGroup: true
          });
        } else {
          conditions.push({
            column: cond.column || '—',
            operator: cond.operator || '—',
            value: cond.value !== undefined ? cond.value : '—',
            isGroup: false
          });
        }
      });
      
      return conditions;
    };

    const result = extractConditions(rule);
    return result.length > 0 ? result : [];
  },

  _formatCompositeExpr(rule) {
    if (!rule) return '';
    const formatNode = (node) => {
      if (!node.conditions || !Array.isArray(node.conditions)) {
        return '';
      }
      const parts = node.conditions.map(cond => {
        if (cond.conditions && Array.isArray(cond.conditions)) {
          const groupExpr = formatNode(cond);
          if (cond.logic === 'NOT') {
            return `NOT (${groupExpr})`;
          } else {
            return `(${groupExpr})`;
          }
        } else {
          return `${cond.column || ''} ${cond.operator || ''} ${cond.value !== undefined ? cond.value : ''}`;
        }
      });
      const logic = node.logic || 'AND';
      return parts.filter(part => part.trim()).join(` ${logic} `);
    };
    const result = formatNode(rule);
    return result || '—';
  },

  _convertConditionsToRuleFormat(conditions) {
    if (!conditions || conditions.length === 0) {
      return { logic: 'AND', conditions: [] };
    }
    const convert = (conds) => {
      return conds.map(cond => {
        if (cond.isGroup) {
          return {
            logic: cond.logic,
            conditions: convert(cond.conditions)
          };
        } else {
          return {
            column: cond.column,
            operator: cond.operator,
            value: cond.value
          };
        }
      });
    };

    return {
      logic: 'AND',
      conditions: convert(conditions)
    };
  }
};


export const AnalyticsAPI = {
  async getDetailedStats() {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/analytics/detailed/`);
      if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
      return res.json();
    } catch (err) {
      throw err;
    }
  },

  async getStats() {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/analytics/stats/`);
      if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
      return res.json();
    } catch (err) {
      throw err;
    }
  },

  async getTypeDistribution() {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/analytics/types/');
      if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
      return await res.json();
    } catch (err) {
      throw err;
    }
  },

  async getChannelDistribution() {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/analytics/channels/');
      if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
      return await res.json();
    } catch (err) {
      throw err;
    }
  },

  async getStatusDistribution() {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/analytics/statuses/');
      if (!res.ok) throw new Error(`Ошибка: ${res.status}`);
      return await res.json();
    } catch (err) {
      return null;
    }
  }
};