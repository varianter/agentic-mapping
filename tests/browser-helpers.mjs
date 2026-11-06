// Pages cross-fade with cross-document view transitions. Resizing during one aborts it, which Chromium
// reports as a page error, so let any running transition finish first.
export async function resize(page, size) {
  await page.evaluate(() => document.activeViewTransition?.finished.catch(() => {}));
  await page.setViewportSize(size);
}
