import React, { useMemo } from 'react';
import { Music, TrendingUp, Users, Percent, Flame, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { format, subMonths } from 'date-fns';

interface Artist {
    ID: number;
    NAME: string | null;
    IMAGE_URL_LARGE: string | null;
    US_METRICS_THIS_WEEK?: number | null;
    US_METRICS_PERCENT_CHANGE?: number | null;
    LATEST_UGC_POST_COUNT?: number | null;
    LATEST_UGC_PERCENT_CHANGE?: number | null;
}

interface ArtistUgcLink {
    ID: number;
    ARTIST_CARD_ID: number;
    TIKTOK_SOUND_ID: number;
    TIKTOK_SOUND_NAME: string | null;
    UNIFIED_SONG_ID: number | null;
}

interface DetailedUgcData {
    [key: string]: Array<{ date: string; value: number | null }>;
}

const getIsoDateRange = (monthsAgo: number): { startDate: string; endDate: string } => {
  const endDate = new Date();
  const startDate = subMonths(endDate, monthsAgo);
  return {
    startDate: format(startDate, 'yyyy-MM-dd'),
    endDate: format(endDate, 'yyyy-MM-dd'),
  };
};

const fetchUgcLinks = async (artistId: number): Promise<ArtistUgcLink[]> => {
  const url = `/api/artist-cards/${artistId}/ugc-links`;
  console.log(`[ArtistCard fetchUgcLinks] Fetching all links for artist ${artistId}`);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`[ArtistCard] Failed to fetch UGC links. Status: ${response.status}, URL: ${url}`);
    throw new Error('Failed to fetch UGC links for card');
  }
  return response.json();
};

const fetchDetailedUgcTimeSeries = async (artistId: number): Promise<DetailedUgcData> => {
  const months = 1;
  const { startDate, endDate } = getIsoDateRange(months);
  const response = await fetch(`/api/artist-cards/${artistId}/ugc-timeseries/details?startDate=${startDate}&endDate=${endDate}`);
  if (!response.ok) throw new Error('Failed to fetch detailed UGC timeseries for card');
  const rawData = await response.json();
  return rawData?.soundTimeSeries || {};
};

const formatNumber = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return 'N/A';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
};

const formatPercentFromDecimal = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return 'N/A';
  return `${(num * 100).toFixed(1)}%`;
};

const formatPercentDirect = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return 'N/A';
  return `${num.toFixed(1)}%`;
};

interface ArtistCardProps {
  artist: Artist;
  onDetailClick: () => void;
}

const ArtistCard: React.FC<ArtistCardProps> = ({ artist, onDetailClick }) => {
  const {
    ID,
    NAME,
    IMAGE_URL_LARGE,
    US_METRICS_THIS_WEEK,
    US_METRICS_PERCENT_CHANGE,
  } = artist;

  const {
    data: ugcLinks,
    isLoading: isLoadingLinks,
    error: errorUgcLinks
  } = useQuery<ArtistUgcLink[], Error>({
    queryKey: ['ugcLinksCard', ID],
    queryFn: () => fetchUgcLinks(ID),
    enabled: !!ID,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const {
    data: detailedUgcData,
    isLoading: isLoadingUgcDetails,
    error: errorUgcDetails
  } = useQuery<DetailedUgcData, Error>({
    queryKey: ['detailedUgcTimeSeriesCard', ID],
    queryFn: () => fetchDetailedUgcTimeSeries(ID),
    enabled: !!ID,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const tiktokStats = useMemo(() => {
    if (isLoadingLinks || isLoadingUgcDetails || !ugcLinks || !detailedUgcData) {
        return { latestValue: null, percentChange: null, label: "TikTok Posts", isLoading: true };
    }
    if (errorUgcLinks || errorUgcDetails) {
        console.error("Error fetching UGC data for card:", errorUgcLinks || errorUgcDetails);
        return { latestValue: null, percentChange: null, label: "TikTok Posts", isLoading: false };
    }

    const relevantSoundIds = ugcLinks.map(link => link.TIKTOK_SOUND_ID.toString());
    const labelBase = "TikTok Posts";

    if (relevantSoundIds.length === 0) return { latestValue: null, percentChange: null, label: labelBase, isLoading: false };

    const summedDailyData: { [date: string]: number } = {};
    relevantSoundIds.forEach(soundId => {
        const soundData = detailedUgcData[soundId] || [];
        soundData.forEach(point => { if (point.value !== null) { summedDailyData[point.date] = (summedDailyData[point.date] || 0) + point.value; } });
    });
    const sortedSummedData = Object.entries(summedDailyData).map(([date, value]) => ({ date, value })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (sortedSummedData.length === 0) return { latestValue: null, percentChange: null, label: labelBase, isLoading: false };

    let latestValue: number | null = null; let previousValue: number | null = null;
    let latestDateObj: Date | null = null;

    for (let i = sortedSummedData.length - 1; i >= 0; i--) {
        if (sortedSummedData[i].value !== null) {
            latestValue = sortedSummedData[i].value;
            latestDateObj = new Date(sortedSummedData[i].date + 'T00:00:00');
            break;
        }
    }

    if (latestDateObj) {
        const sevenDaysPriorTarget = latestDateObj.getTime() - (7 * 24 * 60 * 60 * 1000);

        for (let i = sortedSummedData.length - 1; i >= 0; i--) {
            const currentDate = new Date(sortedSummedData[i].date + 'T00:00:00');
            const timeDiff = latestDateObj.getTime() - currentDate.getTime();

            if (timeDiff >= (6.5 * 24 * 60 * 60 * 1000)) {
                 if (sortedSummedData[i].value !== null) {
                      previousValue = sortedSummedData[i].value;
                      break;
                 }
            }
        }
    }

    let percentChange: number | null = null;
    if (latestValue !== null && previousValue !== null && previousValue !== 0) {
        percentChange = (latestValue - previousValue) / previousValue * 100;
    } else if (latestValue !== null && latestValue > 0 && (previousValue === null || previousValue === 0)) {
        percentChange = Infinity;
    } else if (latestValue === 0 && previousValue === 0) {
        percentChange = 0;
    } else if (latestValue !== null && previousValue === null) {
        percentChange = Infinity;
    }

    return { latestValue, percentChange, label: labelBase, isLoading: false };
  }, [ugcLinks, detailedUgcData, isLoadingLinks, isLoadingUgcDetails, errorUgcLinks, errorUgcDetails]);

  const ALERT_THRESHOLD = 20;

  const cardClasses = `bento-card bento-card-sm card-gradient-default animate-scale-in cursor-pointer flex flex-col`;

  return (
    <div
      className={cardClasses}
      onClick={onDetailClick}
    >
      <div className="flex items-center gap-4 mb-5">
        <img
          src={IMAGE_URL_LARGE || 'placeholder.jpg'}
          alt={NAME || 'Artist'}
          className="artist-avatar h-16 w-16"
        />
        <div className="flex-1">
          <h3 className="font-bold text-xl line-clamp-1">{NAME || 'Unnamed Artist'}</h3>
        </div>
        <div className="flex items-center">
            {/* Only Detail click is handled by main div onClick now */}
            {/* Consider adding other icons/buttons here if needed in future */}
        </div>
      </div>
      
      <div className="mt-auto grid grid-cols-2 gap-4 pt-4 border-t border-white/40 text-base">
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            <Music className="h-5 w-5" />
            <span>Streams (US)</span>
          </div>
          <span className="font-semibold text-lg">{formatNumber(US_METRICS_THIS_WEEK)}</span>
          <div className="flex items-center justify-center gap-1">
            <span className={`font-semibold text-base ${US_METRICS_PERCENT_CHANGE === null ? 'text-muted-foreground' : US_METRICS_PERCENT_CHANGE >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatPercentDirect(US_METRICS_PERCENT_CHANGE)}
            </span>
            {US_METRICS_PERCENT_CHANGE !== null && US_METRICS_PERCENT_CHANGE >= ALERT_THRESHOLD && (
              <Flame className="h-4 w-4 text-orange-500" />
            )}
          </div>
        </div>
        
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            <TrendingUp className="h-5 w-5" />
            <span>{tiktokStats.label}</span>
          </div>
          <span className="font-semibold text-lg">
              {tiktokStats.isLoading ? '...' : formatNumber(tiktokStats.latestValue)}
          </span>
          <div className="flex items-center justify-center gap-1">
            <span className={`font-semibold text-base ${tiktokStats.isLoading ? 'text-muted-foreground' : tiktokStats.percentChange === null ? 'text-muted-foreground' : tiktokStats.percentChange === Infinity ? 'text-green-600' : tiktokStats.percentChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {tiktokStats.isLoading ? '...' : formatPercentDirect(tiktokStats.percentChange)}
            </span>
            {!tiktokStats.isLoading && tiktokStats.percentChange !== null && tiktokStats.percentChange >= ALERT_THRESHOLD && (
              <Flame className="h-4 w-4 text-orange-500" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArtistCard;
