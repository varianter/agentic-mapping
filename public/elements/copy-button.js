// <copy-button for="input-id">: copies the input's value with its button, or selects it to copy by hand.
// Without JS the button stays hidden and the read-only input can be copied as usual.
class CopyButton extends HTMLElement {
  connectedCallback() {
    const input = document.getElementById(this.getAttribute('for'));
    const button = this.querySelector('button');
    if (!input || !button) return;
    const status = document.createElement('span');
    status.className = 'hint';
    status.setAttribute('role', 'status');
    this.after(status);
    input.addEventListener('focus', () => input.select());
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(input.value);
        status.textContent = 'Connect URL copied.';
      } catch {
        input.focus();
        input.select();
        status.textContent = 'Select and copy the connect URL above.';
      }
    });
    this.dataset.ready = '';
  }
}

customElements.define('copy-button', CopyButton);
