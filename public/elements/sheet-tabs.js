// <sheet-tabs>: turns the server-rendered dimension sections into an ARIA tablist on screen.
// Without JS, and in print, all three grids show one after another.
class SheetTabs extends HTMLElement {
  #tabs = [];
  #panels = [];

  connectedCallback() {
    this.#panels = [...this.querySelectorAll(':scope > .dim-panel')];
    if (!this.#panels.length || this.dataset.ready !== undefined) return;
    const list = document.createElement('div');
    list.className = 'dim-tabs';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Dimension');
    this.#tabs = this.#panels.map((panel) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'dim-tab';
      tab.id = `tab-${panel.dataset.dim}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panel.id);
      const label = document.createElement('span');
      label.textContent = panel.dataset.name;
      tab.append(label);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      return tab;
    });
    list.append(...this.#tabs);
    this.prepend(list);
    list.addEventListener('click', (event) => {
      const index = this.#tabs.indexOf(event.target.closest('[role="tab"]'));
      if (index >= 0) this.select(index);
    });
    list.addEventListener('keydown', (event) => {
      const index = this.#tabs.indexOf(document.activeElement);
      const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: this.#tabs.length - 1 }[event.key];
      if (next === undefined || index < 0) return;
      event.preventDefault();
      this.select((next + this.#tabs.length) % this.#tabs.length, { focus: true });
    });
    this.addEventListener('input', () => this.#markFilled());
    this.select(0);
    this.#markFilled();
    this.dataset.ready = '';
  }

  select(index, { focus = false } = {}) {
    this.#tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    this.#panels.forEach((panel, i) => panel.toggleAttribute('data-active', i === index));
    if (focus) this.#tabs[index].focus();
  }

  #markFilled() {
    this.#panels.forEach((panel, i) => {
      const filled = [...panel.querySelectorAll('textarea')].some((field) => field.value.trim());
      this.#tabs[i].toggleAttribute('data-filled', filled);
      this.#tabs[i].setAttribute('aria-description', filled ? 'Has notes' : 'Empty');
    });
  }
}

customElements.define('sheet-tabs', SheetTabs);
