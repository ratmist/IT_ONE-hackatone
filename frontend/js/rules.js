import { $, esc, icons } from './core.js';
import { RulesAPI } from './data.js';
import { NUMERIC_COLUMNS, OPERATORS, LOGIC_OPERATORS, BRACKETS, setupTypeButtons, toggleForms, getSelectValue, mountSelectUI } from './core.js';
import { validateExpression, tokenizeExpression, convertASTToConditions, parseExpressionToAST } from './rules-validation.js';

const state = { all: [] };

const CRITICALITY_OPTIONS = [
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' },
  { value: 'critical', label: 'Критический' }
];

const ML_MODELS = [
  { value: 'ModSpecialization/distilbert-base-uncased-fraud-classifer', label: 'DistilBERT Fraud Classifier' },
  { value: 'microsoft/deberta-v3-base', label: 'DeBERTa Base' },
  { value: 'roberta-base', label: 'RoBERTa Base' }
];

const GROUP_MODES = [
  { value: 'sender', label: 'Отправитель' },
  { value: 'receiver', label: 'Получатель' },
  { value: 'pair', label: 'Пара отправитель-получатель' }
];

function getCriticalityColor(criticality) {
  const colors = {
    'low': 'var(--green-text)',
    'medium': 'var(--yellow-text)',
    'high': 'var(--orange-text)',
    'critical': 'var(--red-text)'
  };
  return colors[criticality] || 'var(--muted)';
}

export async function initRulesPage() {
  state.all = await RulesAPI.list();
  render();

  document.getElementById('createBtn').onclick = () => {
    openCreateRuleModal();
  };
}

async function createRule(ruleData) {
  try {
    const result = await RulesAPI.create(ruleData);
    state.all = await RulesAPI.list();
    return result;
  } catch (error) {
    alert(`Ошибка при создании правила: ${error.message}`);
    throw error;
  }
}

async function updateRule(ruleId, ruleType, ruleData) {
  try {
    const result = await RulesAPI.update(ruleId, ruleType, ruleData);
    state.all = await RulesAPI.list();
    return result;
  } catch (error) {
    alert(`Ошибка при обновлении правила: ${error.message}`);
    throw error;
  }
}

async function deleteRule(ruleId, ruleType) {
  try {
    const result = await RulesAPI.delete(ruleId, ruleType);
    state.all = await RulesAPI.list();
    return result;
  } catch (error) {
    alert(`Ошибка при удалении правила: ${error.message}`);
    throw error;
  }
}

async function testRule(ruleId, ruleType) {
  try {
    const response = await fetch(`http://127.0.0.1:8000/api/rules/test/?type=${ruleType}&id=${ruleId}`);
    if (!response.ok) throw new Error(`Ошибка: ${response.status}`);
    const result = await response.json();
    showTestResultsModal(result, ruleId, ruleType);
  } catch (error) {
    alert(`Ошибка при проверке правила: ${error.message}`);
  }
}

async function toggleRuleStatus(ruleId, ruleType, currentStatus) {
  try {
    const currentRule = await RulesAPI.detail(ruleId, ruleType);
    if (!currentRule) throw new Error('Правило не найдено');

    const updatedData = {
      title: currentRule.name,
      description: currentRule.description,
      username: currentRule.by,
      is_active: currentRule.state !== 'enabled'
    };
    
    if (ruleType === 'threshold') {
      updatedData.column_name = currentRule.column;
      updatedData.operator = currentRule.op;
      updatedData.value = currentRule.value;
    } else if (ruleType === 'composite') {
      updatedData.rule = convertConditionsToRuleFormat(currentRule.conditions);
    } else if (ruleType === 'pattern') {
      updatedData.window_seconds = currentRule.window_seconds;
      updatedData.min_count = currentRule.min_count;
      updatedData.min_amount_limit = currentRule.min_amount_limit;
      updatedData.group_mode = currentRule.group_mode;
    } else if (ruleType === 'ml') {
      updatedData.model_name = currentRule.model_name;
      updatedData.threshold = currentRule.threshold;
      updatedData.input_template = currentRule.input_template;
    }

    const result = await RulesAPI.update(ruleId, ruleType, updatedData);
    state.all = await RulesAPI.list();
    return result;
  } catch (error) {
    alert(`Ошибка при изменении статуса правила: ${error.message}`);
    throw error;
  }
}

function convertConditionsToRuleFormat(conditions) {
  if (!conditions || conditions.length === 0) {
    return { logic: 'AND', conditions: [] };
  }
  const convert = (conds) => {
    return conds.map(cond => {
      if (cond.isGroup) {
        return {logic: cond.logic,conditions: convert(cond.conditions)};
      } else {
        return {column: cond.column,operator: cond.operator,value: cond.value};
      }
    });
  };
  return {logic: 'AND',conditions: convert(conditions)};
}

function formatDateForDisplay(dateString) {
  if (!dateString) return '';
  
  try {
    if (dateString.includes('.') && dateString.length <= 10) {
      return dateString;
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString;
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}.${month}.${year}`;
  } catch (error) {
    return dateString;
  }
}

function showTestResultsModal(testData, ruleId, ruleType) {
  const modal = document.getElementById('ruleModal');
  const dialog = modal?.querySelector('.dialog');
  if (!dialog) return;

  const { summary, results } = testData;
  
  dialog.innerHTML = `
    <div class="rule-header"> 
      <h2>Результаты проверки правила</h2>
    </div>
    
    <div class="form-section">
      <div class="test-summary">
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-label">Протестировано</div>
            <div class="summary-value">${summary.tested}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Сработало</div>
            <div class="summary-value ${summary.triggered_count > 0 ? 'triggered' : ''}">
              ${summary.triggered_count}
            </div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Процент</div>
            <div class="summary-value ${summary.triggered_pct > 0 ? 'triggered' : ''}">
              ${summary.triggered_pct}%
            </div>
          </div>
        </div>
      </div>
      
      <div class="test-results">
        <div class="section-h mb-16">Детальные результаты</div>
        <div class="results-list">
          ${results.map((result, index) => `
            <div class="result-item ${result.triggered ? 'triggered' : ''}">
              <div class="result-header">
                <span class="result-id">Транзакция ${result.transaction_id || index + 1}</span>
                <span class="result-status ${result.triggered ? 'badge danger' : 'badge success'}">
                  ${result.triggered ? 'Подозрительная' : 'Успешная'}
                </span>
              </div>
              <div class="result-reason">${esc(result.reason)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    
    <div class="modal-actions">
      <button class="btn-blue" id="closeTestBtn">Закрыть</button>
    </div>
  `;

  modal.classList.add('show');
  
  const q = sel => dialog.querySelector(sel);
  q('#closeTestBtn').onclick = () => modal.classList.remove('show');
}

async function render() {
  try {
    const rows = state.all; 
    const box = document.getElementById('list');
    box.innerHTML = '';

    rows.forEach(r => {
      const el = document.createElement('div');
      el.className = 'row';
      const typeElement = `
        <div class="rule-type" style="color: ${getCriticalityColor(r.criticality)}">
          ${r.type}
        </div>
      `;
      el.innerHTML = `
        <div class="muted">${typeElement}</div>
        <div class="name">${esc(r.name)}</div>
        <div>
          <button class="switch ${r.state === 'enabled' ? 'is-on' : 'is-off'}"
                  data-act="toggle" role="switch" aria-checked="${r.state === 'enabled'}">
            <span class="switch-track"><span class="switch-thumb"></span></span>
            <span class="switch-label">${r.state === 'enabled' ? 'Включено' : 'Отключено'}</span>
          </button>
        </div>
        <div class="muted">${esc(r.by)}</div>
        <div class="muted">${formatDateForDisplay(r.modified)}</div>
        <div class="muted">${formatDateForDisplay(r.updated)}</div>
        <div class="actions-cell">
          <button class="icon-btn" data-act="check" title="Проверить правило">${icons.check}</button>
          <button class="icon-btn" data-act="edit" title="Редактировать">${icons.pencil}</button>
          <button class="icon-btn" data-act="preview" title="Предпросмотр">${icons.eye}</button>
          <button class="icon-btn icon-btn--danger" data-act="del" title="Удалить">${icons.trash}</button>
        </div>`;

      el.querySelector('[data-act="check"]').onclick = async () =>
        await testRule(r.id, r.type.toLowerCase());
      el.querySelector('[data-act="edit"]').onclick = () =>
        openEditRuleModal(r);

      el.querySelector('[data-act="preview"]').onclick = () =>
        window.location.href = `./rule-details.html?id=${r.id}&type=${r.type.toLowerCase()}`;

      el.querySelector('[data-act="del"]').onclick = async () => {
        if (confirm('Удалить правило?')) { 
          await deleteRule(r.id, r.type.toLowerCase());
          render(); 
        }
      };

      el.querySelector('[data-act="toggle"]').onclick = async () => {
        await toggleRuleStatus(r.id, r.type.toLowerCase(), r.state);
        render();
      };

      box.appendChild(el);
    });

    if (!rows.length) {
      const e = document.createElement('div');
      e.style.cssText = 'padding:24px;color:#9aa4b2;text-align:center;border-top:1px solid var(--border);';
      e.textContent = 'Пока нет правил';
      box.appendChild(e);
    }
  } catch (error) {
    const box = $('#list');
    box.innerHTML = '<div style="padding:24px;color:red;text-align:center;">Ошибка загрузки правил</div>';
  }
}

function openCreateRuleModal() {
  const modal = document.getElementById('ruleModal');
  const dialog = modal?.querySelector('.dialog');
  if (!dialog) return;

  dialog.innerHTML = `
    <div class="rule-header"> 
      <h2>Создать новое правило</h2>
    </div>

    <div class="form-section">
      <label class="fieldTitle">Название
        <input id="ruleName" class="input" placeholder="Введите название правила" />
      </label>
      
      <label class="fieldTitle">Описание
        <textarea id="ruleDescription" class="textarea" placeholder="Введите описание правила"></textarea>
      </label>

      <label class="fieldTitle">Уровень критичности
        <div class="select-ui" data-name="criticality"></div>
      </label>
    </div>

    <div class="form-section mt-12">
      <div class="fieldTitle">Тип правила</div>
      <div class="type-group" id="typeGroup">
        <button class="type-btn active" data-type="threshold">Threshold</button>
        <button class="type-btn" data-type="composite">Composite</button>
        <button class="type-btn" data-type="pattern">Pattern</button>
        <button class="type-btn" data-type="ml">ML Rule</button> 
      </div>
    </div>

    <div id="formThreshold" class="rule-form">
      <div class="form-grid">
        <label class="fieldTitle">Столбец
          <div class="select-ui" data-name="thColumn"></div>
        </label>
        
        <label class="fieldTitle">Оператор
          <div class="select-ui" data-name="thOp"></div>
        </label>
        
        <label class="fieldTitle">Значение
          <input type="number" id="thValue" class="input" inputmode="decimal" placeholder="0.00" />
        </label>
      </div>
    </div>

    <div id="formComposite" class="rule-form" style="display: none;">
      <div class="composite-builder">
        <div class="expression-preview">
          <span class="fieldTitle">Правило</span>
          <div class="expression-field" id="expressionField" contenteditable="true" placeholder="Начните собирать правило..."></div>
        </div>
        
        <div class="builder-toolbar-horizontal">
          <div class="toolbar-row">
            <div class="toolbar-section">
              <div class="section-title">Столбцы</div>
              <div class="button-group horizontal" id="columnsGroup"></div>
            </div>
          </div>
          
          <div class="toolbar-row">
            <div class="toolbar-section">
              <div class="section-title">Операторы сравнения</div>
              <div class="button-group horizontal" id="operatorsGroup"></div>
            </div>
            <div class="toolbar-section">
              <div class="section-title">Скобки</div>
              <div class="button-group horizontal" id="bracketsGroup"></div>
            </div>
            <div class="toolbar-section">
              <div class="section-title">Логические операторы</div>
              <div class="button-group horizontal" id="logicGroup"></div>
            </div>
          </div>

          <div class="toolbar-footer">
            <div class="toolbar-section">
              <div class="section-title">Значение</div>
              <div class="value-inputs horizontal">
                <input type="number" id="numericValue" class="input" placeholder="Число" step="0.01" />
                <button class="btn-line" id="addValueBtn">Добавить</button>
              </div>
            </div>
            <div class="edit-actions">
              <button class="edit-btn edit-del" id="clearExpressionBtn" title="Очистить">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash2-icon lucide-trash-2"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
              <button class="edit-btn edit-check" id="validateExpressionBtn" title="Проверить">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-check-icon lucide-square-check"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="formPattern" class="rule-form" style="display: none;">
      <div class="form-grid pattern-grid">
        <label class="fieldTitle">Временное окно (минуты)
          <input type="number" id="patternWindow" class="input" placeholder="15" min="1" />
        </label>
        
        <label class="fieldTitle">Минимальное количество операций
          <input type="number" id="patternMinCount" class="input" placeholder="5" min="1" />
        </label>
        
        <label class="fieldTitle">Лимит суммы одной операции
          <input type="number" id="patternMinAmount" class="input" placeholder="3000" step="0.01" />
        </label>
        
        <label class="fieldTitle">Группировка по
          <div class="select-ui" data-name="patternGroupMode"></div>
        </label>
      </div>
    </div>

    <div id="formML" class="rule-form" style="display: none;">
      <div class="form-section">
        <label class="fieldTitle">ML модель
          <div class="select-ui" data-name="mlModel"></div>
        </label>
        
        <label class="fieldTitle">Порог срабатывания (0-1)
          <input type="number" id="mlThreshold" class="input" min="0" max="1" step="0.01" value="0.8" />
        </label>
      </div>

      <div class="form-section">
        <label class="fieldTitle">Шаблон преобразования транзакции
          <textarea id="mlTemplate" class="textarea" rows="4" placeholder="Transaction {transaction_type} amount {amount} from {sender_account} to {receiver_account} at {timestamp}">Transaction {transaction_type} amount {amount} from {sender_account} to {receiver_account} at {timestamp} location {location}</textarea>
        </label>
        <div class="field-hint">
          Доступные переменные: amount, sender_account, receiver_account, timestamp, transaction_type, location, merchant_category, device_used, payment_channel
        </div>
      </div>
    </div>
    
    <div class="modal-actions">
      <button class="btn-red" id="cancelBtn">Отмена</button>
      <button class="btn-blue" id="saveBtn">Создать правило</button>
    </div>
  `;

  modal.classList.add('show');
  const q = sel => dialog.querySelector(sel);

  mountSelectUI(
    q('.select-ui[data-name="criticality"]'),
    CRITICALITY_OPTIONS,
    'medium'
  );

  mountSelectUI(
    q('.select-ui[data-name="thColumn"]'),
    NUMERIC_COLUMNS,
    NUMERIC_COLUMNS[0].value
  );
  
  mountSelectUI(
    q('.select-ui[data-name="thOp"]'),
    OPERATORS,
    OPERATORS[0].value
  );

  mountSelectUI(
    q('.select-ui[data-name="patternGroupMode"]'),
    GROUP_MODES,
    'sender'
  );

  mountSelectUI(
    q('.select-ui[data-name="mlModel"]'),
    ML_MODELS,
    'ModSpecialization/distilbert-base-uncased-fraud-classifer'
  );

  initCompositeBuilder(dialog);  
  let currentType = 'threshold';
  setupTypeButtons(dialog, currentType, (newType) => {
    currentType = newType;
    toggleForms(dialog, currentType);
  });

  q('#cancelBtn').onclick = () => modal.classList.remove('show');
  q('#saveBtn').onclick = async () => {
    const payload = collectRulePayload(dialog, currentType);
    if (!payload) return;
    
    try {
      await createRule(payload);
      modal.classList.remove('show');
      render();
    } catch (error) {
      console.error('Ошибка при создании правила:', error);
    }
  };
}

function openEditRuleModal(rule) {
  const modal = document.getElementById('ruleModal');
  const dialog = modal?.querySelector('.dialog');
  if (!dialog) return;

  const type = (rule.type || '').toLowerCase();
  const isComposite = type === 'composite';
  const isPattern = type === 'pattern';
  const isML = type === 'ml';

  
  dialog.innerHTML = `
    <div class="rule-header"> 
      <h2>Редактировать правило</h2>
      <div class="rule-type-badge">${rule.type}</div>
    </div>
    
    <div class="form-section">
      <label class="fieldTitle">Название
        <input id="ruleName" class="input" value="${esc(rule.name)}" />
      </label>
      
      <label class="fieldTitle">Описание
        <textarea id="ruleDescription" class="textarea">${esc(rule.description || '')}</textarea>
      </label>

      <label class="fieldTitle">Уровень критичности
        <div class="select-ui" data-name="criticality"></div>
      </label>
    </div>

    ${isComposite ? `
      <div class="form-section">
        <div class="composite-builder">
          <div class="expression-preview">
            <span class="fieldTitle">Правило</span>
            <div class="expression-field" id="expressionField" contenteditable="true">${generateExpressionFromConditions(rule.conditions)}</div>
          </div>
          
          <div class="builder-toolbar-horizontal">
            <div class="toolbar-row">
              <div class="toolbar-section">
                <div class="section-title">Столбцы</div>
                <div class="button-group horizontal" id="columnsGroup"></div>
              </div>
            </div>
            
            <div class="toolbar-row">
              <div class="toolbar-section">
                <div class="section-title">Операторы сравнения</div>
                <div class="button-group horizontal" id="operatorsGroup"></div>
              </div>
              <div class="toolbar-section">
                <div class="section-title">Скобки</div>
                <div class="button-group horizontal" id="bracketsGroup"></div>
              </div>
              <div class="toolbar-section">
                <div class="section-title">Логические операторы</div>
                <div class="button-group horizontal" id="logicGroup"></div>
              </div>
            </div>
            <div class="toolbar-footer">
              <div class="toolbar-section">
                <div class="section-title">Значение</div>
                <div class="value-inputs horizontal">
                  <input type="number" id="numericValue" class="input" placeholder="Число" step="0.01" />
                  <button class="btn-line" id="addValueBtn">Добавить</button>
                </div>
              </div>
              <div class="edit-actions">
                <button class="edit-btn edit-del" id="clearExpressionBtn" title="Очистить">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash2-icon lucide-trash-2"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
                <button class="edit-btn edit-check" id="validateExpressionBtn" title="Проверить">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-check-icon lucide-square-check"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    ` : isPattern ? `
      <div class="form-section">
        <div class="form-grid pattern-grid">
          <label class="fieldTitle">Временное окно (минуты)
            <input type="number" id="patternWindow" class="input" value="${Math.round(rule.window_seconds / 60)}" min="1" />
          </label>
          
          <label class="fieldTitle">Минимальное количество операций
            <input type="number" id="patternMinCount" class="input" value="${rule.min_count}" min="1" />
          </label>
          
          <label class="fieldTitle">Лимит суммы одной операции
            <input type="number" id="patternMinAmount" class="input" value="${rule.min_amount_limit || ''}" step="0.01" />
          </label>
          
          <label class="fieldTitle">Группировка по
            <div class="select-ui" data-name="patternGroupMode"></div>
          </label>
        </div>
      </div>
    ` : isML ? `
      <div class="form-section">
        <label class="fieldTitle">ML модель
          <div class="select-ui" data-name="mlModel"></div>
        </label>
        
        <label class="fieldTitle">Порог срабатывания (0-1)
          <input type="number" id="mlThreshold" class="input" min="0" max="1" step="0.01" value="${rule.threshold || 0.8}" />
        </label>
      </div>

      <div class="form-section">
        <label class="fieldTitle">Шаблон преобразования транзакции
          <textarea id="mlTemplate" class="textarea" rows="4">${esc(rule.input_template || '')}</textarea>
        </label>
        <div class="field-hint">
          Доступные переменные: amount, sender_account, receiver_account, timestamp, transaction_type, location, merchant_category, device_used, payment_channel
        </div>
      </div>
    ` : `
      <div class="form-section">
        <div class="form-grid">
          <label class="fieldTitle">Столбец
            <div class="select-ui" data-name="thColumn"></div>
          </label>
          
          <label class="fieldTitle">Оператор
            <div class="select-ui" data-name="thOp"></div>
          </label>
          
          <label class="fieldTitle">Значение
            <input id="thValue" class="input" value="${rule.value || ''}" />
          </label>
        </div>
      </div>
    `}

    <div class="modal-actions">
      <button class="btn-red" id="cancelBtn">Отмена</button>
      <button class="btn-blue" id="saveBtn">Сохранить изменения</button>
    </div>
  `;

  modal.classList.add('show');

  const q = sel => dialog.querySelector(sel);

  mountSelectUI(
    q('.select-ui[data-name="criticality"]'),
    CRITICALITY_OPTIONS,
    rule.criticality || 'low'
  );

  if (isComposite) {
    initCompositeBuilder(dialog);
  } else if (isPattern) {
    mountSelectUI(
      q('.select-ui[data-name="patternGroupMode"]'),
      GROUP_MODES,
      rule.group_mode || 'sender'
    );
  } else if (isML) {
    mountSelectUI(
      q('.select-ui[data-name="mlModel"]'),
      ML_MODELS,
      rule.model_name || 'ModSpecialization/distilbert-base-uncased-fraud-classifer'
    );
  } else {
    mountSelectUI(
      q('.select-ui[data-name="thColumn"]'),
      NUMERIC_COLUMNS,
      rule.column || NUMERIC_COLUMNS[0].value
    );
    mountSelectUI(
      q('.select-ui[data-name="thOp"]'),
      OPERATORS,
      rule.op || OPERATORS[0].value
    );
  }

  q('#cancelBtn').onclick = () => modal.classList.remove('show');
  q('#saveBtn').onclick = async () => {
    const ruleType = isPattern ? 'pattern' : (isComposite ? 'composite' : (isML ? 'ml' : 'threshold'));
    const payload = collectRulePayload(dialog, ruleType);
    if (!payload) return;
    
    try {
      await updateRule(rule.id, rule.type.toLowerCase(), payload);
      modal.classList.remove('show');
      render();
    } catch (error) {
      console.error('Ошибка при сохранении правила:', error);
    }
  };
}

function initCompositeBuilder(dialog) {
  const q = sel => dialog.querySelector(sel);
  fillButtonGroupHorizontal(q('#columnsGroup'), NUMERIC_COLUMNS, (item) => {
    addToExpression(q('#expressionField'), item.value);
  });
  
  fillButtonGroupHorizontal(q('#operatorsGroup'), OPERATORS, (item) => {
    addToExpression(q('#expressionField'), item.value);
  });
  
  fillButtonGroupHorizontal(q('#logicGroup'), LOGIC_OPERATORS, (item) => {
    addToExpression(q('#expressionField'), item.value);
  });
  
  fillButtonGroupHorizontal(q('#bracketsGroup'), BRACKETS, (item) => {
    addToExpression(q('#expressionField'), item.value);
  });

  q('#addValueBtn').onclick = () => {
    const value = q('#numericValue').value;
    if (value) {
      addToExpression(q('#expressionField'), value);
      q('#numericValue').value = '';
    } else {
      alert('Введите числовое значение');
    }
  };

  q('#numericValue').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      q('#addValueBtn').click();
    }
  });
  
  q('#clearExpressionBtn').onclick = () => {
    if (confirm('Очистить всё выражение?')) {
      q('#expressionField').textContent = '';
    }
  };
  
  q('#validateExpressionBtn').onclick = () => {
    const expression = q('#expressionField').textContent.trim();
    if (!expression) {
      alert('Выражение пустое');
      return;
    }
    
    try {
      validateExpression(expression);
      alert('Выражение корректно!');
    } catch (error) {
      alert(`❌ Ошибка: ${error.message}`);
    }
  };
}

function fillButtonGroupHorizontal(container, items, onClick) {
  container.innerHTML = '';
  items.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'builder-btn-horizontal';
    const shortLabels = {
      'Time since last transaction': 'Time since',
      'Spending deviation score': 'Spending dev',
      'Velocity score': 'Velocity',
      'Geo anomaly score': 'Geo anomaly',
      'Amount': 'Amount',
    };
    button.textContent = shortLabels[item.label] || item.label;
    button.title = item.value;
    button.onclick = () => onClick(item);
    container.appendChild(button);
  });
}

function addToExpression(field, text) {
  const currentText = field.textContent.trim();
  if (currentText && !currentText.endsWith(' ')) {
    field.textContent += ' ' + text + ' ';
  } else {
    field.textContent += text + ' ';
  }
  field.focus();
}

function generateExpressionFromConditions(conditions) {
  if (!conditions || !Array.isArray(conditions)) return '';
  
  let expression = '';
  
  conditions.forEach((condition, index) => {
    if (condition.isGroup) {
      const groupExpression = generateExpressionFromConditions(condition.conditions);
      
      if (condition.logic === 'NOT') {
        expression += `NOT (${groupExpression})`;
      } else {
        expression += `(${groupExpression})`;
      }
    } else {
      const value = typeof condition.value === 'string' && isNaN(condition.value) 
        ? `"${condition.value}"` 
        : condition.value;
      expression += `${condition.column} ${condition.operator} ${value}`;
    }
    if (index < conditions.length - 1) {
      expression += ' AND ';
    }
  });
  
  return expression;
}

function collectRulePayload(root, ruleType) {
  const name = root.querySelector('#ruleName').value.trim();
  const description = root.querySelector('#ruleDescription').value.trim();
  const criticality = getSelectValue(root.querySelector('.select-ui[data-name="criticality"]'));
  if (!name) {
    alert('Введите название правила');
    return null;
  }
  const basePayload = {
    title: name,
    description: description,
    username: 'admin',
    is_active: false,
    criticality: criticality || 'medium'
  };

  if (ruleType === 'threshold') {
    const column = getSelectValue(root.querySelector('.select-ui[data-name="thColumn"]'));
    const operator = getSelectValue(root.querySelector('.select-ui[data-name="thOp"]'));
    const value = root.querySelector('#thValue').value.replace(',', '.');
    const numValue = Number(value);

    if (!column || !operator || !isFinite(numValue)) {
      alert('Заполните корректно все поля условия');
      return null;
    }

    return {
      ...basePayload,
      type: 'threshold',
      column_name: column,
      operator: operator,
      value: numValue
    };
  } else if (ruleType === 'composite') {
    const expression = root.querySelector('#expressionField').textContent.trim();
    
    if (!expression) {
      alert('Создайте выражение правила');
      return null;
    }

    try {
      validateExpression(expression);
      const tokens = tokenizeExpression(expression);
      const ast = parseExpressionToAST(tokens);
      const conditions = convertASTToConditions(ast);
      if (!conditions || conditions.length === 0) {
        throw new Error('Не удалось разобрать выражение');
      }

      return {
        ...basePayload,
        type: 'composite',
        rule: {
          logic: 'AND',
          conditions: conditions
        }
      };
      
    } catch (error) {
      alert(`Ошибка в выражении: ${error.message}`);
      return null;
    }
  } else if (ruleType === 'pattern') {
    const windowMinutes = root.querySelector('#patternWindow').value;
    const minCount = root.querySelector('#patternMinCount').value;
    const minAmount = root.querySelector('#patternMinAmount').value;
    const groupMode = getSelectValue(root.querySelector('.select-ui[data-name="patternGroupMode"]'));
    if (!groupMode) {
      alert('Выберите группировку операций');
      return null;
    }
    if (!windowMinutes && !minCount && !minAmount) {
      alert('Заполните хотя бы одно из полей: временное окно, минимальное количество операций или лимит суммы');
      return null;
    }
    const payload = {
      ...basePayload,
      type: 'pattern',
      group_mode: groupMode
    };

    if (windowMinutes) {
      payload.window_seconds = parseInt(windowMinutes) * 60;
    }
    if (minCount) {
      payload.min_count = parseInt(minCount);
    }
    if (minAmount) {
      payload.min_amount_limit = parseFloat(minAmount);
    }

    return payload;
  } else if (ruleType === 'ml') {
    const modelName = getSelectValue(root.querySelector('.select-ui[data-name="mlModel"]'));
    const threshold = parseFloat(root.querySelector('#mlThreshold').value);
    const inputTemplate = root.querySelector('#mlTemplate').value.trim();

    if (!modelName) {
      alert('Выберите ML модель');
      return null;
    }

    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      alert('Введите корректный порог срабатывания (0-1)');
      return null;
    }

    if (!inputTemplate) {
      alert('Введите шаблон преобразования транзакции');
      return null;
    }

    return {
      ...basePayload,
      type: 'ml',
      model_name: modelName,
      threshold: threshold,
      input_template: inputTemplate
    };
  }
}

export async function initRuleDetailPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const ruleId = urlParams.get('id');
  const ruleType = urlParams.get('type');
  if (!ruleId || !ruleType) return;

  try {
    const ruleData = await RulesAPI.detail(ruleId, ruleType);
    if (!ruleData) {
      document.getElementById('content').innerHTML = '<div class="error">Правило не найдено</div>';
      return;
    }
    renderRuleDetails(ruleData);
  } catch (error) {
    document.getElementById('content').innerHTML = '<div class="error">Ошибка загрузки данных</div>';
  }
}

function renderRuleDetails(rule) {
  elSet('ruleTitle', `Правило: ${rule.name}`);
  elSet('ruleStatus', badge(rule.state), { html: true });
  elSet('ruleName', rule.name);
  elSet('ruleDescription', rule.description || '—');
  elSet('ruleType', rule.type);
  elSet('ruleCriticality', rule.criticality, { html: false });
  const ruleCriticalityElement = document.getElementById('ruleCriticality');
  if (ruleCriticalityElement) {
    ruleCriticalityElement.style.color = getCriticalityColor(rule.criticality);
    ruleCriticalityElement.style.fontWeight = '600';
  }
  elSet('ruleAuthor', rule.by);
  elSet('ruleCreated', formatDateForDisplay(rule.modified));
  elSet('ruleUpdated', formatDateForDisplay(rule.updated));
  
  if (rule.type === 'Threshold') {
    elSet('ruleConditions', `
      <div class="condition-item condition-level-0">
        <div><strong>Столбец:</strong> ${rule.column}</div>
        <div><strong>Оператор:</strong> ${rule.op}</div>
        <div><strong>Значение:</strong> ${rule.value}</div>
      </div>
    `, { html: true });
    elSet('ruleExpression', rule.expr);
  } else if (rule.type === 'Composite') {
    const conditionsHtml = `
      <div class="conditions-container">
        ${renderCompositeConditions(rule.conditions || [])}
      </div>
    `;
    elSet('ruleConditions', conditionsHtml, { html: true });
    elSet('ruleExpression', rule.expr || '—');
  } else if (rule.type === 'Pattern') {
    const patternConditions = renderPatternConditions(rule);
    elSet('ruleConditions', patternConditions, { html: true });
    elSet('ruleExpression', rule.expr || '—');
  } else if (rule.type === 'ML') {
    const mlConditions = renderMLConditions(rule);
    elSet('ruleConditions', mlConditions, { html: true });
    elSet('ruleExpression', rule.expr || '—');
  }
}

function renderMLConditions(rule) {
  const conditions = [];
  if (rule.model_name) {
    conditions.push(`<div><strong>ML модель:</strong> ${rule.model_name}</div>`);
  }
  if (rule.threshold) {
    conditions.push(`<div><strong>Порог срабатывания:</strong> ${rule.threshold}</div>`);
  }
  if (rule.input_template) {
    conditions.push(`<div><strong>Шаблон преобразования:</strong> <code>${esc(rule.input_template)}</code></div>`);
  }
  
  if (conditions.length === 0) {
    return '<div class="empty-state">Параметры ML правила не заданы</div>';
  }
  return `
    <div class="condition-item condition-level-0">
      ${conditions.join('')}
    </div>
  `;
}

function renderPatternConditions(rule) {
  const conditions = [];
  if (rule.window_seconds) {
    const minutes = rule.window_seconds / 60;
    conditions.push(`<div><strong>Временное окно:</strong> ${minutes} минут</div>`);
  }
  if (rule.min_count) {
    conditions.push(`<div><strong>Минимальное количество операций:</strong> ${rule.min_count}</div>`);
  }
  if (rule.min_amount_limit) {
    conditions.push(`<div><strong>Лимит суммы одной операции:</strong> ${rule.min_amount_limit}</div>`);
  }
  if (rule.group_mode) {
    const groupLabels = {
      'sender': 'Отправитель',
      'receiver': 'Получатель',
      'pair': 'Пара отправитель-получатель'
    };
    conditions.push(`<div><strong>Группировка по:</strong> ${groupLabels[rule.group_mode] || rule.group_mode}</div>`);
  }
  if (conditions.length === 0) {
    return '<div class="empty-state">Параметры правила не заданы</div>';
  }
  return `
    <div class="condition-item condition-level-0">
      ${conditions.join('')}
    </div>
  `;
}

function renderCompositeConditions(conditions, level = 0) {
  if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
    return '<div class="empty-state">Условия не заданы</div>';
  }
  let html = '';
  conditions.forEach((condition, index) => {
    const levelClass = `condition-level-${level}`;
    const isLast = index === conditions.length - 1;
    
    if (condition.isGroup) {
      html += `
        <div class="condition-group ${levelClass}">
          <div class="condition-logic"><strong>Группа условий:</strong> ${condition.logic || 'AND'}</div>
          ${renderCompositeConditions(condition.conditions, level + 1)}
        </div>
      `;
    } else {
      html += `
        <div class="condition-item ${levelClass}">
          <div><strong>Столбец:</strong> ${condition.column || '—'}</div>
          <div><strong>Оператор:</strong> ${condition.operator || '—'}</div>
          <div><strong>Значение:</strong> ${condition.value !== undefined ? condition.value : '—'}</div>
        </div>
      `;
    }

    if (!isLast) {
      const logic = 'AND';
      html += `<div class="condition-join ${levelClass}">${logic}</div>`;
    }
  });
  return html;
}

function elSet(id, value, {html = false} = {}) {
  const element = document.getElementById(id);
  if (!element) return;
  if (html) {
    element.innerHTML = value;
  } else {
    element.textContent = value;
  }
}

function badge(state) {
  const isEnabled = state === 'enabled';
  const cls = isEnabled ? 'pill pill-success' : 'pill pill-danger';
  const label = isEnabled ? 'Включено' : 'Отключено';
  return `<span class="${cls}">${label}</span>`;
}

function isNumeric(str) {
  if (typeof str !== 'string') return false;
  return !isNaN(str) && !isNaN(parseFloat(str));
}