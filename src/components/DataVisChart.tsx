import { LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { DataBlock } from '../types';
import { isSourceLinkedChart } from '../lib/chartData';

const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value);

export function DataVisChart(props: DataBlock) {
  if (!isSourceLinkedChart(props)) return null;
  const { title, type, data, unit, sourceName, sourceUrl, xAxisLabel, yAxisLabel } = props;
  const numericX = type === 'line' || type === 'scatter';
  const rows = numericX ? [...data].sort((a, b) => a.x! - b.x!) : data;
  const axes = <>
    <CartesianGrid stroke="#dedad3" vertical={false} />
    <XAxis domain={numericX ? ["dataMin", "dataMax"] : undefined} dataKey={numericX ? 'x' : 'label'} type={numericX ? 'number' : 'category'} tick={{fontSize: 11}} axisLine={false} tickLine={false} />
    <YAxis dataKey={numericX ? "y" : "value"} domain={['auto', 'auto']} tick={{fontSize: 11}} width={65} axisLine={false} tickLine={false} />
    <Tooltip formatter={(value: number) => [`${number(value)} ${unit}`, props.metric]} />
  </>;
  return <figure className="article-data" aria-label={title}>
    <figcaption><h4>{title}</h4><p>{props.metric} · {unit}</p></figcaption>
    {numericX ? <>
      <p className="article-data-axes">{yAxisLabel} by {xAxisLabel}</p>
      <div className="article-data-plot"><ResponsiveContainer width="100%" height={240} minWidth={0}>
        {type === 'scatter' ? <ScatterChart margin={{top: 10, right: 20, bottom: 10, left: 5}}>{axes}<Scatter data={rows} fill="#8b0000" isAnimationActive={false}/></ScatterChart>
          : <LineChart data={rows} margin={{top: 10, right: 20, bottom: 10, left: 5}}>{axes}<Line dataKey="y" type="linear" stroke="#8b0000" strokeWidth={2} dot={{r: 3}} isAnimationActive={false}/></LineChart>}
      </ResponsiveContainer></div>
    </> : <div className="article-data-bars">
      {rows.map((point, i) => {
        const max = Math.max(...rows.map(p => Math.abs(p.value!)));
        return <div className="article-data-row" key={`${point.label}-${i}`}>
          <div><span>{point.label}</span><strong>{number(point.value!)} <small>{unit}</small></strong></div>
          {/* Negative values use a table-only presentation to avoid a misleading positive bar. */}
          {rows.every(p => p.value! >= 0) && <div className="article-data-track" aria-hidden="true"><span style={{width: `${max ? point.value! / max * 100 : 0}%`}} /></div>}
        </div>;
      })}
    </div>}
    {numericX && <details className="article-data-values"><summary>View exact values</summary><table><thead><tr><th scope="col">Observation</th><th scope="col">{xAxisLabel}</th><th scope="col">{yAxisLabel}</th></tr></thead><tbody>{rows.map((p,i)=><tr key={i}><th scope="row">{p.label}</th><td>{number(p.x!)}</td><td>{number(p.y!)} {unit}</td></tr>)}</tbody></table></details>}
    <details className="article-data-values"><summary>Source excerpts</summary><ul>{rows.map((point, i) => <li key={i}><strong>{point.label}</strong>: <q>{point.sourceQuote}</q></li>)}</ul></details>
    <p className="article-data-source">Source: <a href={sourceUrl} target="_blank" rel="noreferrer">{sourceName} ↗</a></p>
  </figure>;
}
