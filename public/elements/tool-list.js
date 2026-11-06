// <tool-list>: turns a server-rendered one-per-line <textarea> into a list you add to by typing and pressing Enter.
// The textarea stays the form field: every change rewrites it and fires `input`, so <autosave-form> saves it.
// Without JS the textarea is edited directly. A <datalist> inside autocompletes the input with what others listed;
// items already on the list aren't suggested.
const itemsOf = (value) => value.split('\n').map((item) => item.trim()).filter(Boolean);

class ToolList extends HTMLElement {
  #field;
  #list;
  #input;
  #status;
  #suggestions;

  connectedCallback() {
    this.#field = this.querySelector('textarea');
    if (!this.#field || this.dataset.ready !== undefined) return;
    const label = document.querySelector(`label[for="${this.#field.id}"]`)?.textContent ?? 'Tools and techniques';

    this.#list = document.createElement('ul');
    this.#list.className = 'tool-items';
    this.#list.setAttribute('aria-label', label);

    // No name: the textarea carries the value. Typing here isn't a change until it's added.
    this.#input = document.createElement('input');
    this.#input.type = 'text';
    this.#input.className = 'tool-input';
    this.#input.placeholder = 'Type one and press Enter';
    this.#input.setAttribute('aria-label', `Add to ${label.toLowerCase()}`);
    const description = this.#field.getAttribute('aria-describedby');
    if (description) this.#input.setAttribute('aria-describedby', description);
    this.#suggestions = this.querySelector('datalist');
    if (this.#suggestions) this.#input.setAttribute('list', this.#suggestions.id);
    // Picking a suggestion adds it straight away.
    this.#input.addEventListener('input', (event) => {
      event.stopPropagation();
      const picked = !(event instanceof InputEvent) || event.inputType === 'insertReplacementText';
      if (picked && [...this.#suggestions?.options ?? []].some((option) => option.value === this.#input.value)) this.#add([this.#input.value]);
    });
    this.#input.addEventListener('keydown', (event) => this.#keydown(event));
    // Pasting several lines adds each one.
    this.#input.addEventListener('paste', (event) => {
      const pasted = itemsOf(event.clipboardData?.getData('text') ?? '');
      if (pasted.length < 2) return;
      event.preventDefault();
      this.#add(pasted);
    });

    this.#status = document.createElement('span');
    this.#status.className = 'visually-hidden';
    this.#status.setAttribute('role', 'status');

    this.#list.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-remove]');
      if (button) this.#remove(Number(button.dataset.remove));
    });

    this.#field.hidden = true;
    this.append(this.#list, this.#input, this.#status);
    this.#render();
    this.dataset.ready = '';
  }

  get #items() {
    return itemsOf(this.#field.value);
  }

  #keydown(event) {
    if (event.key === 'Enter') {
      // Enter in a text input would submit the sheet.
      event.preventDefault();
      if (this.#input.value.trim()) this.#add([this.#input.value]);
    } else if (event.key === 'Backspace' && !this.#input.value && this.#items.length) {
      this.#remove(this.#items.length - 1);
    }
  }

  #add(values) {
    const items = this.#items;
    const known = new Set(items.map((item) => item.toLowerCase()));
    const added = values.map((value) => value.trim()).filter((value) => value && !known.has(value.toLowerCase()) && known.add(value.toLowerCase()));
    this.#input.value = '';
    if (!added.length) {
      this.#status.textContent = 'Already on the list.';
      return;
    }
    this.#write([...items, ...added]);
    this.#status.textContent = `Added ${added.join(', ')}.`;
  }

  #remove(index) {
    const items = this.#items;
    const [removed] = items.splice(index, 1);
    this.#write(items);
    this.#status.textContent = `Removed ${removed}.`;
    this.#input.focus();
  }

  #write(items) {
    this.#field.value = items.join('\n');
    this.#field.dispatchEvent(new Event('input', { bubbles: true }));
    this.#render();
  }

  #render() {
    const listed = new Set(this.#items.map((item) => item.toLowerCase()));
    for (const option of this.#suggestions?.options ?? []) option.disabled = listed.has(option.value.toLowerCase());
    this.#list.replaceChildren(...this.#items.map((item, index) => {
      const entry = document.createElement('li');
      entry.className = 'tool-item';
      const name = document.createElement('span');
      name.textContent = item;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.remove = String(index);
      remove.setAttribute('aria-label', `Remove ${item}`);
      remove.textContent = '×';
      entry.append(name, remove);
      return entry;
    }));
  }
}

customElements.define('tool-list', ToolList);
