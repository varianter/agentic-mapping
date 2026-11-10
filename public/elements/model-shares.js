// <model-shares from="models">: a percentage split over model tiers. Shows only the families ticked in the
// `from` checkboxes of the same form, and keeps a running total against 100. The inputs stay the form fields,
// so <autosave-form> saves them as typed; the server ignores families that aren't ticked.
// Without JS every family shows and the server checks the total when moving on.
class ModelShares extends HTMLElement {
  #form;
  #output;
  #total;

  connectedCallback() {
    this.#form = this.closest('form');
    this.#total = this.querySelector('.share-total');
    this.#output = this.#total?.querySelector('output');
    if (!this.#form || !this.#output || this.dataset.ready !== undefined) return;
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
    for (const group of groups) group.hidden = !ticked.has(group.dataset.option);
    const visible = groups.filter((group) => !group.hidden);
    // Nothing to split until a family is ticked.
    this.closest('.survey-question')?.toggleAttribute('hidden', visible.length === 0);
    const total = visible.flatMap((group) => [...group.querySelectorAll('input')]).reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    this.#output.value = String(total);
    this.#total.dataset.state = total === 100 ? 'done' : total > 100 ? 'over' : total ? 'under' : '';
  }
}

customElements.define('model-shares', ModelShares);
