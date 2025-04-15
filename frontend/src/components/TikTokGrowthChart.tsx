import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush, Legend } from 'recharts';

// Data point within a single dataset
interface DataPoint {
  date: string;
  value: number | null; // Use 'value' consistently
}

// Structure for a single line/dataset on the chart
interface ChartDataSet {
  name: string;        // Name for the legend/tooltip
  data: DataPoint[];   // Array of data points for this line
  valueKey: string;    // Should always be 'value' now
  color: string;       // Line color
}

interface TikTokGrowthChartProps {
  // Accept an array of datasets
  datasets: ChartDataSet[];
}

// Helper - can be shared
const formatNumber = (num: number): string => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
};

const TikTokGrowthChart: React.FC<TikTokGrowthChartProps> = ({ datasets }) => {

  // Combine data for multi-line chart
  const { chartDisplayData, lineValueKeys } = useMemo(() => {
    const lines: Array<{ key: string; name: string; color: string }> = [];
    // Store values keyed by date, without the date property initially
    const combined: { [date: string]: { [key: string]: number | null } } = {}; 

    datasets.forEach((dataset, index) => {
      const uniqueValueKey = `value_${index}`; 
      lines.push({ key: uniqueValueKey, name: dataset.name, color: dataset.color });

      dataset.data.forEach(point => {
        if (!combined[point.date]) {
          combined[point.date] = {}; // Initialize as empty object
        }
        combined[point.date][uniqueValueKey] = point.value;
      });
    });
    
    // Convert combined map to array, add date back, and sort
    const displayData = Object.entries(combined).map(([date, values]) => ({
        date: date,
        ...values // Spread the dynamic value keys (value_0, value_1, etc.)
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    return { chartDisplayData: displayData, lineValueKeys: lines };
  }, [datasets]);

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          // Use the processed chartDisplayData
          data={chartDisplayData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" />
          <YAxis tickFormatter={(value) => formatNumber(value as number)} />
          <Tooltip
             formatter={(value: number, name: string, props) => {
                 // Find the original dataset name based on the unique key (name)
                 const lineInfo = lineValueKeys.find(l => l.key === name);
                 // Only show tooltip if value is not null/undefined
                 if (value === null || value === undefined) return null;
                 return [formatNumber(value), lineInfo?.name || name];
             }}
            contentStyle={{
              borderRadius: '12px',
              border: 'none',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
              padding: '8px 12px',
              backgroundColor: 'white'
            }}
          />
          <Legend />
          {/* Dynamically render lines */}
          {lineValueKeys.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key} // Use unique key (e.g., value_0)
              name={line.name}    // Use dataset name for Legend/Tooltip
              stroke={line.color} // Use dataset color
              strokeWidth={2}
              dot={false}
              connectNulls // Connect lines across null data points
            />
          ))}
          {/* Update Brush */}
          {chartDisplayData.length > 0 && (
             <Brush 
               dataKey="date" 
               height={30} 
               stroke={datasets[0]?.color || '#8884d8'} 
               fill={`${datasets[0]?.color || '#8884d8'}33`} 
               travellerWidth={15} 
               // Brush data should also be the processed data
               data={chartDisplayData} 
             />
           )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TikTokGrowthChart;
