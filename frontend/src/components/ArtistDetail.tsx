import React, { useState, useMemo, useCallback } from 'react';
import { X, Music, TrendingUp, Users, Link2, Trash2, PlusCircle, Zap } from 'lucide-react'; // Changed BrainCircuit to Zap
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, subMonths } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import StreamingChart from './StreamingChart.tsx'; // Assuming this path is correct
import { ChartContainer as UgcChart } from './ui/chart'; // Assuming this path is correct
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getApiUrl } from '@/lib/apiUtils'; // Import the utility

// Define Artist type locally (matching the prop structure from Index.tsx)
interface Artist {
    ID: number;
    NAME: string | null;
    IMAGE_URL_LARGE: string | null;
    SPOTIFY_ARTIST_ID?: string | null;
    NUMERIC_ACCOUNT_ID?: number | null;
    CREATED_AT?: string | Date | null;
    UPDATED_AT?: string | Date | null;
    US_METRICS_THIS_WEEK?: number | null;
    US_METRICS_PERCENT_CHANGE?: number | null;
    LATEST_UGC_POST_COUNT?: number | null;
    LATEST_UGC_PERCENT_CHANGE?: number | null;
}

// --- Types for Fetched Data ---
// Interface for UGC data
interface UgcTimeSeriesDatapoint {
  date: string;
  value: number;
}

// Interface for data from /ugc-links endpoint
interface ArtistUgcLink {
    ID: number;
    ARTIST_CARD_ID: number;
    TIKTOK_SOUND_ID: number; // Internal Numeric ID
    TIKTOK_SOUND_NAME: string | null;
    UNIFIED_SONG_ID: number | null;
}

// Interface for data from /ugc-timeseries/details endpoint
interface DetailedUgcData {
    [key: string]: Array<{ date: string; value: number | null }>;
}

// Type for Song Info
interface ArtistSongInfo {
    unifiedSongId: number;
    spotifyTrackId: number;
    name: string | null;
}

// Type for Raw API response for daily streams
interface RawDailySongStreamData {
  metricDate: string; // Comes as YYYY-MM-DD string
  usStreams: number;
  unifiedSongId: number;
  songName?: string | null; // Optional, if backend sends it
}

// Type for New Combined Daily Stream Data
interface DailySongStreamData {
  metricDate: Date;
  usStreams: number;
  unifiedSongId: number;
  songName: string | null;
}

// --- ADD Type for Reactivity API Response ---
interface ReactivityResult {
  correlation: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'N/A';
}
// --- End Added Type ---

// --- Props ---
interface ArtistDetailProps {
  artist: Artist; // Receives the base Artist data initially
  onClose: () => void;
}

// --- API Fetching Functions ---
const getIsoDateRange = (monthsAgo: number): { startDate: string; endDate: string } => {
  const endDate = new Date();
  const startDate = subMonths(endDate, monthsAgo);
  return {
    startDate: format(startDate, 'yyyy-MM-dd'),
    endDate: format(endDate, 'yyyy-MM-dd'),
  };
};

const fetchUgcLinks = async (artistId: number, unifiedSongId?: number | null): Promise<ArtistUgcLink[]> => {
  let url = getApiUrl(`/api/artist-cards/${artistId}/ugc-links`);
  if (typeof unifiedSongId === 'number' && !isNaN(unifiedSongId)) {
    url += `?unifiedSongId=${unifiedSongId}`;
    console.log(`[fetchUgcLinks] Fetching links for song ${unifiedSongId}`);
  } else {
    console.log(`[fetchUgcLinks] Fetching all links for artist ${artistId}`);
  }
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Failed to fetch UGC links. Status: ${response.status}, URL: ${url}`);
    throw new Error('Failed to fetch UGC links');
  }
  return response.json();
};

const fetchDetailedUgcTimeSeries = async (artistId: number, months: number): Promise<DetailedUgcData> => {
  const { startDate, endDate } = getIsoDateRange(months);
  const url = getApiUrl(`/api/artist-cards/${artistId}/ugc-timeseries/details?startDate=${startDate}&endDate=${endDate}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch detailed UGC timeseries');
  const rawData = await response.json();
  return rawData?.soundTimeSeries || {};
};

const fetchArtistSongs = async (artistId: number): Promise<ArtistSongInfo[]> => {
    const url = getApiUrl(`/api/artist-cards/${artistId}/songs`);
    const response = await fetch(url);
    if (!response.ok) {
        console.error(`Failed to fetch songs for artist ${artistId}. Status: ${response.status}`);
        throw new Error('Failed to fetch artist songs');
    }
    const data = await response.json() as ArtistSongInfo[];
    console.log(`[fetchArtistSongs] Fetched ${data.length} songs for artist ${artistId}:`, data);
    return data;
};

const fetchCombinedDailyStreams = async (artistId: number, months: number, unifiedSongId?: number | 'all'): Promise<DailySongStreamData[]> => {
  console.log(`[fetchCombinedDailyStreams START] Fetching for Artist: ${artistId}, Song: ${unifiedSongId}`);
  console.time(`[fetchCombinedDailyStreams TIME] Artist: ${artistId}, Song: ${unifiedSongId}`);
  const daysLookback = months * 30;
  let url = getApiUrl(`/api/artist-cards/${artistId}/daily-streams?daysLookback=${daysLookback}`);
  if (typeof unifiedSongId === 'number') {
      url += `&unifiedSongId=${unifiedSongId}`;
  }

  const response = await fetch(url);
  console.timeEnd(`[fetchCombinedDailyStreams TIME] Artist: ${artistId}, Song: ${unifiedSongId}`);
  if (!response.ok) {
    console.error(`Failed to fetch combined daily streams for artist ${artistId}${typeof unifiedSongId === 'number' ? ` (song ${unifiedSongId})` : ''}. Status: ${response.status}`);
    throw new Error('Failed to fetch combined daily streams');
  }
  const rawData = await response.json() as RawDailySongStreamData[];
  console.log(`[fetchCombinedDailyStreams END] Fetched ${rawData.length} daily stream records for artist ${artistId}${typeof unifiedSongId === 'number' ? ` (song ${unifiedSongId})` : ''}.`, rawData);

  return rawData.map(d => {
    let metricDate: Date;
    try {
      metricDate = new Date(d.metricDate.includes('T') ? d.metricDate : `${d.metricDate}T00:00:00.000Z`);
      if (isNaN(metricDate.getTime())) {
        console.warn(`Invalid date value: ${d.metricDate}, using current date as fallback`);
        metricDate = new Date();
      }
    } catch (error) {
      console.error(`Error parsing date: ${d.metricDate}`, error);
      metricDate = new Date();
    }
    return {
      unifiedSongId: d.unifiedSongId,
      metricDate: metricDate,
      usStreams: d.usStreams,
      songName: d.songName || null
    };
  }) as DailySongStreamData[];
};

const deleteUgcLinkApi = async (linkId: number): Promise<void> => {
    console.log(`[deleteUgcLinkApi] Deleting link ID: ${linkId}`);
    const url = getApiUrl(`/api/artist-cards/0/ugc-links/${linkId}`);
    const response = await fetch(url, { // Artist ID is ignored in backend for this route
        method: 'DELETE',
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`[deleteUgcLinkApi] Failed for ID ${linkId}. Status: ${response.status}`, errorData);
        throw new Error(errorData.error || `Failed to delete UGC link ${linkId}`);
    }
    console.log(`[deleteUgcLinkApi] Successfully deleted link ID: ${linkId}`);
};

// --- ADD Fetch Function for Song Reactivity (Corrected URL) ---
const fetchSongReactivity = async (
    artistId: number,
    unifiedSongId: number,
    months: number
): Promise<ReactivityResult> => {
    const { startDate, endDate } = getIsoDateRange(months);
    const region = 'US'; // Default to US for now, could be made dynamic
    // CORRECTED URL AGAIN: Include artistId in the path as well
    const url = getApiUrl(`/api/artist-cards/${artistId}/songs/${unifiedSongId}/reactivity?artistId=${artistId}&region=${region}&startDate=${startDate}&endDate=${endDate}`);
    console.log(`[fetchSongReactivity] Fetching reactivity for Song: ${unifiedSongId}, Artist: ${artistId}, Dates: ${startDate} to ${endDate}, URL: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        console.error(`Failed to fetch song reactivity. Status: ${response.status}, URL: ${url}`);
        return { correlation: null, grade: 'N/A' };
    }
    const data = await response.json() as ReactivityResult;
    console.log(`[fetchSongReactivity] Received reactivity:`, data);
    return data;
};
// --- End Added Fetch Function ---

// --- Component ---
const ArtistDetail: React.FC<ArtistDetailProps> = ({ artist, onClose }) => {
  const queryClient = useQueryClient();
  const { ID, NAME, IMAGE_URL_LARGE } = artist;

  const [timeFrameMonths, setTimeFrameMonths] = useState<number>(1);
  const [selectedSoundId, setSelectedSoundId] = useState<string>('all');
  const [selectedSongUnifiedId, setSelectedSongUnifiedId] = useState<number | 'all'>('all');
  const [showAddLinkDialog, setShowAddLinkDialog] = useState(false);
  const [newTikTokUrl, setNewTikTokUrl] = useState('');

  // Helper Functions
  const formatNumber = (num: number | null | undefined): string => {
    if (num === null || num === undefined) return 'N/A';
    return Intl.NumberFormat('en-US', {
      notation: "compact",
      maximumFractionDigits: 1
    }).format(num);
  };

  const formatPercent = (num: number | null | undefined): string => {
    if (num === null || num === undefined) return 'N/A';
    if (num === Infinity) return '+∞%';
    if (num === -Infinity) return '-∞%';
    return `${(num).toFixed(1)}%`;
  };

  // --- React Query Hooks ---
  const {
      data: songDailyStreamsData,
      isLoading: isLoadingSongStreams,
      error: errorSongStreams,
  } = useQuery<DailySongStreamData[], Error>({
      queryKey: ['songDailyStreams', ID, selectedSongUnifiedId],
      queryFn: () => {
        if (typeof selectedSongUnifiedId !== 'number') {
          return Promise.resolve([]);
        }
        console.log(`[useQuery queryFn START] Triggered for songDailyStreams. Song: ${selectedSongUnifiedId}`);
        return fetchCombinedDailyStreams(ID, 1, selectedSongUnifiedId); // Fetch 1 month initially for stats
      },
      enabled: typeof selectedSongUnifiedId === 'number',
      staleTime: 5 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
  });

  const {
      data: ugcLinks,
      isLoading: isLoadingLinks,
      error: errorUgcLinks
  } = useQuery<ArtistUgcLink[], Error>({
      queryKey: ['ugcLinks', ID, selectedSongUnifiedId],
      queryFn: () => fetchUgcLinks(ID, selectedSongUnifiedId === 'all' ? null : selectedSongUnifiedId),
      enabled: !!ID,
      staleTime: 60000,
  });

  const { data: detailedUgcData, isLoading: isLoadingUgcDetails, error: errorUgcDetails } = useQuery<DetailedUgcData, Error>({
      queryKey: ['detailedUgcTimeSeries', ID, timeFrameMonths],
      queryFn: () => fetchDetailedUgcTimeSeries(ID, timeFrameMonths),
      enabled: !!ID,
  });

  const { data: artistSongs, isLoading: isLoadingSongs, error: errorLoadingSongs } = useQuery<ArtistSongInfo[], Error>({
      queryKey: ['artistSongs', ID],
      queryFn: () => fetchArtistSongs(ID),
      enabled: !!ID,
      staleTime: Infinity,
  });

  // --- ADD useQuery Hook for Song Reactivity ---
  const {
      data: songReactivityData,
      isLoading: isLoadingReactivity,
      error: errorReactivity
  } = useQuery<ReactivityResult, Error>({
      queryKey: ['songReactivity', ID, selectedSongUnifiedId, timeFrameMonths],
      queryFn: () => {
          if (typeof selectedSongUnifiedId !== 'number') {
              // Should not be called if not enabled, but defensive check
              return Promise.resolve({ correlation: null, grade: 'N/A' as const });
          }
          return fetchSongReactivity(ID, selectedSongUnifiedId, timeFrameMonths);
      },
      enabled: !!ID && typeof selectedSongUnifiedId === 'number' && timeFrameMonths > 0, // Only fetch when a song is selected and artist ID/timeframe known
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
      refetchOnWindowFocus: false,
  });

  // Handle potential error from reactivity query
  if (errorReactivity) {
      console.error("[ArtistDetail] Error fetching song reactivity:", errorReactivity);
      // Optionally display an error message to the user
  }
  // --- End Added useQuery Hook ---

  // --- Mutations ---
  const addLinkMutation = useMutation({
      mutationFn: async (data: { artistCardId: number; tiktokSoundUrl: string; unifiedSongId: number | null }) => {
          const url = getApiUrl(`/api/artist-cards/${data.artistCardId}/ugc-links`);
          const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  tiktokSoundUrl: data.tiktokSoundUrl,
                  unifiedSongId: data.unifiedSongId
              }),
          });
          if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || 'Failed to add link');
          }
          return response.json();
      },
      onSuccess: () => {
          console.log("[addLinkMutation] Success. Invalidating ugcLinks and detailedUgcTimeSeries queries.");
          queryClient.invalidateQueries({ queryKey: ['ugcLinks', ID] });
          queryClient.invalidateQueries({ queryKey: ['detailedUgcTimeSeries', ID] });
          setNewTikTokUrl('');
          setShowAddLinkDialog(false);
      },
      onError: (err: Error) => {
          console.error("[addLinkMutation] Error:", err);
          alert(`Error adding link: ${err.message}`);
      },
  });

  const deleteLinkMutation = useMutation({
      mutationFn: deleteUgcLinkApi,
      onSuccess: () => {
          console.log("[deleteLinkMutation] Success. Invalidating queries.");
          queryClient.invalidateQueries({ queryKey: ['ugcLinks', ID] });
          queryClient.invalidateQueries({ queryKey: ['detailedUgcTimeSeries', ID] });
      },
      onError: (err: Error) => {
          console.error("[deleteLinkMutation] Error:", err);
          alert(`Failed to delete link: ${err.message}`);
      },
  });

  // --- Event Handlers ---
  const handleAddLinkSubmit = (event: React.FormEvent) => {
      event.preventDefault();
      if (!newTikTokUrl.trim()) return;
      console.log(`[handleAddLinkSubmit] Adding URL: ${newTikTokUrl} for Artist: ${ID}, Song: ${selectedSongUnifiedId}`);
      addLinkMutation.mutate({
          artistCardId: ID,
          tiktokSoundUrl: newTikTokUrl,
          unifiedSongId: selectedSongUnifiedId === 'all' ? null : selectedSongUnifiedId
      });
  };

  const handleDeleteUgcLink = (e: React.MouseEvent, link: ArtistUgcLink) => {
      e.stopPropagation();
      if (window.confirm(`Are you sure you want to remove the link for "${link.TIKTOK_SOUND_NAME || 'this sound'}"?`)) {
          console.log(`[handleDeleteUgcLink] Triggering delete mutation for Link ID: ${link.ID}`);
          deleteLinkMutation.mutate(link.ID);
      }
  };

  // --- Derived State & Memos ---
  const isLoading = isLoadingSongStreams || isLoadingLinks || isLoadingUgcDetails || isLoadingSongs;
  const hasError = errorSongStreams || errorUgcLinks || errorUgcDetails || errorLoadingSongs;

  const linkedSongMap = useMemo(() => {
      const map = new Map<number, string>();
      artistSongs?.forEach(song => {
          if (song.name) {
              map.set(song.unifiedSongId, song.name);
          }
      });
      return map;
  }, [artistSongs]);

  const streamingChartDataSets = useMemo(() => {
    if (!songDailyStreamsData?.length) return [];
    const dataBySong = new Map<number, { dates: string[]; streams: number[] }>();

    songDailyStreamsData.forEach(d => {
      if (!dataBySong.has(d.unifiedSongId)) {
        dataBySong.set(d.unifiedSongId, { dates: [], streams: [] });
      }
      const songData = dataBySong.get(d.unifiedSongId)!;
      try {
        const dateObj = d.metricDate instanceof Date ? d.metricDate : new Date(d.metricDate);
        if (isNaN(dateObj.getTime())) {
          songData.dates.push(format(new Date(), 'yyyy-MM-dd'));
        } else {
          songData.dates.push(format(dateObj, 'yyyy-MM-dd'));
        }
      } catch (error) {
        songData.dates.push(format(new Date(), 'yyyy-MM-dd'));
      }
      songData.streams.push(d.usStreams);
    });

    return Array.from(dataBySong.entries()).map(([songId, data], index) => {
      const sortedIndices = data.dates.map((_, i) => i).sort((a, b) => {
        const dateA = new Date(data.dates[a]); const dateB = new Date(data.dates[b]);
        return dateA.getTime() - dateB.getTime();
      });
      const sortedDates = sortedIndices.map(i => data.dates[i]);
      const sortedStreams = sortedIndices.map(i => data.streams[i]);
      const colors = ['#34d399', '#3b82f6', '#f97316', '#ef4444', '#a855f7', '#ec4899'];
      const color = colors[index % colors.length];
      return {
        songId, name: songDailyStreamsData.find(d => d.unifiedSongId === songId)?.songName || `Song ID: ${songId}`,
        data: sortedDates.map((date, i) => ({ date, count: sortedStreams[i] })),
        color, valueKey: 'count'
      };
    });
  }, [songDailyStreamsData]);

  const processedUgcData = useMemo(() => {
    if (!detailedUgcData || !ugcLinks) return [];
    const datasets: Array<{ name: string; data: Array<{ date: string; value: number | null }>; valueKey: string, color: string }> = [];
    const relevantSoundIds = ugcLinks.map(link => link.TIKTOK_SOUND_ID.toString());

    if (relevantSoundIds.length === 0) { return []; } // No links for this selection

    if (selectedSoundId === 'all') {
        const summedData: { [date: string]: number } = {};
        relevantSoundIds.forEach(soundId => {
            const soundData = detailedUgcData[soundId] || [];
            soundData.forEach(point => {
                if (point.value !== null) {
                    summedData[point.date] = (summedData[point.date] || 0) + point.value;
                }
            });
        });
        const formattedSumData = Object.entries(summedData)
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        if (formattedSumData.length > 0) {
            datasets.push({ name: 'All Sounds', data: formattedSumData, valueKey: 'value', color: '#8b5cf6' });
        }
    } else {
        const link = ugcLinks.find(l => l.TIKTOK_SOUND_ID.toString() === selectedSoundId);
        const soundData = detailedUgcData[selectedSoundId] || [];
        if (link && soundData.length > 0) {
            datasets.push({
                name: link.TIKTOK_SOUND_NAME || `Sound ${selectedSoundId}`,
                data: soundData.map(d => ({ date: d.date, value: d.value })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
                valueKey: 'value',
                color: '#ec4899'
            });
        }
    }
    return datasets;
  }, [detailedUgcData, ugcLinks, selectedSoundId]);

  const streamingStats = useMemo(() => {
    if (selectedSongUnifiedId === 'all') {
      return { latestValue: artist.US_METRICS_THIS_WEEK, percentChange: artist.US_METRICS_PERCENT_CHANGE, label: "US Streams (Week - Artist Total)" };
    } else if (songDailyStreamsData && songDailyStreamsData.length > 0) {
      const sortedData = [...songDailyStreamsData].sort((a, b) => a.metricDate.getTime() - b.metricDate.getTime());
      const latestDataPoint = sortedData[sortedData.length - 1];
      if (!latestDataPoint) return { latestValue: null, percentChange: null, label: "US Streams (Weekly - Song)" };

      const latestDate = latestDataPoint.metricDate;
      const latestWeekEndDate = new Date(latestDate); latestWeekEndDate.setUTCHours(0, 0, 0, 0);
      const latestWeekStartDate = new Date(latestWeekEndDate); latestWeekStartDate.setUTCDate(latestWeekEndDate.getUTCDate() - 6);

      const previousWeekEndDate = new Date(latestWeekStartDate); previousWeekEndDate.setUTCDate(latestWeekStartDate.getUTCDate() - 1);
      const previousWeekStartDate = new Date(previousWeekEndDate); previousWeekStartDate.setUTCDate(previousWeekEndDate.getUTCDate() - 6);

      let latestWeekSum = 0; let latestWeekDaysCount = 0;
      sortedData.forEach(d => {
        const pointDate = d.metricDate instanceof Date ? d.metricDate : new Date(d.metricDate);
        if (pointDate >= latestWeekStartDate && pointDate <= latestWeekEndDate && d.usStreams !== null) {
          latestWeekSum += d.usStreams; latestWeekDaysCount++;
        }
      });

      let previousWeekSum = 0; let previousWeekDaysCount = 0;
      sortedData.forEach(d => {
         const pointDate = d.metricDate instanceof Date ? d.metricDate : new Date(d.metricDate);
        if (pointDate >= previousWeekStartDate && pointDate <= previousWeekEndDate && d.usStreams !== null) {
          previousWeekSum += d.usStreams; previousWeekDaysCount++;
        }
      });

      let percentChange: number | null = null;
      if (previousWeekSum !== 0) {
          percentChange = ((latestWeekSum - previousWeekSum) / previousWeekSum) * 100;
      } else if (latestWeekSum > 0) {
          percentChange = Infinity;
      } else {
          percentChange = 0;
      }

      const songName = artistSongs?.find(s => s.unifiedSongId === selectedSongUnifiedId)?.name || `Song ID: ${selectedSongUnifiedId}`;
      return { latestValue: latestWeekSum, percentChange: percentChange, label: `US Streams (${songName} - Weekly)` };
    } else {
        const songName = artistSongs?.find(s => s.unifiedSongId === selectedSongUnifiedId)?.name || `Song ID: ${selectedSongUnifiedId}`;
        return { latestValue: null, percentChange: null, label: `US Streams (${songName} - Weekly)` };
    }
  }, [selectedSongUnifiedId, songDailyStreamsData, artist, artistSongs]);

  const tiktokStats = useMemo(() => {
    if (!ugcLinks || !detailedUgcData) return { latestValue: null, percentChange: null, label: "TikTok Posts (Daily)" };

    const relevantSoundIds = selectedSongUnifiedId === 'all'
      ? ugcLinks.map(link => link.TIKTOK_SOUND_ID.toString())
      : ugcLinks.filter(link => link.UNIFIED_SONG_ID === selectedSongUnifiedId).map(link => link.TIKTOK_SOUND_ID.toString());

    let labelBase = "TikTok Posts";
    if (selectedSongUnifiedId === 'all') {
        labelBase += " (Daily - All Linked)";
    } else {
        const songName = artistSongs?.find(s => s.unifiedSongId === selectedSongUnifiedId)?.name;
        labelBase = songName ? `TikTok Posts (${songName} - Daily)` : `TikTok Posts (Song ID: ${selectedSongUnifiedId} - Daily)`;
    }

    if (relevantSoundIds.length === 0) return { latestValue: null, percentChange: null, label: labelBase };

    const summedDailyData: { [date: string]: number } = {};
    relevantSoundIds.forEach(soundId => {
        const soundData = detailedUgcData[soundId] || [];
        soundData.forEach(point => { if (point.value !== null) { summedDailyData[point.date] = (summedDailyData[point.date] || 0) + point.value; } });
    });
    const sortedSummedData = Object.entries(summedDailyData)
      .map(([date, value]) => ({ date: new Date(date + 'T00:00:00'), value }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (sortedSummedData.length === 0) return { latestValue: null, percentChange: null, label: labelBase };

    let latestValue: number | null = null;
    let latestDateObj: Date | null = null;
    for (let i = sortedSummedData.length - 1; i >= 0; i--) {
        if (sortedSummedData[i].value !== null) {
            latestValue = sortedSummedData[i].value;
            latestDateObj = sortedSummedData[i].date;
            break;
        }
    }

    let previousValue: number | null = null;
     if (latestDateObj && latestValue !== null) {
         const sevenDaysPriorTarget = latestDateObj.getTime() - (7 * 24 * 60 * 60 * 1000);
         let closestPriorDataPoint: { date: Date; value: number } | null = null;

         for (let i = sortedSummedData.length - 1; i >= 0; i--) {
             if (sortedSummedData[i].value !== null) {
                  const currentDate = sortedSummedData[i].date;
                  const timeDiff = latestDateObj.getTime() - currentDate.getTime();
                  if (timeDiff >= (6.5 * 24 * 60 * 60 * 1000)) {
                       if (!closestPriorDataPoint || Math.abs(currentDate.getTime() - sevenDaysPriorTarget) < Math.abs(closestPriorDataPoint.date.getTime() - sevenDaysPriorTarget)) {
                            closestPriorDataPoint = sortedSummedData[i];
                       }
                  }
             }
         }
         previousValue = closestPriorDataPoint?.value ?? null;
     }

    let percentChange: number | null = null;
    if (latestValue !== null && previousValue !== null && previousValue !== 0) {
        percentChange = ((latestValue - previousValue) / previousValue) * 100;
    } else if (latestValue !== null && latestValue > 0 && (previousValue === null || previousValue === 0)) {
        percentChange = Infinity;
    } else if (latestValue === 0 && previousValue === 0) {
        percentChange = 0;
    }

    return { latestValue, percentChange, label: labelBase };
  }, [selectedSongUnifiedId, ugcLinks, detailedUgcData, artistSongs]);

  // Helper function to get badge styles based on grade
  const getReactivityBadgeClass = (grade: 'A' | 'B' | 'C' | 'D' | 'N/A'): string => {
    switch (grade) {
        case 'A': return 'bg-green-100 text-green-800';
        case 'B': return 'bg-yellow-100 text-yellow-800';
        case 'C': return 'bg-orange-100 text-orange-800'; // Using orange for C
        case 'D': return 'bg-red-100 text-red-800';
        default: return 'bg-gray-100 text-gray-800';
    }
  };

  const cardGradientClass = `card-gradient-default`;

  // --- Render Logic ---
  if (isLoading && !artist) return <p>Loading artist details...</p>;
  if (hasError) return <p>Error loading data. {(errorSongStreams || errorUgcLinks || errorUgcDetails || errorLoadingSongs)?.message}</p>;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`detail-content ${cardGradientClass} max-w-5xl p-6`}>
        <DialogHeader className="mb-4">
          <div className="flex items-center gap-4 mb-2">
            <img
              src={artist.IMAGE_URL_LARGE || 'placeholder.jpg'}
              alt={artist.NAME || 'Artist'}
              className="artist-avatar h-20 w-20 rounded-full object-cover shadow-lg"
            />
            <div className="flex-grow">
              <Select
                value={selectedSongUnifiedId.toString()}
                onValueChange={(value) => {
                  const newSelection = value === 'all' ? 'all' : parseInt(value, 10);
                  console.log(`[Song Select onValueChange] New selection: ${newSelection}`);
                  setSelectedSongUnifiedId(newSelection);
                }}
                disabled={isLoadingSongs}
              >
                <SelectTrigger className="w-full md:w-auto text-2xl font-bold h-auto py-1 border-none shadow-none focus:ring-0 bg-transparent text-left pl-0">
                  <SelectValue placeholder="Select song..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Songs ({artist.NAME || 'Artist'})</SelectItem>
                  {isLoadingSongs && <p className="p-2 text-sm text-muted-foreground">Loading songs...</p>}
                  {errorLoadingSongs && <p className="p-2 text-sm text-red-500">Error loading songs</p>}
                  {artistSongs?.map(song => (
                    <SelectItem key={song.unifiedSongId} value={song.unifiedSongId.toString()}>
                      {song.name || `Song ID ${song.unifiedSongId}`}
                    </SelectItem>
                  ))}
                   {!isLoadingSongs && !artistSongs?.length && <p className="p-2 text-sm text-muted-foreground">No songs found.</p>}
                </SelectContent>
              </Select>
               {/* --- Updated Reactivity Display Under Title --- */}
               {typeof selectedSongUnifiedId === 'number' && (
                 <div className="mt-2 text-base flex items-center">
                    <Zap className="h-5 w-5 mr-1.5 text-yellow-500 flex-shrink-0" />
                     <span className="mr-1.5 text-muted-foreground">Reactivity:</span>
                     {isLoadingReactivity ? (
                         <span className="px-2.5 py-1 rounded-md text-base font-semibold bg-gray-100 text-gray-800">...</span>
                     ) : songReactivityData && songReactivityData.grade !== 'N/A' ? (
                         <>
                             <span className={`px-2.5 py-1 rounded-md text-base font-semibold ${getReactivityBadgeClass(songReactivityData.grade)}`}>
                                 {songReactivityData.grade}
                             </span>
                             {songReactivityData.correlation !== null && typeof songReactivityData.correlation === 'number' && (
                                 <span className="ml-1.5 text-sm text-muted-foreground">({songReactivityData.correlation.toFixed(2)})</span>
                             )}
                         </>
                     ) : (
                         <span className="px-2.5 py-1 rounded-md text-base font-semibold bg-gray-100 text-gray-800">N/A</span>
                     )}
                 </div>
               )}
            </div>
          </div>
          <DialogClose asChild>
            <button
              className="absolute top-4 right-4 p-2 rounded-full bg-white/80 hover:bg-white transition-colors z-10"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </DialogClose>
        </DialogHeader>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Streaming Stats Card */}
          <Card>
             <CardHeader>
               <CardTitle className="text-sm font-medium text-muted-foreground">{streamingStats.label}</CardTitle>
             </CardHeader>
             <CardContent>
               <div className="text-2xl font-bold">{isLoadingSongStreams && selectedSongUnifiedId !== 'all' ? '...' : formatNumber(streamingStats.latestValue)}</div>
               <p className={`text-xs ${streamingStats.percentChange === null ? 'text-muted-foreground' : streamingStats.percentChange === Infinity ? 'text-emerald-600' : streamingStats.percentChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                 {isLoadingSongStreams && selectedSongUnifiedId !== 'all' ? '...' : formatPercent(streamingStats.percentChange)} vs previous week
               </p>
             </CardContent>
          </Card>

          {/* TikTok Stats Card */}
          <Card>
             <CardHeader>
               <CardTitle className="text-sm font-medium text-muted-foreground">{tiktokStats.label}</CardTitle>
             </CardHeader>
             <CardContent>
               <div className="text-2xl font-bold">{isLoadingLinks || isLoadingUgcDetails ? '...' : formatNumber(tiktokStats.latestValue)}</div>
               <p className={`text-xs ${tiktokStats.percentChange === null ? 'text-muted-foreground' : tiktokStats.percentChange === Infinity ? 'text-emerald-600' : tiktokStats.percentChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                 {isLoadingLinks || isLoadingUgcDetails ? '...' : formatPercent(tiktokStats.percentChange)} vs ~7 days prior
               </p>
             </CardContent>
          </Card>
        </div>

        {/* Time Frame Selector */}
        <div className="mb-6 flex justify-end items-center gap-2">
          <span className="text-sm text-muted-foreground">Chart Time Frame:</span>
          <Select
            value={timeFrameMonths.toString()}
            onValueChange={(value) => setTimeFrameMonths(parseInt(value, 10))}
          >
            <SelectTrigger className="w-[120px] bg-white/60 backdrop-blur-sm">
              <SelectValue placeholder="Select time..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 Month</SelectItem>
              <SelectItem value="3">3 Months</SelectItem>
              <SelectItem value="6">6 Months</SelectItem>
              <SelectItem value="12">1 Year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Streaming Chart */}
          <div className="bg-white/50 p-4 rounded-xl">
            <h3 className="text-lg font-semibold mb-3">
              {selectedSongUnifiedId === 'all'
                  ? `US Streaming History (Artist Total - Weekly)`
                  : `US Streaming History (${artistSongs?.find(s => s.unifiedSongId === selectedSongUnifiedId)?.name || 'Selected Song'} - Daily)`}
            </h3>
            <div className="h-[250px]">
              {(isLoadingSongStreams && typeof selectedSongUnifiedId === 'number') ? (
                <p className="text-muted-foreground text-center pt-10">Loading streaming data...</p>
              ) : errorSongStreams ? (
                <p className="text-red-600 text-center pt-10">Error: {errorSongStreams.message}</p>
              ) : streamingChartDataSets.length > 0 && streamingChartDataSets[0]?.data ? (
                <StreamingChart
                  data={streamingChartDataSets[0].data}
                  color={streamingChartDataSets[0].color}
                />
              ) : (
                 <p className="text-muted-foreground text-center pt-10">
                   {selectedSongUnifiedId === 'all'
                     ? "Select a specific song to view daily streaming trends."
                     : "No streaming data available for the selected song."
                   }
                 </p>
              )}
            </div>
          </div>

          {/* TikTok Growth Chart */}
          <div className={`bg-white/50 p-4 rounded-xl flex flex-col`}>
             <div className="flex justify-between items-center mb-3">
               <h3 className="text-lg font-semibold">TikTok Post Count</h3>
               <Dialog open={showAddLinkDialog} onOpenChange={setShowAddLinkDialog}>
                 <DialogTrigger asChild>
                    <Button
                        size="sm"
                        disabled={selectedSongUnifiedId === 'all' || isLoadingLinks || addLinkMutation.isPending}
                    >
                        Link New Sound
                    </Button>
                 </DialogTrigger>
                 <DialogContent>
                   <DialogHeader>
                       <DialogTitle>Link New TikTok Sound</DialogTitle>
                       <DialogDescription>
                           Paste the full URL of the TikTok sound page.
                           {selectedSongUnifiedId !== 'all' && ` It will be linked to the currently selected song: ${linkedSongMap.get(selectedSongUnifiedId) || selectedSongUnifiedId}.`}
                           {selectedSongUnifiedId === 'all' && ` It will be linked to the artist, but not a specific song.`}
                       </DialogDescription>
                   </DialogHeader>
                   <form onSubmit={handleAddLinkSubmit} className="grid gap-4 py-4">
                       <Input
                           id="tiktok-url"
                           placeholder="https://www.tiktok.com/.../music/..."
                           value={newTikTokUrl}
                           onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTikTokUrl(e.target.value)}
                           required
                           disabled={addLinkMutation.isPending}
                       />
                        {addLinkMutation.isError && (
                           <p className="text-sm text-destructive">
                               {(addLinkMutation.error as Error)?.message || 'An unknown error occurred.'}
                           </p>
                       )}
                       <DialogFooter>
                           <Button type="button" variant="outline" onClick={() => setShowAddLinkDialog(false)} disabled={addLinkMutation.isPending}>Cancel</Button>
                           <Button type="submit" disabled={addLinkMutation.isPending}>
                               {addLinkMutation.isPending ? "Linking..." : 'Link Sound'}
                           </Button>
                       </DialogFooter>
                   </form>
                 </DialogContent>
               </Dialog>
             </div>
             {/* Sound Selection - Only show if a song is selected */}
             {selectedSongUnifiedId !== 'all' && (
                <div className="flex items-center gap-2 text-sm mb-3">
                   <span className="text-muted-foreground">Sound:</span>
                   {isLoadingLinks && <span className="text-xs text-muted-foreground">Loading...</span>}
                   {errorUgcLinks && <span className="text-xs text-red-600">Error</span>}
                   {!isLoadingLinks && !errorUgcLinks && ugcLinks && (
                     <Select
                       value={selectedSoundId}
                       onValueChange={(value) => setSelectedSoundId(value)}
                     >
                       <SelectTrigger className="w-[180px] bg-white/60 backdrop-blur-sm">
                         <SelectValue placeholder="Select sound..." />
                       </SelectTrigger>
                       <SelectContent>
                         <SelectItem value="all">All Linked Sounds</SelectItem>
                         {ugcLinks.map(link => (
                           <SelectItem key={link.ID} value={link.TIKTOK_SOUND_ID.toString()}>
                             {link.TIKTOK_SOUND_NAME || `Sound ${link.TIKTOK_SOUND_ID}`}
                           </SelectItem>
                         ))}
                         {ugcLinks.length === 0 && (
                           <div className="px-2 py-1.5 text-xs text-muted-foreground">No sounds linked to this song.</div>
                         )}
                       </SelectContent>
                     </Select>
                   )}
                </div>
             )}

            {/* UGC Chart Area */}
            <div className="h-[250px] flex-grow">
              {isLoadingUgcDetails ? (
                 <p className="text-muted-foreground text-center pt-10">Loading TikTok data...</p>
              ) : errorUgcDetails ? (
                 <p className="text-red-600 text-center pt-10">Error: {errorUgcDetails.message}</p>
              ) : processedUgcData.length > 0 && processedUgcData[0]?.data ? (
                <UgcChart config={{}} className="h-full">
                   <LineChart
                       data={processedUgcData[0].data}
                       margin={{ top: 5, right: 20, left: -30, bottom: 5 }}
                   >
                       <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                       <XAxis dataKey="date" tickFormatter={(tick) => format(new Date(tick + 'T00:00:00'), 'MMM d')} minTickGap={20} padding={{ left: 10, right: 10 }} />
                       <YAxis tickFormatter={(value) => formatNumber(value as number)} allowDecimals={false} domain={['auto', 'auto']} />
                       <Tooltip formatter={(value: number) => [formatNumber(value), processedUgcData[0].name || 'Posts']} labelFormatter={(label) => format(new Date(label + 'T00:00:00'), 'MMM d, yyyy')} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)', padding: '6px 10px', backgroundColor: 'rgba(255, 255, 255, 0.9)' }} />
                       <Line type="monotone" dataKey="value" stroke={processedUgcData[0].color || "#8b5cf6"} strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                   </LineChart>
                </UgcChart>
              ) : (
                <p className="text-muted-foreground text-center pt-10">
                  {selectedSongUnifiedId === 'all' ? 'Select a specific song to view its UGC chart.' : 'No TikTok data available for the selected sound(s).'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Linked TikTok Sounds Table Section */}
        <div className="mt-6">
          <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-semibold">Linked TikTok Sounds</h3>
          </div>
          {isLoadingLinks && <p>Loading links...</p>}
          {errorUgcLinks && <p className="text-red-500">Error loading links: {(errorUgcLinks as Error).message}</p>}
          {!isLoadingLinks && !errorUgcLinks && (
              <Card>
                  <CardContent className="p-0">
                      <Table>
                          <TableHeader>
                              <TableRow>
                                  <TableHead>Sound Name</TableHead>
                                  <TableHead>TikTok ID</TableHead>
                                  <TableHead>Linked Song</TableHead>
                                  <TableHead>Actions</TableHead>
                              </TableRow>
                          </TableHeader>
                          <TableBody>
                              {ugcLinks && ugcLinks.length > 0 ? (
                                  ugcLinks.map(link => (
                                      <TableRow key={link.ID}>
                                          <TableCell className="font-medium">{link.TIKTOK_SOUND_NAME || '-'}</TableCell>
                                          <TableCell>{link.TIKTOK_SOUND_ID}</TableCell>
                                          <TableCell>
                                              {link.UNIFIED_SONG_ID ? (linkedSongMap.get(link.UNIFIED_SONG_ID) || `ID: ${link.UNIFIED_SONG_ID}`) : 'N/A'}
                                          </TableCell>
                                          <TableCell>
                                              <Button
                                                  variant="destructive"
                                                  size="sm"
                                                  onClick={(e: React.MouseEvent) => handleDeleteUgcLink(e, link)}
                                                  disabled={deleteLinkMutation.isPending}
                                              >
                                                  Delete
                                              </Button>
                                          </TableCell>
                                      </TableRow>
                                  ))
                              ) : (
                                  <TableRow>
                                      <TableCell colSpan={4} className="h-24 text-center">
                                          No TikTok sounds linked yet {selectedSongUnifiedId !== 'all' ? 'for this specific song' : 'for this artist'}.
                                      </TableCell>
                                  </TableRow>
                              )}
                          </TableBody>
                      </Table>
                  </CardContent>
              </Card>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
};

export default ArtistDetail;