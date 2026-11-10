// <model-shares from="models">: a percentage split per model family, each adding up to 100 over its tiers.
// Shows only the families ticked in the `from` checkboxes of the same form, each with a running total. The inputs
// stay the form fields, so <autosave-form> saves them as typed; hidden families are disabled, and the server
// ignores families that aren't ticked anyway.
// Without JS every family shows and the server checks each total when moving on.
class ModelShares extends HTMLElement {
  #form;

  connectedCallback() {
    this.#form = this.closest('form');
    if (!this.#form || this.dataset.ready !== undefined) return;
    this.#form.addEventListener('input', (event) => {
      if (event.target.name === this.getAttribute('from') || this.contains(event.target)) this.#render();
    });
    this.dataset.ready = '';
    this.#render();
  }

  get #ticked() {
    const from = this.getAttribute('from');
    return new Set([...this.#form.querySelectorAll(`input[name="${CSS.escape(from)}"]:checked`)].map((input) => input.value));
  }

  #render() {
    const ticked = this.#ticked;
    const groups = [...this.querySelectorAll('.share-group')];
    for (const group of groups) {
      group.hidden = !ticked.has(group.dataset.option);
      // A hidden family neither blocks Next with a stale invalid number nor posts it.
      group.disabled = group.hidden;
      const total = [...group.querySelectorAll('input')].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
      const status = group.querySelector('.share-total');
      status.querySelector('output').value = String(total);
      status.dataset.state = total === 100 ? 'done' : total > 100 ? 'over' : total ? 'under' : '';
    }
    // Nothing to split until a family with tiers is ticked.
    this.closest('.survey-question')?.toggleAttribute('hidden', groups.every((group) => group.hidden));
  }
}

customElements.define('model-shares', ModelShares);
