import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataVisChart } from './DataVisChart';
import type { DataBlock } from '../types';

const chart: DataBlock = {
  type: 'bar', title: 'Annual ridership', metric: 'Trips', unit: 'million trips',
  xAxisLabel: 'Year', yAxisLabel: 'Trips (millions)', sourceName: 'Transit agency', sourceUrl: 'https://example.org/report',
  data: [
    {label:'2024 complete observation label',value:12,unit:'million trips',metric:'Trips',sourceQuote:'In 2024 there were 12 million trips.'},
    {label:'2025 complete observation label',value:15,unit:'million trips',metric:'Trips',sourceQuote:'In 2025 there were 15 million trips.'},
  ],
};
test('bar display preserves full labels, exact values, units and source link', () => {
  const html=renderToStaticMarkup(createElement(DataVisChart,chart));
  for(const value of ['2024 complete observation label','2025 complete observation label','12','15','million trips','https://example.org/report','Source excerpts']) assert.ok(html.includes(value));
  assert.ok(!html.includes('Editorial Data'));assert.ok(!html.includes('Analysis Unit'));
});
test('unattributed chart is omitted rather than decorated as evidence', () => {
  assert.equal(renderToStaticMarkup(createElement(DataVisChart,{...chart,sourceUrl:undefined})), '');
});
