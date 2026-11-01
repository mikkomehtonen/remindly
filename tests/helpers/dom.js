const { JSDOM } = require('jsdom');

/** Parse a page without executing its scripts — for markup-only assertions. */
function documentFromHtml(html) {
  return new JSDOM(html).window.document;
}

/**
 * Parse a page with jsdom, running its inline scripts, and resolve once the
 * window 'load' event has settled — the point at which a view's `window.onload`
 * initializers have run. JSDOM only flips readyState to 'complete' in a microtask
 * after parsing, so awaiting load is the normal path; the readyState check just
 * guards a version where the event already fired.
 */
async function windowFromHtml(html) {
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  if (dom.window.document.readyState !== 'complete') {
    await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  }
  return dom.window;
}

module.exports = { documentFromHtml, windowFromHtml };
