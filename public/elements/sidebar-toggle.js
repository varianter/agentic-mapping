// <sidebar-toggle><button popovertarget="sidebar">: on wide screens, collapses the sidebar beside the sheet,
// so the list and admin links stay off a shared screen. On phones the button opens the sidebar popover as usual.
// The choice is kept in a cookie, so the server renders the next page collapsed too, without a flash of the list.
const wide = matchMedia('(min-width: 901px)');

class SidebarToggle extends HTMLElement {
  connectedCallback() {
    this.button = this.querySelector('button');
    this.sidebar = document.getElementById(this.button?.getAttribute('popovertarget'));
    if (!this.button || !this.sidebar) return;
    this.button.addEventListener('click', (event) => {
      if (!wide.matches) return;
      event.preventDefault(); // no popover beside the sheet
      this.collapse(!this.sidebar.hasAttribute('data-collapsed'));
    });
    wide.addEventListener('change', () => this.sync());
    this.sync();
    this.dataset.ready = '';
  }

  collapse(collapsed) {
    this.sidebar.toggleAttribute('data-collapsed', collapsed);
    const secure = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `am_sidebar=${collapsed ? 'closed' : 'open'}; path=/; max-age=31536000; samesite=strict${secure}`;
    this.sync();
  }

  // Phones get aria-expanded from the popover itself.
  sync() {
    if (wide.matches) this.button.setAttribute('aria-expanded', String(!this.sidebar.hasAttribute('data-collapsed')));
    else this.button.removeAttribute('aria-expanded');
  }
}

customElements.define('sidebar-toggle', SidebarToggle);
