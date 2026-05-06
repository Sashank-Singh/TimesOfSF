export interface CityVitalsData {
  temperature: number;
  weatherCode: number;
  aqi: number;
  transitStatus: {
    system: string;
    status: 'Normal' | 'Delays' | 'Disrupted';
    message?: string;
  }[];
}

export async function fetchCityVitals(): Promise<CityVitalsData | null> {
  try {
    // SF Coordinates: 37.7749, -122.4194
    
    // Fetch Weather (temperature in F and weather code)
    const weatherRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&current=temperature_2m,weather_code&temperature_unit=fahrenheit');
    if (!weatherRes.ok) throw new Error("Weather fetch failed");
    const weatherData = await weatherRes.json();
    
    // Fetch Air Quality Index (US AQI)
    const aqiRes = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=37.7749&longitude=-122.4194&current=us_aqi');
    if (!aqiRes.ok) throw new Error("AQI fetch failed");
    const aqiData = await aqiRes.json();

    // Mock Transit Data for now (Simulating a smart API response)
    const mockTransitStatus: CityVitalsData['transitStatus'] = [
      { system: 'BART', status: 'Normal' },
      { system: 'MUNI', status: 'Delays', message: 'N Judah' }
    ];

    return {
      temperature: Math.round(weatherData.current.temperature_2m),
      weatherCode: weatherData.current.weather_code,
      aqi: Math.round(aqiData.current.us_aqi),
      transitStatus: mockTransitStatus
    };
  } catch (error) {
    console.error("Failed to fetch city vitals:", error);
    return null;
  }
}

export function getWeatherDescription(code: number): { label: string, icon: string } {
  if (code === 0) return { label: "Clear", icon: "☀️" };
  if (code <= 3) return { label: "Cloudy", icon: "⛅" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "🌫️" };
  if (code >= 51 && code <= 67) return { label: "Rain", icon: "🌧️" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "❄️" };
  if (code >= 95) return { label: "Storm", icon: "⛈️" };
  return { label: "Clear", icon: "☀️" };
}

export function getAqiCategory(aqi: number): { label: string, color: string } {
  if (aqi <= 50) return { label: "Good", color: "text-green-600" };
  if (aqi <= 100) return { label: "Moderate", color: "text-yellow-600" };
  if (aqi <= 150) return { label: "Unhealthy for Sensitive", color: "text-orange-600" };
  if (aqi <= 200) return { label: "Unhealthy", color: "text-red-600" };
  return { label: "Hazardous", color: "text-purple-600" };
}
