// Shared grids, tabs and plain-text form values.
export function initForm(form) {
  // ---------- Dimensions: one 3x3 grid each, shown as tabs ----------

  const DIMENSIONS = [
    { key: 'ind', name: 'Individual', hint: 'How you work on your own' },
    { key: 'team', name: 'Team', hint: 'How your team works together' },
    { key: 'org', name: 'Organization', hint: 'What your organization enables or gets in the way of' },
  ];
  const GRID_FIELDS = ['learn', 'why', 'found'].flatMap((q) => ['start', 'good', 'next'].map((l) => `${q}_${l}`));

  const tabList = document.getElementById('dim-tabs');
  const panelHost = document.getElementById('dim-panels');
  const template = document.getElementById('matrix-template');

  for (const dim of DIMENSIONS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'dim-tab';
    tab.id = `tab-${dim.key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `panel-${dim.key}`);
    tab.dataset.dim = dim.key;
    tab.textContent = dim.name;
    tabList.append(tab);

    const panel = template.content.firstElementChild.cloneNode(true);
    panel.id = `panel-${dim.key}`;
    panel.dataset.dim = dim.key;
    panel.setAttribute('aria-labelledby', tab.id);
    panel.querySelector('.dim-name').textContent = dim.name;
    panel.querySelector('.dim-hint').textContent = dim.hint;
    for (const ta of panel.querySelectorAll('textarea')) ta.name = `${dim.key}_${ta.name}`;
    for (const sr of panel.querySelectorAll('.cell .visually-hidden')) sr.textContent = `${dim.name}: ${sr.textContent}`;
    panelHost.append(panel);
  }

  function selectDimension(key, { focus = false } = {}) {
    for (const tab of tabList.children) {
      const on = tab.dataset.dim === key;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
    for (const panel of panelHost.children) panel.toggleAttribute('data-active', panel.dataset.dim === key);
  }

  function markFilledDimensions() {
    for (const dim of DIMENSIONS) {
      const filled = [...document.getElementById(`panel-${dim.key}`).querySelectorAll('textarea')].some((t) => t.value.trim());
      const tab = document.getElementById(`tab-${dim.key}`);
      tab.toggleAttribute('data-filled', filled);
      tab.setAttribute('aria-description', filled ? 'Has notes' : 'Empty');
    }
  }

  tabList.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) selectDimension(tab.dataset.dim);
  });
  tabList.addEventListener('keydown', (e) => {
    const tabs = [...tabList.children];
    const i = tabs.indexOf(document.activeElement);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined || i < 0) return;
    e.preventDefault();
    selectDimension(tabs[(next + tabs.length) % tabs.length].dataset.dim, { focus: true });
  });
  selectDimension(DIMENSIONS[0].key);

  // ---------- Form <-> data ----------

  function readForm() {
    const fields = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') {
        fields[el.name] ??= [];
        if (el.checked) fields[el.name].push(el.value);
      } else {
        fields[el.name] = el.value;
      }
    }
    return fields;
  }

  function fillForm(fields = {}) {
    // Sheets made before dimensions existed had one grid: treat it as Individual.
    fields = { ...fields };
    for (const name of GRID_FIELDS) {
      if (fields[name] && !fields[`ind_${name}`]) fields[`ind_${name}`] = fields[name];
    }
    for (const el of form.elements) {
      if (!el.name) continue;
      const value = fields[el.name];
      if (el.type === 'checkbox') el.checked = Array.isArray(value) && value.includes(el.value);
      else el.value = value ?? '';
    }
    markFilledDimensions();
  }

  return { readForm, fillForm, markFilledDimensions };
}

export function downloadJson(sheets, filename = 'agentic-mapping-draft.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(sheets, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
