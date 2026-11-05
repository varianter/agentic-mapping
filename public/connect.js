// Posts the private link's fragment credential to /connect in a form body: never in a URL, storage or log.
const credential = location.hash.slice(1);
const form = document.getElementById('connect-form');
if (/^[a-f0-9]{64}$/.test(credential)) {
  form.elements.credential.value = credential;
  form.submit();
} else {
  document.getElementById('connect-status').textContent = 'Link unavailable. Ask your interviewer for a new private link. No other interview has been opened.';
}
// Pasting another link into the same tab only changes the fragment.
addEventListener('hashchange', () => location.reload());
