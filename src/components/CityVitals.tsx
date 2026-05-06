import { useEffect, useState } from 'react';
import { fetchCityVitals, CityVitalsData, getWeatherDescription, getAqiCategory } from '../services/vitalsService';
import { Cloud, Wind, Train } from 'lucide-react';

export function CityVitals() {
  const [data, setData] = useState<CityVitalsData | null>(null);

  useEffect(() => {
    let mounted = true;
    // Fetch vitals once on mount
    fetchCityVitals().then(res => {
      if (mounted && res) setData(res);
    });
    
    // Optional: Refresh every 5 minutes
    const interval = setInterval(() => {
      fetchCityVitals().then(res => {
        if (mounted && res) setData(res);
      });
    }, 5 * 60 * 1000);

    return () => { 
      mounted = false; 
      clearInterval(interval);
    };
  }, []);

  if (!data) return null;

  const weather = getWeatherDescription(data.weatherCode);
  const aqiCategory = getAqiCategory(data.aqi);

  return (
    <div className="w-full bg-ink text-paper py-2 px-4 overflow-hidden text-[10px] md:text-[11px] font-mono uppercase tracking-widest flex items-center border-b-[4px] border-accent z-50">
      <div className="max-w-7xl mx-auto w-full flex items-center justify-start md:justify-center gap-8 md:gap-16 overflow-x-auto no-scrollbar whitespace-nowrap">
        
        {/* Weather */}
        <div className="flex items-center gap-2 shrink-0">
          <Cloud size={14} className="opacity-60" />
          <span>SF: {data.temperature}°F <span className="opacity-60 ml-1">{weather.label}</span></span>
        </div>

        {/* AQI */}
        <div className="flex items-center gap-2 shrink-0">
          <Wind size={14} className="opacity-60" />
          <span>AQI: {data.aqi} <span className="opacity-60 ml-1">({aqiCategory.label})</span></span>
        </div>

        {/* Transit Alerts */}
        <div className="flex items-center gap-6 shrink-0">
          {data.transitStatus.map(transit => (
            <div key={transit.system} className="flex items-center gap-2">
              <Train size={14} className="opacity-60" />
              <span>
                {transit.system}:
                <span className={transit.status === 'Normal' ? 'text-green-400 ml-1' : 'text-accent ml-1 font-bold'}>
                  {transit.status}
                </span>
                {transit.message && <span className="opacity-60 lowercase ml-1">- {transit.message}</span>}
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
