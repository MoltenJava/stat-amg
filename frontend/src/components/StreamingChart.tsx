import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush } from 'recharts';

interface StreamingChartProps {
  data: Array<{ date: string; count: number }>;
  color: string;
}

const StreamingChart: React.FC<StreamingChartProps> = ({ data, color }) => {
  // Format the numbers for display
  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  // Get gradient color based on the artist's card color
  const getGradientColor = () => {
    switch (color) {
      case 'pink': return ['#FFDEE2', '#FFB1C0'];
      case 'purple': return ['#E5DEFF', '#C4B8FF'];
      case 'blue': return ['#D3E4FD', '#A1C6FF'];
      case 'green': return ['#F2FCE2', '#C5E8A5'];
      case 'yellow': return ['#FEF7CD', '#FFE895'];
      case 'peach': return ['#FDE1D3', '#FFC19E'];
      default: return ['#FFDEE2', '#FFB1C0'];
    }
  };
  
  const [lightColor, darkColor] = getGradientColor();

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={`colorStreams-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={darkColor} stopOpacity={0.8} />
              <stop offset="95%" stopColor={lightColor} stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" />
          <YAxis tickFormatter={(value) => formatNumber(value as number)} />
          <Tooltip
            formatter={(value: number) => [formatNumber(value), 'Streams']}
            contentStyle={{
              borderRadius: '12px',
              border: 'none',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
              padding: '8px 12px',
              backgroundColor: 'white'
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke={darkColor}
            fillOpacity={1}
            fill={`url(#colorStreams-${color})`}
          />
          <Brush 
            dataKey="date" 
            height={30} 
            stroke={darkColor} 
            fill={lightColor} 
            travellerWidth={15} 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default StreamingChart;
