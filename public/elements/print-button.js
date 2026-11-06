// <print-button data-title="Interview - {name} - {date}">: saves pending edits, then prints the sheet.
// Browsers use the document title as the PDF's default file name; {field} parts come from the sheet form.
class PrintButton extends HTMLElement {
  connectedCallback() {
    this.dataset.ready = '';
    this.querySelector('button')?.addEventListener('click', () => this.print());
  }

  async print() {
    await document.querySelector('autosave-form')?.flush?.().catch(() => {});
    const form = document.getElementById('sheet');
    const title = (this.dataset.title ?? document.title)
      .replace(/\{(\w+)\}/g, (_, name) => form?.elements[name]?.value?.trim() ?? '')
      .split(' - ').filter(Boolean).join(' - ');
    const previous = document.title;
    document.title = title;
    addEventListener('afterprint', () => { document.title = previous; }, { once: true });
    print();
  }
}

customElements.define('print-button', PrintButton);
