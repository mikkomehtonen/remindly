const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');
const { VALID_CATEGORIES } = require('../src/config/categories');
const { windowFromHtml } = require('./helpers/dom');

const VIEW = path.join(__dirname, '..', 'views', 'admin', 'eventForm.ejs');
const ROW_ATTRIBUTES = ['type', 'name', 'maxlength', 'placeholder'];

const TRAVEL_EVENT = {
  id: 1,
  title: 'Trip',
  description: '',
  category: 'Travel',
  is_recurring: 1,
  month: 6,
  day: 15,
  event_date: null,
};

/**
 * Render the real admin event form and hand back a jsdom window whose inline
 * script has run. Pass a Travel `event` to render the edit-style form with saved
 * packing rows.
 */
async function renderForm({ event = null, packingItems = [] }) {
  const html = await ejs.renderFile(VIEW, {
    event,
    errors: [],
    categories: VALID_CATEGORIES,
    csrfToken: 'test',
    packingItems,
  });
  return windowFromHtml(html);
}

function savedItems(count) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, label: `Gear ${i + 1}` }));
}

function rowsOf(window) {
  return Array.from(window.document.querySelectorAll('.packing-fields .packing-row'));
}

function labelInputsOf(window) {
  return Array.from(
    window.document.querySelectorAll('.packing-fields input[name="packing_items[]"]'),
  );
}

function typeInto(window, input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('Packing list auto-grow — admin event form', () => {
  it('appends one blank row when the last blank row gets its first character', async () => {
    const window = await renderForm({});
    const before = rowsOf(window);
    assert.strictEqual(before.length, 3, 'form pre-renders 3 blank rows');
    const serverBlank = before[0].querySelector('input[name="packing_items[]"]');

    const lastRow = before[before.length - 1];
    typeInto(window, lastRow.querySelector('input[name="packing_items[]"]'), 'Passport');

    const after = rowsOf(window);
    assert.strictEqual(labelInputsOf(window).length, 4, 'one new packing_items[] input appears');
    assert.strictEqual(after.length, 4);

    const grown = after[3];
    assert.strictEqual(grown, lastRow.nextElementSibling, 'row is appended after the previous last row');
    assert.strictEqual(grown.tagName, 'DIV');
    assert.ok(grown.classList.contains('packing-row'));

    const inputs = grown.querySelectorAll('input');
    assert.strictEqual(inputs.length, 1, 'exactly one input in the new row');
    const input = inputs[0];
    assert.strictEqual(input.value, '', 'appended row is blank');
    assert.strictEqual(input.getAttribute('placeholder'), 'Add a new packing item');
    assert.strictEqual(input.getAttribute('maxlength'), '200');
    // The appended row must be indistinguishable from a server-rendered blank row:
    // its attributes are hand-written in two places (EJS loop + this script), so any
    // edit to one side must break here rather than ship divergent rows.
    assert.deepStrictEqual(
      input.getAttributeNames().slice().sort(),
      serverBlank.getAttributeNames().slice().sort(),
      'appended row must carry exactly the attribute set of the server-rendered blank row',
    );
    for (const attr of ROW_ATTRIBUTES) {
      assert.strictEqual(
        input.getAttribute(attr),
        serverBlank.getAttribute(attr),
        `appended row must match the server-rendered blank row on ${attr}`,
      );
    }
    assert.strictEqual(
      grown.querySelectorAll('input[name="packing_item_ids[]"]').length,
      0,
      'appended row carries no hidden id',
    );
  });

  it('appended row lands inside the form and is submitted with the other rows', async () => {
    const window = await renderForm({});
    const form = window.document.querySelector('form');
    const before = rowsOf(window);
    typeInto(window, before[2].querySelector('input[name="packing_items[]"]'), 'Passport');

    const grown = rowsOf(window)[3];
    assert.ok(form.contains(grown), 'appended row must live inside <form> or it is never submitted');
    const formGroup = window.document.querySelector('.packing-fields .form-group');
    assert.ok(
      formGroup.contains(grown) && formGroup.contains(before[0]),
      'appended row shares the server rows .form-group wrapper (styling + markup parity)',
    );
    assert.deepStrictEqual(
      Array.from(new window.FormData(form).getAll('packing_items[]')),
      ['', '', 'Passport', ''],
      'FormData carries the grown row last, blank and unnamed-id free',
    );
    assert.deepStrictEqual(
      new window.FormData(form).getAll('packing_item_ids[]'),
      [],
      'no hidden ids exist on a new event form',
    );
  });

  it('grows by exactly one row per filled row (3 -> 4 -> 5 -> 6)', async () => {
    const window = await renderForm({});
    for (const expectedBefore of [3, 4, 5]) {
      const rows = rowsOf(window);
      assert.strictEqual(rows.length, expectedBefore);
      const lastRow = rows[rows.length - 1];
      typeInto(window, lastRow.querySelector('input[name="packing_items[]"]'), `Item ${expectedBefore}`);
      assert.strictEqual(
        rowsOf(window).length,
        expectedBefore + 1,
        `exactly one row appended after filling row ${expectedBefore}`,
      );
    }
    assert.strictEqual(rowsOf(window).length, 6);
  });

  it('ignores input events from rows that are not packing label inputs', async () => {
    const window = await renderForm({ event: TRAVEL_EVENT, packingItems: savedItems(2) });
    assert.strictEqual(rowsOf(window).length, 5, '2 saved rows + 3 blank rows');
    const [hiddenId] = window.document.querySelectorAll('input[name="packing_item_ids[]"]');
    hiddenId.value = '99999';
    hiddenId.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.strictEqual(rowsOf(window).length, 5, 'hidden id input must not trigger a grow');
  });

  it('does not grow while a blank row already trails the typed row', async () => {
    const window = await renderForm({});
    const rows = rowsOf(window);
    typeInto(window, rows[0].querySelector('input[name="packing_items[]"]'), 'Passport');
    assert.strictEqual(rowsOf(window).length, 3, 'last row is still blank — no append');
  });

  it('does not grow when the last row is cleared to empty', async () => {
    const window = await renderForm({});
    typeInto(window, labelInputsOf(window)[2], 'Passport');
    assert.strictEqual(rowsOf(window).length, 4);

    const lastRow = rowsOf(window)[3];
    typeInto(window, lastRow.querySelector('input[name="packing_items[]"]'), '');
    assert.strictEqual(rowsOf(window).length, 4, 'emptying the last row appends nothing');
  });

  it('treats whitespace-only as empty (matches the server trim rule)', async () => {
    const window = await renderForm({});
    typeInto(window, labelInputsOf(window)[2], 'Passport');
    assert.strictEqual(rowsOf(window).length, 4);

    const lastRow = rowsOf(window)[3];
    typeInto(window, lastRow.querySelector('input[name="packing_items[]"]'), '   ');
    assert.strictEqual(rowsOf(window).length, 4, 'trimmed-empty last row appends nothing');
  });

  it('grows up to exactly 50 rows from a 49-row form', async () => {
    const window = await renderForm({ event: TRAVEL_EVENT, packingItems: savedItems(46) });
    assert.strictEqual(rowsOf(window).length, 49, '46 saved rows + 3 blank rows');

    const rows = rowsOf(window);
    typeInto(window, rows[48].querySelector('input[name="packing_items[]"]'), 'Gear 47');
    assert.strictEqual(rowsOf(window).length, 50, 'growth is still allowed below the cap');

    const lastRow = rowsOf(window)[49];
    typeInto(window, lastRow.querySelector('input[name="packing_items[]"]'), 'Gear 48');
    assert.strictEqual(rowsOf(window).length, 50, 'no 51st row is ever appended');
  });

  it('stops appending once the form already holds 50 packing rows', async () => {
    const window = await renderForm({ event: TRAVEL_EVENT, packingItems: savedItems(47) });
    assert.strictEqual(rowsOf(window).length, 50, '47 saved rows + 3 blank rows');

    const lastRow = rowsOf(window)[49];
    typeInto(window, lastRow.querySelector('input[name="packing_items[]"]'), 'One more item');
    assert.strictEqual(
      rowsOf(window).length,
      50,
      'append guard stops at 50 rendered rows, mirroring the server row cap',
    );
  });

  it('renders no blank rows past the cap, so filling blanks cannot exceed 50 items', async () => {
    for (const savedCount of [47, 48, 49, 50]) {
      const window = await renderForm({
        event: TRAVEL_EVENT,
        packingItems: savedItems(savedCount),
      });
      const rows = rowsOf(window);
      assert.strictEqual(rows.length, 50, `${savedCount} saved rows render exactly 50 rows total`);
      assert.strictEqual(
        rows.filter((row) => row.querySelector('input[name="packing_item_ids[]"]') === null).length,
        50 - savedCount,
        `${savedCount} saved rows render only ${50 - savedCount} blank rows`,
      );
    }
  });
});
