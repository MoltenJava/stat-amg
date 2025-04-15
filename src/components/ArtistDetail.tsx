import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "../../frontend/src/components/ui/card.js";
import { Button } from "../../frontend/src/components/ui/button.js";
import { Input } from "../../frontend/src/components/ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../frontend/src/components/ui/select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../frontend/src/components/ui/table.js";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogClose, DialogFooter, DialogTrigger, DialogContent } from "../../frontend/src/components/ui/dialog.js";
import { X } from 'lucide-react';
import { ArtistCard } from '../data/artistCardData.js';
import { format } from 'date-fns';

// Placeholder for StreamingChart component since the original can't be found
const StreamingChart: React.FC<{ data: any[] }> = () => (
  <div className="h-full flex items-center justify-center bg-muted/20 rounded-md">
    <p>Chart visualization placeholder</p>
  </div>
);

interface ArtistUgcLink {
  ID: number;
  ARTIST_CARD_ID: number;
  TIKTOK_SOUND_ID: number;
  TIKTOK_SOUND_NAME: string | null;
  UNIFIED_SONG_ID: number | null;
}

interface DetailedUgcDatapoint {
  date: string;
  value: number | null;
}

interface DetailedUgcData {
  [soundId: string]: DetailedUgcDatapoint[];
}

interface ArtistSongInfo {
    unifiedSongId: number;
    spotifyTrackId: number; 
    name: string | null;
}

interface DailySongStreamData {
  metricDate: string; // ISO date string from the API
  usStreams: number;
  unifiedSongId: number;
  songName: string | null;
}

const fetchUgcLinks = async (artistId: number, unifiedSongId?: number | null): Promise<ArtistUgcLink[]> => {
  let url = `/api/artist-cards/${artistId}/ugc-links`;
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
  const daysLookback = months * 30;
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const startDate = new Date(today.setDate(today.getDate() - daysLookback)).toISOString().split('T')[0];

  console.log(`[fetchDetailedUgcTimeSeries] Fetching UGC details for Artist ${artistId}, Start: ${startDate}, End: ${endDate}`);
  const response = await fetch(`/api/artist-cards/${artistId}/ugc-timeseries/details?startDate=${startDate}&endDate=${endDate}`);
  if (!response.ok) {
      console.error(`Failed to fetch detailed UGC time series. Status: ${response.status}`);
      throw new Error('Failed to fetch detailed UGC time series');
  }
  const data = await response.json();
  console.log(`[fetchDetailedUgcTimeSeries] Fetched detailed UGC data for ${Object.keys(data.soundTimeSeries || {}).length} sounds.`);
  return data.soundTimeSeries || {};
};

const fetchArtistSongs = async (artistId: number): Promise<ArtistSongInfo[]> => {
    const response = await fetch(`/api/artist-cards/${artistId}/songs`);
    if (!response.ok) {
        console.error(`Failed to fetch songs for artist ${artistId}. Status: ${response.status}`);
        throw new Error('Failed to fetch artist songs');
    }
    const data = await response.json() as ArtistSongInfo[];
    console.log(`[fetchArtistSongs] Fetched ${data.length} songs for artist ${artistId}:`, data);
    return data;
};

const deleteUgcLinkApi = async (linkId: number): Promise<void> => {
    console.log(`[deleteUgcLinkApi] Deleting link ID: ${linkId}`);
    const response = await fetch(`/api/artist-cards/0/ugc-links/${linkId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`[deleteUgcLinkApi] Failed for ID ${linkId}. Status: ${response.status}`, errorData);
        throw new Error(errorData.error || `Failed to delete UGC link ${linkId}`);
    }
    console.log(`[deleteUgcLinkApi] Successfully deleted link ID: ${linkId}`);
};

const fetchDailySongStreams = async (artistId: number, unifiedSongId: number | 'all', daysLookback: number = 30): Promise<DailySongStreamData[]> => {
    if (unifiedSongId === 'all') {
        return []; // API doesn't support 'all' songs, return empty array
    }
    
    const response = await fetch(`/api/artist-cards/${artistId}/daily-streams?unifiedSongId=${unifiedSongId}&daysLookback=${daysLookback}`);
    
    if (!response.ok) {
        throw new Error(`Failed to fetch daily streams: ${response.statusText}`);
    }
    
    return response.json();
};

const ArtistDetail: React.FC<{ artist: ArtistCard; onClose: () => void }> = ({ artist, onClose }) => {
    const queryClient = useQueryClient();
    const { ID, NAME, IMAGE_URL_LARGE } = artist;

    const [timeFrameMonths, setTimeFrameMonths] = useState<number>(1);
    const [selectedSongUnifiedId, setSelectedSongUnifiedId] = useState<number | 'all'>('all');
    const [showAddLinkDialog, setShowAddLinkDialog] = useState(false);
    const [newTikTokUrl, setNewTikTokUrl] = useState('');

    const formatNumber = (num: number | null | undefined): string => {
        if (num === null || num === undefined) return 'N/A';
        return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(num);
    };
    const formatPercent = (num: number | null | undefined): string => {
        if (num === null || num === undefined) return 'N/A';
        if (num === Infinity) return '+∞%';
        if (num === -Infinity) return '-∞%';
        return `${(num * 100).toFixed(1)}%`;
    };

    const queryKeyParams = { artistId: ID, songId: selectedSongUnifiedId, timeFrame: timeFrameMonths };

    const { data: artistSongs, isLoading: isLoadingSongs, error: errorLoadingSongs } = useQuery<ArtistSongInfo[], Error>({
        queryKey: ['artistSongs', ID],
        queryFn: () => fetchArtistSongs(ID),
        enabled: !!ID,
        staleTime: Infinity,
    });

    const { data: ugcLinks, isLoading: isLoadingLinks, error: errorUgcLinks } = useQuery<ArtistUgcLink[], Error>({
        queryKey: ['ugcLinks', queryKeyParams.artistId, queryKeyParams.songId],
        queryFn: () => fetchUgcLinks(queryKeyParams.artistId, queryKeyParams.songId === 'all' ? null : queryKeyParams.songId),
        enabled: !!ID,
        staleTime: 5 * 60 * 1000,
    });

    const { data: detailedUgcData, isLoading: isLoadingUgcDetails, error: errorUgcDetails } = useQuery<DetailedUgcData, Error>({
        queryKey: ['detailedUgcTimeSeries', queryKeyParams.artistId, queryKeyParams.timeFrame],
        queryFn: () => fetchDetailedUgcTimeSeries(queryKeyParams.artistId, queryKeyParams.timeFrame),
        enabled: !!ID,
    });

    const { data: songDailyStreamsData, isLoading: isLoadingSongStreams, error: errorLoadingSongStreams } = useQuery<DailySongStreamData[], Error>({
        queryKey: ['dailyStreams', ID, selectedSongUnifiedId, timeFrameMonths],
        queryFn: () => fetchDailySongStreams(ID, selectedSongUnifiedId, timeFrameMonths * 30), // Convert months to days
        enabled: !!ID && selectedSongUnifiedId !== 'all',
        staleTime: 5 * 60 * 1000, // 5 minutes
        refetchOnWindowFocus: false,
    });

    const addLinkMutation = useMutation({
        mutationFn: async (data: { artistCardId: number; tiktokSoundUrl: string; unifiedSongId: number | null }) => {
            const response = await fetch(`/api/artist-cards/${data.artistCardId}/ugc-links`, {
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
            console.log("[addLinkMutation] Success. Invalidating ugcLinks query.");
            queryClient.invalidateQueries({ queryKey: ['ugcLinks', queryKeyParams.artistId] });
            setNewTikTokUrl('');
            setShowAddLinkDialog(false);
        },
        onError: (err) => {
            console.error("[addLinkMutation] Error:", err);
            alert(`Error adding link: ${err.message}`);
        },
    });

    const deleteLinkMutation = useMutation({
        mutationFn: deleteUgcLinkApi,
        onSuccess: () => {
            console.log("[deleteLinkMutation] Success. Invalidating ugcLinks query.");
            queryClient.invalidateQueries({ queryKey: ['ugcLinks', queryKeyParams.artistId] });
            queryClient.invalidateQueries({ queryKey: ['detailedUgcTimeSeries', queryKeyParams.artistId] });
        },
        onError: (err: Error) => {
            console.error("[deleteLinkMutation] Error:", err);
            alert(`Failed to delete link: ${err.message}`);
        },
    });

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

    const isLoading = isLoadingLinks || isLoadingUgcDetails || isLoadingSongs || isLoadingSongStreams;
    const hasError = errorUgcLinks || errorUgcDetails || errorLoadingSongs || errorLoadingSongStreams;

    const streamingStats = useMemo(() => {
        if (selectedSongUnifiedId === 'all') {
            return {
                latestValue: artist.US_METRICS_THIS_WEEK,
                percentChange: artist.US_METRICS_PERCENT_CHANGE,
                label: "US Streams (Week - Artist Total)"
            };
        }
        return { latestValue: null, percentChange: null, label: "US Streams (Weekly - Song)" };

    }, [selectedSongUnifiedId, artist]);

    const tiktokStats = useMemo(() => {
        if (!ugcLinks || !detailedUgcData) {
            return { latestValue: null, percentChange: null, label: "TikTok Posts (Daily)" };
        }
        const relevantSoundIds = ugcLinks.map(link => link.TIKTOK_SOUND_ID.toString());
        if (relevantSoundIds.length === 0) {
            const label = selectedSongUnifiedId === 'all' ? "TikTok Posts (Daily - All Linked)" : "TikTok Posts (Daily - Song)";
            return { latestValue: null, percentChange: null, label: label };
        }

        const summedDailyData: { [date: string]: number } = {};
        relevantSoundIds.forEach(soundId => {
            const soundData = detailedUgcData[soundId] || [];
            soundData.forEach(point => {
                if (point.value !== null) {
                    summedDailyData[point.date] = (summedDailyData[point.date] || 0) + point.value;
                }
            });
        });
        const sortedSummedData = Object.entries(summedDailyData)
            .map(([date, value]) => ({ date, value }))
            .filter((item): item is {date: string; value: number} => {
                return item !== null && typeof item === 'object' && 
                       typeof item.date === 'string' && 
                       typeof item.value === 'number';
            })
            .sort((a, b) => {
                return new Date(a!.date).getTime() - new Date(b!.date).getTime();
            });

        if (sortedSummedData.length === 0) {
            const label = selectedSongUnifiedId === 'all' ? "TikTok Posts (Daily - All Linked)" : "TikTok Posts (Daily - Song)";
            return { latestValue: null, percentChange: null, label: label };
        }

        let latestValue: number | null = null;
        let previousValue: number | null = null;
        for (let i = sortedSummedData.length - 1; i >= 0; i--) {
            if (sortedSummedData[i].value !== null && latestValue === null) {
                latestValue = sortedSummedData[i].value;
                const latestDate = new Date(sortedSummedData[i].date);
                for (let j = i - 1; j >= 0; j--) {
                    const currentDate = new Date(sortedSummedData[j].date);
                    if (latestDate.getTime() - currentDate.getTime() >= 7 * 24 * 60 * 60 * 1000) {
                        if (sortedSummedData[j].value !== null) {
                            previousValue = sortedSummedData[j].value;
                        }
                        break;
                    }
                }
                break;
            }
        }

        let percentChange: number | null = null;
        if (latestValue !== null && previousValue !== null && previousValue !== 0) {
            percentChange = (latestValue - previousValue) / previousValue;
        } else if (latestValue !== null && latestValue > 0 && (previousValue === null || previousValue === 0)) {
            percentChange = Infinity;
        } else if (latestValue === 0 && previousValue === 0) {
            percentChange = 0;
        }

        const label = selectedSongUnifiedId === 'all' ? "TikTok Posts (Daily - All Linked)" : "TikTok Posts (Daily - Song)";
        return { latestValue, percentChange, label };

    }, [ugcLinks, detailedUgcData, selectedSongUnifiedId]);

    const streamingChartDataSets = useMemo(() => {
        const datasets = [];
        if (typeof selectedSongUnifiedId === 'number' && songDailyStreamsData) {
            const songInfo = artistSongs?.find(s => s.unifiedSongId === selectedSongUnifiedId);
            const songName = songInfo?.name || `Song ${selectedSongUnifiedId}`;
            datasets.push({
                name: songName,
                data: songDailyStreamsData.map((d: DailySongStreamData) => {
                    try {
                        const dateObj = new Date(d.metricDate);
                        // Check if date is valid before formatting
                        if (isNaN(dateObj.getTime())) {
                            console.error(`Invalid date: ${d.metricDate}`);
                            return null;
                        }
                        return {
                            date: format(dateObj, 'yyyy-MM-dd'),
                            value: d.usStreams
                        };
                    } catch (error) {
                        console.error(`Error formatting date: ${d.metricDate}`, error);
                        return null;
                    }
                })
                .filter(Boolean) // Remove null entries
                .sort((a, b) => {
                    // TypeScript doesn't recognize that our type guard ensures non-null values
                    // We've filtered these to guarantee they're not null
                    return new Date(a!.date).getTime() - new Date(b!.date).getTime();
                }),
                valueKey: 'value',
                color: '#34d399'
            });
        }
        return datasets;
    }, [selectedSongUnifiedId, songDailyStreamsData, artistSongs]);

    if (isLoading) return <p>Loading artist details...</p>;
    if (hasError) return <p>Error loading data. {(errorUgcLinks || errorUgcDetails || errorLoadingSongs || errorLoadingSongStreams)?.message}</p>;

    const linkedSongMap = useMemo(() => {
        const map = new Map<number, string>();
        artistSongs?.forEach(song => {
            if (song.name) {
                map.set(song.unifiedSongId, song.name);
            }
        });
        return map;
    }, [artistSongs]);

    return (
        <DialogContent className="max-w-4xl" onInteractOutside={onClose} onEscapeKeyDown={onClose}>
            <DialogHeader>
                <div className="flex items-center gap-4">
                    <img 
                        src={IMAGE_URL_LARGE || 'placeholder.jpg'} 
                        alt={NAME || 'Artist'} 
                        className="h-16 w-16 rounded-full object-cover"
                    />
                    <div>
                        <DialogTitle className="text-2xl">{NAME || 'Unnamed Artist'}</DialogTitle>
                    </div>
                </div>
                <DialogClose asChild>
                    <Button 
                        variant="ghost"
                        size="icon"
                        className="absolute top-4 right-4 rounded-full"
                        onClick={onClose} 
                        aria-label="Close"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </DialogClose>
            </DialogHeader>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium text-muted-foreground">{streamingStats.label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatNumber(streamingStats.latestValue)}</div>
                        <p className={`text-xs ${streamingStats.percentChange !== null && streamingStats.percentChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatPercent(streamingStats.percentChange)} vs previous period
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium text-muted-foreground">{tiktokStats.label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatNumber(tiktokStats.latestValue)}</div>
                         <p className={`text-xs ${tiktokStats.percentChange !== null && tiktokStats.percentChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatPercent(tiktokStats.percentChange)} vs ~7 days prior
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="mt-6">
                <label htmlFor="song-select" className="block text-sm font-medium text-muted-foreground mb-1">Filter Data by Song</label>
                <Select 
                    value={selectedSongUnifiedId.toString()} 
                    onValueChange={(value: string) => setSelectedSongUnifiedId(value === 'all' ? 'all' : parseInt(value))}
                    disabled={isLoadingSongs}
                >
                    <SelectTrigger id="song-select">
                        <SelectValue placeholder="Select a song..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Songs</SelectItem>
                        {artistSongs?.map(song => (
                            <SelectItem key={song.unifiedSongId} value={song.unifiedSongId.toString()}>
                                {song.name || `Song ID: ${song.unifiedSongId}`}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {errorLoadingSongs && <p className="text-red-500 text-xs mt-1">Error loading songs.</p>}
            </div>

            {selectedSongUnifiedId !== 'all' && (
                <div className="mt-6 h-[300px]">
                    <h3 className="text-lg font-semibold mb-2">Daily Streaming Trends (US)</h3>
                    <StreamingChart data={streamingChartDataSets} /> 
                    <p className="text-sm text-muted-foreground mt-2">Daily streaming data for the selected song will appear here.</p>
                </div>
            )}
            {selectedSongUnifiedId === 'all' && !isLoadingUgcDetails && (
                 <p className="text-center text-sm text-muted-foreground mt-4">Select a specific song to view its UGC chart.</p>
            )}

            <div className="mt-6">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-semibold">Linked TikTok Sounds</h3>
                    <Dialog open={showAddLinkDialog} onOpenChange={setShowAddLinkDialog}>
                        <DialogTrigger asChild>
                            {selectedSongUnifiedId !== 'all' && <Button size="sm">Link New Sound</Button>}
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
                                        {addLinkMutation.isPending ? 'Linking...' : 'Link Sound'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
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
                                        <TableHead>Unified Song ID</TableHead>
                                        <TableHead>Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {ugcLinks && ugcLinks.length > 0 ? (
                                        ugcLinks.map(link => (
                                            <TableRow key={link.ID}>
                                                <TableCell className="font-medium">{link.TIKTOK_SOUND_NAME || '-'}</TableCell>
                                                <TableCell>{link.TIKTOK_SOUND_ID}</TableCell>
                                                <TableCell>{link.UNIFIED_SONG_ID ?? 'N/A'}</TableCell>
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
    );
};

export default ArtistDetail; 