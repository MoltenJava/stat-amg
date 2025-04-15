import React, { useState, useEffect, useCallback } from 'react';
import { Music, Share, TrendingUp, FileText, PlusCircle, List, UserPlus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import SearchBar from '../components/SearchBar';
import ArtistCard from '../components/ArtistCard';
import ArtistDetail from '@/components/ArtistDetail.tsx';
import AddArtistForm from '../components/AddArtistForm';
import ShareModal from '../components/ShareModal';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { X } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { debounce } from 'lodash';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Link } from 'react-router-dom';
import { toast } from "sonner";
import { getApiUrl } from '@/lib/apiUtils';

// Define Artist type for the frontend (matching expected API response)
// Renamed from ArtistCard back to Artist and added expected fields
interface Artist { 
    ID: number;
    NAME: string | null; 
    IMAGE_URL_LARGE: string | null;
    // Add other fields expected from the /api/artist-cards endpoint
    SPOTIFY_ARTIST_ID?: string | null; // Added
    NUMERIC_ACCOUNT_ID?: number | null; // Added
    CREATED_AT?: string | Date | null; // Added
    UPDATED_AT?: string | Date | null; // Added
    US_METRICS_THIS_WEEK?: number | null;
    US_METRICS_PERCENT_CHANGE?: number | null;
    LATEST_UGC_POST_COUNT?: number | null;
    LATEST_UGC_PERCENT_CHANGE?: number | null;
    // Add any other missing fields reported by TS if necessary
}

// --- Define Top Reactive Song Type ---
interface TopReactiveSong {
  rank: number;
  unifiedSongId: number;
  songName: string | null;
  artistId: number;
  artistName: string | null;
  correlation: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'N/A';
}

// --- Define Artist Song Info Type (if not already globally available) ---
interface ArtistSongInfo { 
  unifiedSongId: number;
  spotifyTrackId?: number | null; // Optional for report
  name: string | null;
}

// --- Fetch Function for Artist Songs --- 
const fetchArtistSongsForReport = async (artistId: number | null): Promise<ArtistSongInfo[]> => {
  if (!artistId) return []; // Don't fetch if no artist ID
  const url = getApiUrl(`/api/artist-cards/${artistId}/songs`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch artist songs');
  }
  return response.json();
};

// --- Mock Data for Top Reactive Songs ---
const mockTopReactiveSongs: TopReactiveSong[] = [
  { rank: 1, unifiedSongId: 123, songName: 'Hit Song Alpha', artistId: 1, artistName: 'Artist One', correlation: 0.95, grade: 'A' },
  { rank: 2, unifiedSongId: 456, songName: 'Catchy Tune Beta', artistId: 2, artistName: 'Artist Two', correlation: 0.88, grade: 'B' },
  { rank: 3, unifiedSongId: 789, songName: 'Viral Sound Gamma', artistId: 1, artistName: 'Artist One', correlation: 0.82, grade: 'B' },
  { rank: 4, unifiedSongId: 101, songName: 'Groovy Beat Delta', artistId: 3, artistName: 'Artist Three', correlation: 0.75, grade: 'C' },
  { rank: 5, unifiedSongId: 112, songName: 'Slow Jam Epsilon', artistId: 2, artistName: 'Artist Two', correlation: 0.65, grade: 'D' },
  { rank: 6, unifiedSongId: 113, songName: 'Another One Zeta', artistId: 4, artistName: 'Artist Four', correlation: 0.91, grade: 'A'},
  { rank: 7, unifiedSongId: 114, songName: 'Chart Topper Eta', artistId: 1, artistName: 'Artist One', correlation: 0.71, grade: 'C'},

];

// --- Placeholder for fetchArtists --- Fix Linter Error
const fetchArtists = async (searchTerm: string): Promise<Artist[]> => {
  console.log(`[fetchArtists - Placeholder] Fetching artists for term: ${searchTerm}`)
  const url = getApiUrl(`/api/artist-cards?search=${encodeURIComponent(searchTerm)}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
};

// --- Fetch Function for Top Reactive Songs (Hypothetical Endpoint) ---
const fetchTopReactiveSongs = async (limit: number = 7): Promise<TopReactiveSong[]> => {
  console.log(`[fetchTopReactiveSongs] Fetching top ${limit} reactive songs`);
  const url = getApiUrl(`/api/songs/top-reactive?limit=${limit}`);
  const response = await fetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})); // Try to parse error
    console.error("Error fetching top reactive songs:", response.status, errorData);
    throw new Error(errorData.error || 'Failed to fetch top reactive songs');
  }
  return response.json();
};

const Index: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [selectedArtistShare, setSelectedArtistShare] = useState<Artist | null>(null);
  const [shareModalTimeFrame, setShareModalTimeFrame] = useState<number>(6);
  const [newArtistUrl, setNewArtistUrl] = useState('');
  const [reportArtistId, setReportArtistId] = useState<string | null>(null);
  const [reportSelectedSongIds, setReportSelectedSongIds] = useState<number[]>([]);
  const [reportOutputFormat, setReportOutputFormat] = useState<'web' | 'pdf'>('web');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const queryClient = useQueryClient();
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isAddArtistModalOpen, setIsAddArtistModalOpen] = useState(false);
  const [isTopReactiveModalOpen, setIsTopReactiveModalOpen] = useState(false);

  // Debounce search input
  const debouncedSetSearch = useCallback(
    debounce((value: string) => setDebouncedSearchTerm(value), 500),
    []
  );

  useEffect(() => {
    debouncedSetSearch(searchTerm);
    // Cleanup debounce on unmount
    return () => debouncedSetSearch.cancel();
  }, [searchTerm, debouncedSetSearch]);

  // Fetch artist cards query
  const { data: artists, isLoading: isLoadingArtists, error: errorArtists, refetch: refetchArtists } = useQuery<Artist[], Error>({
    queryKey: ['artists', debouncedSearchTerm],
    queryFn: () => fetchArtists(debouncedSearchTerm),
    staleTime: 5 * 60 * 1000, 
  });

  // Fetch Top Reactive Songs Query
  const { data: topReactiveSongs, isLoading: isLoadingReactivity, error: errorReactivity } = useQuery<TopReactiveSong[], Error>({
    queryKey: ['topReactiveSongs'],
    queryFn: () => fetchTopReactiveSongs(7), // Fetch top 7 for now
    staleTime: 60 * 60 * 1000, // Cache for 1 hour, assumes backend updates periodically
    refetchOnWindowFocus: false,
  });

  // --- Query to fetch songs when an artist is selected for the report ---
  const numericReportArtistId = reportArtistId ? parseInt(reportArtistId, 10) : null;
  const { 
    data: reportArtistSongs, 
    isLoading: isLoadingReportSongs, 
    error: errorReportSongs 
  } = useQuery<ArtistSongInfo[], Error>({
    queryKey: ['artistSongsForReport', numericReportArtistId],
    queryFn: () => fetchArtistSongsForReport(numericReportArtistId),
    enabled: !!numericReportArtistId, // Only fetch when reportArtistId is truthy
    staleTime: 5 * 60 * 1000, // Cache for 5 mins
    refetchOnWindowFocus: false,
  });

  // --- Effect to clear song selection when artist changes ---
  useEffect(() => {
    setReportSelectedSongIds([]); // Clear selected songs when artist changes
  }, [reportArtistId]);

  // --- Handlers for song selection checkboxes ---
  const handleSongSelectionChange = (songId: number, checked: boolean | string) => {
    setReportSelectedSongIds(prev => 
      checked
        ? [...prev, songId]
        : prev.filter(id => id !== songId)
    );
  };

  const handleSelectAllSongs = (check: boolean) => {
    if (check && reportArtistSongs) {
      setReportSelectedSongIds(reportArtistSongs.map(s => s.unifiedSongId));
    } else {
      setReportSelectedSongIds([]);
    }
  };

  // Mutation hook for creating/finding an artist card via API
  const createMutation = useMutation<unknown, Error, { url: string }>({
    mutationFn: async (data) => { // Use fetch to call API
      const apiUrl = getApiUrl('/api/artist-cards');
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyUrl: data.url }) // Send URL in body
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); // Try to parse error
        throw new Error(errorData.error || 'Failed to add artist card');
      }
      return response.json(); // Or handle empty response if needed
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists', debouncedSearchTerm] });
      setNewArtistUrl(''); 
      showNotification('Artist card added/found successfully!', 'success');
      setIsAddArtistModalOpen(false);
    },
    onError: (error) => {
      showNotification(`Error adding artist: ${error.message}`, 'error');
    },
  });

  // Mutation hook for deleting an artist card via API
  const deleteMutation = useMutation<unknown, Error, number>({
    mutationFn: async (artistId) => {
      const apiUrl = getApiUrl(`/api/artist-cards/${artistId}`);
      const response = await fetch(apiUrl, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); // Try to parse error
        throw new Error(errorData.error || 'Failed to delete artist card');
      }
      // No JSON body expected on successful DELETE
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists', debouncedSearchTerm] });
      setSelectedArtist(null); 
      showNotification('Artist card deleted successfully!', 'success');
    },
    onError: (error) => {
      showNotification(`Error deleting artist: ${error.message}`, 'error');
    },
  });

  // Filter logic 
  const filteredArtists = artists?.filter(artist => 
    artist.NAME?.toLowerCase().includes(searchTerm.toLowerCase())
  ); // Should now correctly be Artist[]

  // Handlers for modals
  const handleOpenDetail = (artist: Artist) => {
    setSelectedArtist(artist);
  };
  const handleCloseDetail = () => {
    setSelectedArtist(null);
  };

  const handleOpenShare = (artist: Artist, timeFrame: number = 6) => {
    setSelectedArtistShare(artist);
    setShareModalTimeFrame(timeFrame);
  };
  const handleCloseShare = () => {
    setSelectedArtistShare(null);
  };

  // Handler to open the report modal WITHOUT pre-selected artist
  const handleOpenReportModal = () => {
      setReportArtistId(null); // Clear any previously selected artist
      setReportSelectedSongIds([]); // Clear selected songs
      setIsReportModalOpen(true);
  };

  const handleAddArtist = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newArtistUrl) return;
    createMutation.mutate({ url: newArtistUrl });
  };

  const handleDeleteArtist = (e: React.MouseEvent, artistId: number, artistName?: string | null) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete ${artistName || 'this artist'}?`)) {
      deleteMutation.mutate(artistId);
    }
  };

  // --- Helper function for badge styles (copied from ArtistDetail) ---
  const getReactivityBadgeClass = (grade: 'A' | 'B' | 'C' | 'D' | 'N/A'): string => {
    switch (grade) {
        case 'A': return 'bg-green-100 text-green-800';
        case 'B': return 'bg-yellow-100 text-yellow-800';
        case 'C': return 'bg-orange-100 text-orange-800';
        case 'D': return 'bg-red-100 text-red-800';
        default: return 'bg-gray-100 text-gray-800';
    }
  };

  // --- Helper function to show notifications using Sonner toasts --- 
  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    switch (type) {
        case 'success':
            toast.success(message);
            break;
        case 'error':
            toast.error(message);
            break;
        case 'info':
            toast(message); // Default toast for info
            break;
        default:
            toast(message);
    }
  };

  // --- Function to trigger report generation --- 
  const handleGenerateReport = async (format: 'web' | 'pdf') => {
    if (!reportArtistId) {
       showNotification('Please select an artist first.', 'error');
       return;
    }
    if (format === 'pdf') {
        showNotification('PDF reports are coming soon!', 'info'); // Use info toast
        return;
    }
    
    setIsGeneratingReport(true);
    // Use info type for starting message
    showNotification('Generating report link...', 'info'); 

    try {
      const payload: { artistId: number; songIds?: number[]; format: 'web' } = {
        artistId: parseInt(reportArtistId, 10),
        songIds: reportSelectedSongIds, // Send the array (can be empty)
        format: 'web' // Hardcode to 'web' as PDF is handled above
      };

      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }

      console.log('[handleGenerateReport] Success:', result); 
      setIsReportModalOpen(false); 
      showNotification(result.message || 'Report request sent successfully!', 'success'); // Success toast
      window.open(result.reportUrl, '_blank');

    } catch (error) {
      console.error('[handleGenerateReport] Error:', error);
      showNotification((error as Error).message || 'Failed to generate report.', 'error'); // Error toast
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <TooltipProvider>
    <div className="min-h-screen p-4 md:p-8">
          {/* Header - RESTRUCTURED Layout */}
          <header className="mb-8 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
                {/* Left Group: Logo + Search Bar */}
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <img src="/logo.PNG" alt="Stat Logo" className="h-10 object-contain flex-shrink-0" />
                    <div className="flex-grow md:flex-grow-0 max-w-lg w-full">
            <SearchBar 
              value={searchTerm}
              onChange={setSearchTerm}
            />
          </div>
                </div>

                {/* Right: Button Group - Remains the same */}
                <div className="flex items-center flex-wrap justify-center md:justify-end gap-2 md:gap-3">
                    {/* Add Artist Button & Modal */}
                    <Dialog open={isAddArtistModalOpen} onOpenChange={setIsAddArtistModalOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                                <UserPlus className="mr-1 h-4 w-4" /> Add Artist
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Add Artist</DialogTitle>
                                <DialogDescription>Enter the Spotify Artist URL to add them to the dashboard.</DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleAddArtist} className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                <Input
                                    id="spotify-url"
                                    type="url"
                                    placeholder="https://open.spotify.com/artist/..."
                                    value={newArtistUrl}
                                    onChange={(e) => setNewArtistUrl(e.target.value)}
                                    required
                                    disabled={createMutation.isPending}
                                    className="col-span-4"
                                />
                                </div>
                                <DialogFooter>
                                <Button type="submit" disabled={createMutation.isPending} className="w-full">
                                    {createMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Adding...</> : 'Add Artist'}
                                </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>

                    {/* Top Reactive Songs Button & Modal */}
                    <Dialog open={isTopReactiveModalOpen} onOpenChange={setIsTopReactiveModalOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                                <TrendingUp className="mr-1 h-4 w-4" /> Top Reactive
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[600px]">
                            <DialogHeader>
                                <DialogTitle>Top Reactive Songs (US, 1 Month)</DialogTitle>
                            </DialogHeader>
                            <Card className="border-none shadow-none">
                                <CardContent className="p-0 max-h-[60vh] overflow-y-auto"> {/* Added scroll */} 
                                    {isLoadingReactivity && (
                                        <div className="space-y-4 p-6">
                                        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                                        </div>
                                    )}
                                    {errorReactivity && (
                                        <Alert variant="destructive" className="m-4">
                                        <AlertTitle>Error</AlertTitle>
                                        <AlertDescription>{errorReactivity.message || "Could not load reactivity data."}</AlertDescription>
                                        </Alert>
                                    )}
                                    {!isLoadingReactivity && !errorReactivity && topReactiveSongs && (
                                        <Table className="table-fixed w-full">
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[10%]">#</TableHead>
                                                <TableHead className="w-[65%]">Song / Artist</TableHead>
                                                <TableHead className="w-[25%] text-right">Grade</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {topReactiveSongs.map((song) => (
                                                <TableRow key={song.unifiedSongId}>
                                                <TableCell className="font-medium text-muted-foreground">{song.rank}</TableCell>
                                                <TableCell className="py-2">
                                                    <div className="font-medium truncate" title={song.songName || 'Unknown Song'}>{song.songName || '-'}</div>
                                                    <div className="text-xs text-muted-foreground truncate" title={song.artistName || 'Unknown Artist'}>{song.artistName || '-'}</div>
                                                </TableCell>
                                                <TableCell className="text-right py-2">
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${getReactivityBadgeClass(song.grade)}`}>
                                                            {song.grade}
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>Correlation: {song.correlation !== null ? song.correlation.toFixed(2) : 'N/A'}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TableCell>
                                                </TableRow>
                                            ))}
                                            {topReactiveSongs.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={3} className="h-24 text-center text-muted-foreground p-6">
                                                        No reactivity data available.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>
                        </DialogContent>
                    </Dialog>

                    {/* Create Report Button & Modal */}
                    <Dialog open={isReportModalOpen} onOpenChange={setIsReportModalOpen}>
                        <DialogTrigger asChild>
                             <Button 
                                className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-md transition-transform hover:scale-105"
                                size="sm"
                                onClick={handleOpenReportModal}
                            >
                                <PlusCircle className="mr-1 h-4 w-4" /> Create Report
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[600px]">
                           <DialogHeader>
                                <DialogTitle>Create Artist Report</DialogTitle>
                                <DialogDescription>
                                    Select an artist and optionally specific songs.
                                </DialogDescription>
                            </DialogHeader>
                            
                            {/* Artist Selection - ADDED */}
                            <div className="grid grid-cols-4 items-center gap-4 py-4">
                                <Label htmlFor="report-artist-select" className="text-right">
                                    Artist
                                </Label>
                                <Select 
                                    value={reportArtistId ?? ''}
                                    onValueChange={(value) => setReportArtistId(value || null)}
                                    disabled={isLoadingArtists || !artists?.length}
                                >
                                    <SelectTrigger id="report-artist-select" className="col-span-3">
                                    <SelectValue placeholder="Select an artist..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {isLoadingArtists && <SelectItem value="loading" disabled>Loading...</SelectItem>}
                                        {!isLoadingArtists && artists?.map((artist) => (
                                            <SelectItem key={artist.ID} value={artist.ID.toString()}>
                                            {artist.NAME || `Artist ID: ${artist.ID}`}
                                            </SelectItem>
                                        ))}
                                        {!isLoadingArtists && !artists?.length && <SelectItem value="no-artists" disabled>No artists found</SelectItem>}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Song Selection List - Conditional Render */}
                            {reportArtistId && (
                                <> 
                                    <Label className="text-sm font-medium pl-1 pb-2 block">Select Songs (Optional)</Label>
                                    <ScrollArea className="h-[250px] border rounded-md p-4">
                                        {isLoadingReportSongs ? (
                                            <div className="flex justify-center items-center h-full">
                                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                            </div>
                                        ) : errorReportSongs ? (
                                            <Alert variant="destructive">
                                                <AlertTitle>Error Loading Songs</AlertTitle>
                                                <AlertDescription>{errorReportSongs.message}</AlertDescription>
                                            </Alert>
                                        ) : reportArtistSongs && reportArtistSongs.length > 0 ? (
                                            <div className="space-y-2">
                                                <label className="flex items-center space-x-2 pb-2 border-b">
                                                    <Checkbox
                                                        id="select-all-songs"
                                                        checked={reportSelectedSongIds.length === reportArtistSongs.length && reportArtistSongs.length > 0}
                                                        onCheckedChange={(checked) => handleSelectAllSongs(!!checked)}
                                                    />
                                                    <span className="font-medium">Select All Songs ({reportArtistSongs.length})</span>
                                                </label>
                                                {reportArtistSongs.map((song) => (
                                                    <label key={song.unifiedSongId} className="flex items-center space-x-2 text-sm">
                                                        <Checkbox
                                                            id={`song-${song.unifiedSongId}`}
                                                            checked={reportSelectedSongIds.includes(song.unifiedSongId)}
                                                            onCheckedChange={(checked) => handleSongSelectionChange(song.unifiedSongId, !!checked)}
                                                        />
                                                        <span>{song.name || 'Unnamed Song'}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted-foreground italic text-center py-4 h-full flex items-center justify-center">
                                                No songs found for this artist.
                                            </p>
                                        )}
                                    </ScrollArea>
                                </> 
                            )}
                            {/* Divider if songs are shown */}
                            {reportArtistId && <div className="border-t my-4"></div>}

                            <DialogFooter className="gap-2 sm:justify-end pt-0">
                                 {/* Ensure Generate button is disabled if !reportArtistId */}
                                 <Button 
                                     variant="outline" 
                                     onClick={() => setIsReportModalOpen(false)}
                                 >
                                     Cancel
                                 </Button>
                                 <Button 
                                     onClick={() => handleGenerateReport('pdf')} 
                                     disabled={isGeneratingReport || !reportArtistId}
                                     variant="secondary"
                                 >
                                     Generate PDF (Soon)
                                 </Button>
                                 <Button 
                                     onClick={() => handleGenerateReport('web')} 
                                     disabled={isGeneratingReport || !reportArtistId}
                                 >
                                     {isGeneratingReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                     Generate Web Link
                                 </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* View Reports Button - UPDATED to Link */}
                    <Button 
                        asChild
                        variant="outline"
                        className="shadow-sm transition-transform hover:scale-105"
                        size="sm"
                    >
                        <Link to="/reports">
                             <List className="mr-1 h-4 w-4" /> View Reports
                        </Link>
                    </Button>
        </div>
      </header>

          {/* --- Main Content Area with Sidebar --- */}
          <div className="flex flex-col md:flex-row gap-8 mt-8">

             {/* Artist Grid (Main Area) */}
             <div className="flex-grow">
                {(isLoadingArtists) && (
                   <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
                      {Array.from({ length: 8 }).map((_, i) => (
                         <Skeleton key={i} className="h-[200px] w-full rounded-xl" />
                      ))}
           </div>
        )}
                {errorArtists && (
                   <Alert variant="destructive">
                      <AlertTitle>Error</AlertTitle>
                      <AlertDescription>Failed to load artists: {errorArtists.message}</AlertDescription>
                   </Alert>
                )}
                {!isLoadingArtists && !errorArtists && (
                   <div className="bento-grid"> 
                      {filteredArtists && filteredArtists.length > 0 ? (
              filteredArtists.map(artist => (
                <ArtistCard 
                               key={artist.ID}
                  artist={artist} 
                  onDetailClick={() => handleOpenDetail(artist)}
                />
              ))
            ) : (
                         <div className="col-span-full flex flex-col items-center justify-center p-12 text-center">
                <p className="text-lg mb-2">No artists found</p>
                            <p className="text-muted-foreground text-sm">
                               {searchTerm ? 'Try a different search term' : (artists && artists.length === 0) ? 'No artists added yet.' : 'Your search did not match any artists.'}
                 </p>
              </div>
            )}
          </div>
        )}
             </div>

      </div>

      {/* Detail Modal */} 
      {selectedArtist && (
        <ArtistDetail 
          artist={selectedArtist} 
          onClose={handleCloseDetail}
        />
      )}
      
      {/* Share Modal */} 
      <ShareModal 
          artist={selectedArtistShare}
          timeFrameMonths={shareModalTimeFrame} 
          isOpen={!!selectedArtistShare}
          onClose={handleCloseShare}
      />

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="icon">
            <X className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogTitle>Add Artist</DialogTitle>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Input
                type="url"
                placeholder="Enter Spotify Artist URL..."
                value={newArtistUrl}
                onChange={(e) => setNewArtistUrl(e.target.value)}
                required
                disabled={createMutation.isPending}
              />
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Adding...' : 'Add Artist'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
    </TooltipProvider>
  );
};

export default Index;
