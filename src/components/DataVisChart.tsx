import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Label
} from "recharts";
import { motion } from "motion/react";

interface DataVisChartProps {
  title: string;
  type?: "bar" | "histogram" | "scatter" | "line" | "chart";
  xAxisLabel?: string;
  yAxisLabel?: string;
  data: { label?: string; value?: number; x?: number; y?: number }[];
}

function normalizeChartData(data: DataVisChartProps["data"]) {
  return data.map((point, index) => ({
    label: point.label ?? String(point.x ?? index + 1),
    value: point.value ?? point.y ?? 0,
    x: point.x ?? index + 1,
    y: point.y ?? point.value ?? 0,
  }));
}

function isPlaceholderAxisLabel(label?: string) {
  if (!label?.trim()) return true;
  const t = label.trim().toLowerCase();
  return ["category", "value", "label", "series", "x", "y", "axis"].includes(t);
}

function inferAxisLabels(
  title: string,
  chartType: "bar" | "histogram" | "scatter" | "line",
  data: ReturnType<typeof normalizeChartData>,
) {
  const tl = title.toLowerCase();
  let x = "Segment";
  let y = "Amount";

  if (chartType === "scatter" || chartType === "line") {
    x = tl.includes("year") || tl.includes("time") ? "Year" : tl.includes("quarter") ? "Quarter" : "Independent variable";
    y = tl.includes("%") || tl.includes("percent") ? "Share (%)" : tl.includes("fund") || tl.includes("$") ? "Funding ($M)" : "Measured value";
  } else {
    if (tl.includes("year") || tl.includes("time")) {
      x = "Year";
      y = "Level";
    } else if (tl.includes("city") || tl.includes("metro") || tl.includes("region") || tl.includes("county")) {
      x = "Region";
      y = "Reported value";
    } else if (tl.includes("company") || tl.includes("firm")) {
      x = "Company";
      y = "Metric";
    }
  }

  const labels = data.map((d) => d.label).filter((l): l is string => typeof l === "string" && !!l.trim());
  if (labels.length >= 2 && labels.every((l) => /^\d{4}$/.test(l.trim()))) {
    x = "Year";
    if (y === "Amount" || y === "Level") y = "Reported level";
  }

  return { x, y };
}

function formatTick(value: string | number) {
  if (typeof value === "number") return Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return value.length > 14 ? `${value.slice(0, 12)}...` : value;
}

export function DataVisChart({ title, type = "bar", xAxisLabel = "Category", yAxisLabel = "Value", data }: DataVisChartProps) {
  const chartType = type === "chart" ? "bar" : type;
  const normalizedData = normalizeChartData(data);
  const inferred = inferAxisLabels(title, chartType, normalizedData);
  const xResolved = isPlaceholderAxisLabel(xAxisLabel) ? inferred.x : xAxisLabel.trim();
  const yResolved = isPlaceholderAxisLabel(yAxisLabel) ? inferred.y : yAxisLabel.trim();
  const commonMargin = { top: 20, right: 24, left: 18, bottom: 48 };
  const axisTick = { fontSize: 10, fontFamily: "monospace", fill: "rgba(0,0,0,0.5)", fontWeight: "bold" };
  const tooltipStyle = {
    backgroundColor: "#000",
    border: "none",
    borderRadius: "0",
    color: "#fff",
    fontSize: "11px",
    fontFamily: "monospace",
    padding: "12px",
  };
  const xAxis = (
    <XAxis
      dataKey={chartType === "scatter" || chartType === "line" ? "x" : "label"}
      type={chartType === "scatter" || chartType === "line" ? "number" : "category"}
      axisLine={false}
      tickLine={false}
      tick={axisTick}
      tickFormatter={formatTick}
      interval={0}
      angle={chartType === "bar" || chartType === "histogram" ? -18 : 0}
      textAnchor={chartType === "bar" || chartType === "histogram" ? "end" : "middle"}
      height={60}
    >
      <Label value={xResolved} position="insideBottom" offset={-12} className="fill-ink/50 font-mono text-[10px] uppercase tracking-widest" />
    </XAxis>
  );
  const yAxis = (
    <YAxis
      dataKey={chartType === "scatter" || chartType === "line" ? "y" : "value"}
      type="number"
      axisLine={false}
      tickLine={false}
      tick={axisTick}
      tickFormatter={formatTick}
      width={54}
    >
      <Label value={yResolved} angle={-90} position="insideLeft" offset={-6} className="fill-ink/50 font-mono text-[10px] uppercase tracking-widest" />
    </YAxis>
  );

  const renderChart = () => {
    if (chartType === "scatter") {
      return (
        <ScatterChart data={normalizedData} margin={commonMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
          {xAxis}
          {yAxis}
          <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={tooltipStyle} itemStyle={{ color: "#fff", textTransform: "uppercase" }} />
          <Scatter name={title} data={normalizedData} fill="#8B0000" />
        </ScatterChart>
      );
    }

    if (chartType === "line") {
      return (
        <LineChart data={normalizedData} margin={commonMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
          {xAxis}
          {yAxis}
          <Tooltip cursor={{ stroke: "rgba(0,0,0,0.12)" }} contentStyle={tooltipStyle} itemStyle={{ color: "#fff", textTransform: "uppercase" }} />
          <Line type="monotone" dataKey="y" stroke="#8B0000" strokeWidth={3} dot={{ r: 4, fill: "#121212" }} activeDot={{ r: 6 }} />
        </LineChart>
      );
    }

    return (
      <BarChart data={normalizedData} margin={commonMargin} barCategoryGap={chartType === "histogram" ? 0 : "20%"}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.08)" />
        {xAxis}
        {yAxis}
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.03)" }} contentStyle={tooltipStyle} itemStyle={{ color: "#fff", textTransform: "uppercase" }} />
        <Bar dataKey="value" radius={chartType === "histogram" ? [0, 0, 0, 0] : [2, 2, 0, 0]} barSize={chartType === "histogram" ? undefined : 40}>
          {normalizedData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={index === normalizedData.length - 1 ? "#8B0000" : "#1a1a1a"} fillOpacity={0.9} />
          ))}
        </Bar>
      </BarChart>
    );
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      className="my-16 clear-both p-8 md:p-10 border border-accent/25 bg-paper/80 backdrop-blur-sm not-prose relative shadow-[0_18px_60px_rgba(0,0,0,0.10)]"
    >
      <div className="flex flex-col gap-1 mb-10 relative">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.4em] text-accent font-bold">Editorial Data</span>
          <span className="text-[9px] font-mono uppercase tracking-widest text-ink/35">{chartType}</span>
        </div>
        <h4 className="text-2xl font-black tracking-tighter leading-tight max-w-xl italic serif">{title}</h4>
      </div>
      
      <div className="h-80 md:h-96 w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
        
        {/* Integrated Citation Overlay in the "image" (chart area) */}
        <div className="absolute top-0 right-0 pointer-events-none opacity-20">
          <span className="text-[8px] font-mono uppercase tracking-widest vertical-text transform rotate-90 origin-top-right">
            Times Analysis Unit Ref. SF/{(Math.random() * 1000).toFixed(0)}
          </span>
        </div>
      </div>
      
      <div className="mt-12 flex items-center justify-between border-t border-ink/5 pt-6">
        <div className="flex items-center gap-4">
          <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-accent">Source:</span>
          <span className="text-[10px] font-mono text-ink/40 uppercase tracking-tighter italic">
            Consolidated Regional Reports & Primary Search Data
          </span>
        </div>
        <div className="text-[8px] font-mono text-ink/20 uppercase tracking-widest hidden sm:block">
          Figure 1.1A / Interactive Report
        </div>
      </div>
    </motion.div>
  );
}
