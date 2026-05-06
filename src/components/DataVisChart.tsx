import {
  BarChart,
  Bar,
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
  data: { label: string; value: number }[];
}

export function DataVisChart({ title, data }: DataVisChartProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      className="my-24 clear-both p-8 md:p-10 border-t-2 border-b-2 border-ink bg-ink/[0.02] not-prose relative"
    >
      <div className="flex flex-col gap-1 mb-10 relative">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.4em] text-accent font-bold">Editorial Data</span>
          <sup className="text-[10px] font-mono text-accent font-bold">(1)</sup>
        </div>
        <h4 className="text-2xl font-black tracking-tighter leading-tight max-w-xl italic serif">{title}</h4>
      </div>
      
      <div className="h-72 w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 10, left: -25, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.08)" />
            <XAxis 
              dataKey="label" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'rgba(0,0,0,0.5)', fontWeight: 'bold' }}
              dy={15}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fontFamily: 'monospace', fill: 'rgba(0,0,0,0.5)', fontWeight: 'bold' }}
            />
            <Tooltip 
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              contentStyle={{ 
                backgroundColor: '#000', 
                border: 'none', 
                borderRadius: '0',
                color: '#fff',
                fontSize: '11px',
                fontFamily: 'monospace',
                padding: '12px'
              }}
              itemStyle={{ color: '#fff', textTransform: 'uppercase' }}
            />
            <Bar dataKey="value" radius={[2, 2, 0, 0]} barSize={40}>
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={index === data.length - 1 ? '#ff3e00' : '#1a1a1a'} fillOpacity={0.9} />
              ))}
            </Bar>
          </BarChart>
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
