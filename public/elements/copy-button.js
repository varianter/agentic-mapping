// <copy-button for="input-id" what="group link">: copies the input's value with its button, or selects it to copy
// by hand. `what` names the value in status messages (default: connect URL).
// Without JS the button stays hidden and the read-only input can be copied as usual.
class CopyButton extends HTMLElement {
  connectedCallback() {
    const input = document.getElementById(this.getAttribute('for'));
    const button = this.querySelector('button');
    if (!input || !button) return;
    const what = this.getAttribute('what') ?? 'connect URL';
    const status = document.createElement('span');
    status.className = 'hint';
    status.setAttribute('role', 'status');
    this.after(status);
    input.addEventListener('focus', () => input.select());
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(input.value);
        status.textContent = `${what[0].toUpperCase()}${what.slice(1)} copied.`;
      } catch {
        input.focus();
        input.select();
        status.textContent = `Select and copy the ${what} above.`;
      }
    });
    this.dataset.ready = '';
  }
}

customElements.define('copy-button', CopyButton);
