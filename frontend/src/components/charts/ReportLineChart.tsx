import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';

interface ChartDataPoint {
    date: string; // Expecting 'YYYY-MM-DD'
    value: number | null;
}

interface ReportLineChartProps {
    data: ChartDataPoint[];
    color?: string;
    yAxisLabel?: string;
    dataKey?: string; // Allow specifying the key if data format differs slightly
    tooltipLabel?: string;
}

// Helper to format Y-axis ticks (compact notation)
const formatNumber = (num: number): string => {
    if (num === 0) return '0';
    if (Math.abs(num) < 1000) return num.toString();
    return Intl.NumberFormat('en-US', {
      notation: "compact",
      maximumFractionDigits: 1
    }).format(num);
};

// Helper to format dates for X-axis
const formatDateTick = (tick: string): string => {
    try {
        // Remove T00:00:00 addition, parse the tick directly
        return format(new Date(tick), 'MMM d');
    } catch (e) {
        return tick; // Fallback to original string if parsing fails
    }
};

const ReportLineChart: React.FC<ReportLineChartProps> = ({ 
    data, 
    color = "#3b82f6", // Default blue
    yAxisLabel = 'Value',
    dataKey = 'value', // Default key for the value
    tooltipLabel = 'Value'
}) => {
    if (!data || data.length === 0) {
        return <div className="h-full flex items-center justify-center text-muted-foreground italic">No data available for chart.</div>;
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart
                data={data}
                margin={{
                    top: 5,
                    right: 20,
                    left: 5, // Adjust left margin for Y-axis label
                    bottom: 5,
                }}
            >
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" vertical={false}/>
                <XAxis 
                    dataKey="date" 
                    tickFormatter={formatDateTick} 
                    minTickGap={20} 
                    padding={{ left: 10, right: 10 }}
                    stroke="#9ca3af" // Gray-400
                    fontSize={12}
                />
                <YAxis 
                    tickFormatter={formatNumber} 
                    allowDecimals={false} 
                    domain={['auto', 'auto']} 
                    stroke="#9ca3af" // Gray-400
                    fontSize={12}
                    width={40} // Ensure enough space for labels
                />
                <Tooltip 
                    formatter={(value: number) => [formatNumber(value), tooltipLabel]}
                    labelFormatter={(label) => { 
                        try {
                            // Attempt to parse and format the date directly
                            return format(new Date(label), 'MMM d, yyyy');
                        } catch (e) {
                            // Log the error and return a fallback string
                            console.error('[ReportLineChart Tooltip] Error formatting date label:', label, e);
                            return 'Invalid Date';
                        }
                    }}
                    contentStyle={{ 
                        borderRadius: '8px', 
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                        padding: '8px 12px', 
                        backgroundColor: 'rgba(255, 255, 255, 0.9)'
                    }}
                    labelStyle={{ fontWeight: 'bold', marginBottom: '4px', color: '#374151' }}
                    itemStyle={{ color: '#4b5563' }}
                    cursor={{ stroke: '#d1d5db', strokeWidth: 1 }}
                />
                {/* Optional: Add legend if needed later */}
                {/* <Legend /> */}
                <Line 
                    type="monotone" 
                    dataKey={dataKey} 
                    stroke={color} 
                    strokeWidth={2} 
                    dot={false} 
                    activeDot={{ r: 6, strokeWidth: 0, fill: color }} 
                    connectNulls={false} // Don't connect lines across null data points
                />
            </LineChart>
        </ResponsiveContainer>
    );
};

export default ReportLineChart; 