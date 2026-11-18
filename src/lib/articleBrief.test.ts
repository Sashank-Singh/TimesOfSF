import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArticleBrief } from './articleBrief';

test('brief contains reporting, context and outlook paragraphs without repeating summary or source notes', () => {
  const result = buildArticleBrief(`### What happened

A company raised funding. Its valuation remains unconfirmed.

More investor details.

### The context

It previously raised a smaller round, according to [the report](https://example.com).

### By the numbers

[CHART:0]

### What to watch

Clinical trials are next. Success is not guaranteed.

### Source Notes

This story relies on an outlet.`, 'A short summary.');
  assert.equal(result.split('\n\n').length, 3);
  assert.match(result, /valuation remains unconfirmed/);
  assert.match(result, /previously raised/);
  assert.match(result, /Success is not guaranteed/);
  assert.doesNotMatch(result, /CHART|Source Notes|relies on an outlet|More investor/);
});

test('unsectioned articles supply prose, skip the opening summary, and never invent missing text', () => {
  assert.equal(buildArticleBrief('Already in summary.\n\nA further detail.\n\nAnother detail.', 'Already in summary.'), 'A further detail.\n\nAnother detail.');
  assert.equal(buildArticleBrief('', 'Summary only.'), '');
});
