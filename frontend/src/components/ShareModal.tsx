import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog"; // Assuming shadcn Dialog
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { Artist } from '../pages/Index'; 

// Re-use types and fetch functions (could be moved to a shared api file)
// --- Types ---
interface TimeSeriesDatapoint {
  DATE: string; 
  VALUE: number;
}
interface UgcTimeSeriesDatapoint {
  date: string; 
  value: number; 
}

// --- Fetching Functions (Assume these exist or are imported) ---
declare function fetchStreamingTimeSeries(artistId: number, region: 'US' | 'GLOBAL', months: number): Promise<TimeSeriesDatapoint[]>;
declare function fetchUgcTimeSeries(artistId: number, months: number): Promise<UgcTimeSeriesDatapoint[]>;

// --- Props ---
interface ShareModalProps {
  artist: Artist | null;
  timeFrameMonths: number; // Receive timeframe from parent
  isOpen: boolean;
  onClose: () => void;
}

// --- Normalization Helper ---
interface NormalizedDataPoint {
  date: string;
  normalizedValue: number | null; // Value between 0 and 1
}

const normalizeData = (data: Array<{ date: string; value: number }>): NormalizedDataPoint[] => {
  if (!data || data.length === 0) return [];

  let minVal = Infinity;
  let maxVal = -Infinity;
  data.forEach(d => {
    if (d.value !== null) {
      minVal = Math.min(minVal, d.value);
      maxVal = Math.max(maxVal, d.value);
    }
  });

  if (minVal === Infinity || maxVal === -Infinity || maxVal === minVal) {
    // Handle cases with no data, single point, or all points having the same value
    return data.map(d => ({ date: d.date, normalizedValue: d.value !== null ? 0.5 : null })); // Assign a neutral value like 0.5
  }

  const range = maxVal - minVal;
  return data.map(d => ({
    date: d.date,
    normalizedValue: d.value !== null ? (d.value - minVal) / range : null,
  }));
};

// --- Component ---
const ShareModal: React.FC<ShareModalProps> = ({ artist, timeFrameMonths, isOpen, onClose }) => {
  
  // --- Moved Hooks Before Early Return ---
  const artistId = artist?.ID; // Use optional chaining

  // Fetch data - Queries run only when modal is open and artistId is valid
  const { data: streamingData, isLoading: isLoadingStreaming } = useQuery<TimeSeriesDatapoint[], Error>({
    queryKey: ['streamingTimeSeries', artistId, 'US', timeFrameMonths], 
    queryFn: () => fetchStreamingTimeSeries(artistId!, 'US', timeFrameMonths), // Use non-null assertion or handle null case
    enabled: isOpen && !!artistId, 
  });

  const { data: ugcData, isLoading: isLoadingUgc } = useQuery<UgcTimeSeriesDatapoint[], Error>({
    queryKey: ['ugcTimeSeries', artistId, timeFrameMonths], 
    queryFn: () => fetchUgcTimeSeries(artistId!, timeFrameMonths), // Use non-null assertion or handle null case
    enabled: isOpen && !!artistId, 
  });

  // Normalize data using useMemo to avoid re-calculation on every render
  // Map streaming data keys before normalizing
  const normalizedStreamingData = useMemo(() => normalizeData(streamingData?.map(d => ({ date: d.DATE, value: d.VALUE })) || []), [streamingData]);
  const normalizedUgcData = useMemo(() => normalizeData(ugcData || []), [ugcData]);

  // Combine data for charting - assumes dates align or Recharts handles gaps
  const combinedData = useMemo(() => {
    const map = new Map<string, { date: string; streams?: number | null; posts?: number | null }>();
    normalizedStreamingData.forEach(d => map.set(d.date, { ...map.get(d.date), date: d.date, streams: d.normalizedValue }));
    normalizedUgcData.forEach(d => map.set(d.date, { ...map.get(d.date), date: d.date, posts: d.normalizedValue }));
    // Sort by date
    return Array.from(map.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [normalizedStreamingData, normalizedUgcData]);

  const isLoading = isLoadingStreaming || isLoadingUgc;
  // --- End of Moved Hooks ---

  // Early return can happen after hooks
  if (!artist) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl bg-white/90 backdrop-blur-sm">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-2xl flex items-center gap-3">
             <img src={artist.IMAGE_URL_LARGE || 'placeholder.jpg'} alt={artist.NAME || ''} className="h-10 w-10 rounded-full"/>
             {artist.NAME} - Normalized Trends ({timeFrameMonths}M)
          </DialogTitle>
           <DialogClose asChild>
              <Button variant="ghost" size="icon" className="absolute top-4 right-4">
                <X className="h-4 w-4" />
              </Button>
          </DialogClose>
        </DialogHeader>
        
        <div className="h-80 w-full">
          {isLoading && <p className="text-center p-10">Loading chart data...</p>}
          {!isLoading && combinedData.length > 0 && (
             <ResponsiveContainer width="100%" height="100%">
               <ComposedChart data={combinedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                 <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                 <XAxis dataKey="date" />
                 <YAxis domain={[0, 1]} /> {/* Normalized Y-axis */} 
                 <Tooltip 
                    formatter={(value: number, name: string) => [
                         `${(value * 100).toFixed(1)}%`, // Show normalized value as % of range
                         name === 'streams' ? 'Streaming Trend' : 'TikTok Post Trend'
                    ]}
                  />
                 <Legend />
                 <Line 
                    type="monotone" 
                    dataKey="streams" 
                    name="Streaming Trend" 
                    stroke="#3b82f6" // Blue
                    strokeWidth={2}
                    dot={false}
                  />
                 <Line 
                    type="monotone" 
                    dataKey="posts" 
                    name="TikTok Post Trend" 
                    stroke="#8b5cf6" // Purple
                    strokeWidth={2}
                    dot={false}
                  />
               </ComposedChart>
             </ResponsiveContainer>
          )}
           {!isLoading && combinedData.length === 0 && (
               <p className="text-center p-10 text-muted-foreground">No data available for this period.</p>
           )}
        </div>
        {/* Add actual sharing buttons here (e.g., copy image, share link) later */}
         <div className="mt-4 text-right">
             <Button variant="outline" onClick={onClose}>Close</Button>
         </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShareModal; 