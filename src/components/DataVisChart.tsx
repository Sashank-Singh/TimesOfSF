import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from "recharts";
import { motion } from "motion/react";

interface DataVisChartProps {
  title: string;
  data: { label: string; value: number }[];
}

export function DataVisChart({ title, data }: DataVisChartProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      className="my-20 clear-both p-6 md:p-8 border border-ink/10 bg-ink/[0.01] rounded-2xl"
    >
      <div className="flex flex-col gap-1 mb-8">
        <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-accent font-bold">Data Insight</span>
        <h4 className="text-lg font-black tracking-tight">{title}</h4>
      </div>
      
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
            <XAxis 
              dataKey="label" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'rgba(0,0,0,0.4)' }}
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'rgba(0,0,0,0.4)' }}
            />
            <Tooltip 
              cursor={{ fill: 'rgba(0,0,0,0.02)' }}
              contentStyle={{ 
                backgroundColor: '#000', 
                border: 'none', 
                borderRadius: '8px',
                color: '#fff',
                fontSize: '12px',
                fontFamily: 'monospace'
              }}
              itemStyle={{ color: '#fff' }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={index === data.length - 1 ? '#ff3e00' : '#1a1a1a'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-4 text-[10px] font-mono text-ink/30 uppercase tracking-wider text-center italic">
        Source: Times of SF Internal Data Engine
      </p>
    </motion.div>
  );
}
