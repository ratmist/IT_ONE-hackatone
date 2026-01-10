export const $  = (s, r=document) => r.querySelector(s);
export const $$ = (s, r=document) => [...r.querySelectorAll(s)];
export const esc = (s)=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
export const debounce = (fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};
export const rid = ()=>Math.random().toString(36).slice(2,9);

export const fmt = {
  dateISO: (d)=>d.toISOString().slice(0,10),
  dateRu:  (iso)=>iso?.split('-').reverse().join('.') || '',
  dateTime: (d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
  money:   new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}),
};

export const icons = {
  pencil: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`,
  eye:    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  trash:  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green-text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-check-icon lucide-shield-check"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`
};

export const VALID_COLUMNS = ['amount', 'spending_deviation_score', 'time_since_last_transaction', 'velocity_score', 'geo_anomaly_score'];
export const VALID_OPERATORS = ['>', '>=', '<', '<=', '==', '!=', '='];
export const VALID_LOGIC_OPERATORS = ['AND', 'OR', '&&', '||', 'NOT', '!'];

export const NUMERIC_COLUMNS = [
  { value: 'time_since_last_transaction', label: 'Time since last transaction' },
  { value: 'spending_deviation_score', label: 'Spending deviation score' },
  { value: 'velocity_score', label: 'Velocity score' },
  { value: 'geo_anomaly_score', label: 'Geo anomaly score' },
  { value: 'amount', label: 'Amount' },
];

export const OPERATORS = [
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: '==', label: '==' },
  { value: '!=', label: '!=' }
];

export const LOGIC_OPERATORS = [
  { value: 'AND', label: 'AND' },
  { value: 'OR', label: 'OR' },
  { value: 'NOT', label: 'NOT' }
];

export const BRACKETS = [
  { value: '(', label: '(' },
  { value: ')', label: ')' }
];

export const UploadManager = {
  isUploadInProgress: () => uploadInProgress,
  getUploadStats: () => currentUploadStats,
  cancelUpload: () => { uploadInProgress = false; }
};

export function setupTypeButtons(root, current, onChange) {
  const btns = Array.from(root.querySelectorAll('.type-btn'));
  const setActive = t => btns.forEach(b => b.classList.toggle('active', b.dataset.type === t));
  setActive(current);
  btns.forEach(b => b.onclick = () => {
    setActive(b.dataset.type);
    onChange(b.dataset.type);
  });
}

export function toggleForms(root, type) {
  const thresholdForm = root.querySelector('#formThreshold');
  const compositeForm = root.querySelector('#formComposite');
  const patternForm   = root.querySelector('#formPattern');
  const mlForm        = root.querySelector('#formML'); 

  if (thresholdForm) thresholdForm.style.display = (type === 'threshold') ? 'block' : 'none';
  if (compositeForm) compositeForm.style.display = (type === 'composite') ? 'block' : 'none';
  if (patternForm)   patternForm.style.display   = (type === 'pattern')   ? 'block' : 'none';
  if (mlForm)        mlForm.style.display        = (type === 'ml')        ? 'block' : 'none';

  const btns = Array.from(root.querySelectorAll('.type-btn'));
  btns.forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
}

export function getSelectValue(wrap) {
  return wrap?.dataset?.value || '';
}

export function mountSelectUI(wrap, options, initialValue) {
  if (!wrap) {
    return;
  }
  if (!options || !Array.isArray(options) || options.length === 0) {
    return;
  }
  try {
    wrap.innerHTML = `
      <button type="button" class="select-btn">—</button>
      <ul class="select-menu">
        ${options.map(o => `<li data-value="${esc(o.value)}">${esc(o.label)}</li>`).join('')}
      </ul>
    `;
    const btn = wrap.querySelector('.select-btn');
    const menu = wrap.querySelector('.select-menu');
    if (!btn || !menu) {
      return;
    }

    const setValue = (val) => {
      wrap.dataset.value = val;
      const li = menu.querySelector(`[data-value="${CSS.escape(val)}"]`) || menu.querySelector('li');
      menu.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === li));
      btn.textContent = li ? li.textContent : '—';
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllSelects();
      wrap.classList.toggle('open');
    });

    menu.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (li) {
        setValue(li.dataset.value);
        wrap.classList.remove('open');
      }
    });

    document.addEventListener('click', () => {
      wrap.classList.remove('open');
    });
    const validInitialValue = options.some(opt => opt.value === initialValue) 
      ? initialValue 
      : (options[0]?.value || '');
    
    setValue(validInitialValue);
  } catch (error) {
    console.error('mountSelectUI error:', error);
  }
}

export function closeAllSelects() {
  document.querySelectorAll('.select-ui.open').forEach(el => el.classList.remove('open'));
}