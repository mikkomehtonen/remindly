const { describe, it } = require('node:test');
const assert = require('node:assert');
const { VALID_CATEGORIES } = require('../src/config/categories');

describe('Category configuration', () => {
  it('exports the full category list with Travel appended last', () => {
    assert.deepStrictEqual(VALID_CATEGORIES, [
      'Birthday',
      'Name Day',
      'Flag Day',
      'Holiday',
      'Anniversary',
      'Other',
      'Travel',
    ]);
  });
});
