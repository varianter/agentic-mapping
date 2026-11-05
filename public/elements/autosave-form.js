// <autosave-form status="save-status">: saves its server-rendered <form> as you type.
// It posts the same form body the Save button would, asking for JSON, and keeps the hidden revision current.
// Without JS the form still works: Save posts it and the server redirects back.
const DELAY = 400;

class AutosaveForm extends HTMLElement {
  #form;
  #timer = null;
  #dirty = false;
  #saving = null;
  #conflicted = false;
  #releasing = false;

  connectedCallback() {
    this.#form = this.querySelector('form');
    if (!this.#form) return;
    this.dataset.ready = '';
    this.#form.addEventListener('input', () => this.#changed());
    this.#form.addEventListener('submit', (event) => this.#submitted(event));
    addEventListener('beforeunload', (event) => {
      if (this.#dirty || this.#saving) event.preventDefault();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    addEventListener('online', () => this.flush());
  }

  // Save stays on the page. Other submitters (formaction, e.g. Delete) go ahead once pending edits are saved,
  // so they carry the current revision.
  async #submitted(event) {
    const submitter = event.submitter;
    if (submitter?.hasAttribute('formaction')) {
      if (this.#releasing) return;
      event.preventDefault();
      await this.flush();
      // A new task: browsers ignore a submit requested while the first submit event is still dispatching.
      await new Promise((resolve) => setTimeout(resolve));
      this.#releasing = true;
      this.#form.requestSubmit(submitter);
      this.#releasing = false;
      return;
    }
    event.preventDefault();
    this.flush();
  }

  get #status() {
    return document.getElementById(this.getAttribute('status'));
  }

  #setStatus(message, state = '') {
    const status = this.#status;
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  #changed() {
    this.#dirty = true;
    clearTimeout(this.#timer);
    if (this.#conflicted) return;
    this.#setStatus('Unsaved changes…');
    this.#timer = setTimeout(() => this.flush(), DELAY);
  }

  // Saves until no edits are left; typing during a save sends a second snapshot with the new revision.
  async flush() {
    clearTimeout(this.#timer);
    if (this.#saving) return this.#saving;
    if (!this.#dirty || this.#conflicted) return;
    this.#saving = this.#saveAll().finally(() => { this.#saving = null; });
    return this.#saving;
  }

  async #saveAll() {
    while (this.#dirty && !this.#conflicted) {
      this.#dirty = false;
      this.#setStatus('Saving…');
      try {
        const response = await fetch(this.#form.action, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new URLSearchParams(new FormData(this.#form)),
          credentials: 'same-origin',
          keepalive: document.visibilityState === 'hidden',
          signal: AbortSignal.timeout(15000),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          this.#dirty = true;
          this.#conflicted = [404, 409].includes(response.status);
          this.#setStatus(result.error ?? `Could not save (${response.status}).`, 'error');
          return;
        }
        this.#form.elements.revision.value = result.revision;
        this.dispatchEvent(new CustomEvent('autosave:saved', { bubbles: true, detail: result }));
      } catch {
        this.#dirty = true;
        this.#setStatus('Could not save: check your connection. Keep this tab open; it saves again as you type.', 'error');
        return;
      }
    }
    if (!this.#dirty) this.#setStatus('Saved to server');
  }
}

customElements.define('autosave-form', AutosaveForm);
