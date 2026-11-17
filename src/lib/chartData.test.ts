import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartMatchesSource, isSourceLinkedChart } from './chartData';

const series = () => ({type: 'bar', title: 'Ridership by year', xAxisLabel: 'Year', yAxisLabel: 'Trips (millions)', metric: 'Annual trips', unit: 'million trips', sourceName: 'Transit agency', sourceUrl: 'https://example.org/report', data: [
  {sourceQuote: 'In 2024 there were 12 million trips.', label: '2024', value: 12, metric: 'Annual trips', unit: 'million trips'},
  {sourceQuote: 'In 2025 there were 15 million trips.', label: '2025', value: 15, metric: 'Annual trips', unit: 'million trips'},
]});
test('accepts an explicitly attributed comparable series, including a genuine zero', () => {const b=series(); b.data[0].value=0; assert.equal(isSourceLinkedChart(b),true)});
test('rejects legacy charts with no provenance or units', () => assert.equal(isSourceLinkedChart({type:'bar',title:'Key metrics',data:[{label:'Funding',value:50},{label:'Users',value:2}]}),false));
test('rejects mixed units and mixed metrics', () => {const b=series();b.data[1].unit='USD millions';assert.equal(isSourceLinkedChart(b),false);b.data[1].unit=b.unit;b.data[1].metric='Funding';assert.equal(isSourceLinkedChart(b),false)});
test('rejects missing, infinite, and nonnumeric values without substituting zero', () => {for(const value of [undefined,NaN,Infinity,'15']){const b=series();(b.data[1] as any).value=value;assert.equal(isSourceLinkedChart(b),false)}});
test('requires explicit coordinates for line charts', () => {const b={...series(),type:'line'};assert.equal(isSourceLinkedChart(b),false);assert.equal(isSourceLinkedChart({...b,data:b.data.map((p,i)=>({...p,x:2024+i,y:p.value}))}),true)});
test('rejects unsafe source URLs and generic axes', () => {assert.equal(isSourceLinkedChart({...series(),sourceUrl:'javascript:alert(1)'}),false);assert.equal(isSourceLinkedChart({...series(),yAxisLabel:'Reported amount'}),false)});

test('requires values to appear in an exact excerpt of the attributed source', () => {
  const b=series();const sources=[{articleUrl:b.sourceUrl,textExcerpt:'In 2024 there were 12 million trips. In 2025 there were 15 million trips.'}];
  assert.equal(chartMatchesSource(b,sources),true);
  b.data[0].value=99;assert.equal(chartMatchesSource(b,sources),false);
  b.data[0].value=12;b.data[0].sourceQuote='Invented quote: 12 million trips.';assert.equal(chartMatchesSource(b,sources),false);
  assert.equal(chartMatchesSource(series(),[{...sources[0],articleUrl:'https://other.example/report'}]),false);
});
