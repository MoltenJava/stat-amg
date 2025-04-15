import {
    ArtistSongInfo,
    DailySongStreamData,
    DetailedUgcData,
    SongReactivityScore,
    getArtistSongs,
    getDailySongStreamsForArtist, // Fetches streams for ONE song, or maybe needs modification for artist?
    getDetailedUgcTimeSeriesForArtist, // Fetches UGC for ONE artist
    getReactivityScores // Fetches scores for specific songs
} from '../data/artistDetailData.js';

// Import functions for fetching artist card data (including the one by ID)
import { 
    ArtistCard as Artist, // Use ArtistCard interface, alias as Artist for consistency here
    getArtistCardById 
} from '../data/artistCardData.js';

// --- Report Data Structures ---

// Export ReportSongDetail if needed elsewhere, otherwise keep it internal
interface ReportSongDetail {
    info: ArtistSongInfo;
    dailyStreams?: DailySongStreamData[]; // e.g., last 60 days
    reactivityScore?: SongReactivityScore;
    // UGC data might be aggregated at artist level, or fetched per sound later
}

// Export the main ReportData interface
export interface ReportData {
    artist: Artist; // Need to fetch single artist details
    songs: ReportSongDetail[];
    ugcTimeSeries?: DetailedUgcData; // Artist-level UGC
    generationDate: Date;
    // Add more fields as needed: time range, summaries etc.
}

// --- Main Service Function ---

/**
 * Fetches and aggregates all necessary data for generating a report.
 * @param artistId The ID of the primary artist for the report.
 * @param songIds Optional array of specific song IDs to include. If empty/null, includes all artist songs.
 * @returns A Promise resolving to the structured ReportData or null if artist not found.
 */
export const generateReportData = async (
    artistId: number,
    songIds: number[] | null | undefined
): Promise<ReportData | null> => {
    const logPrefix = `[generateReportData Artist: ${artistId}]`;
    console.log(`${logPrefix} Starting data aggregation... Songs specified: ${songIds?.length ? songIds.join(', ') : 'All'}`);
    const REPORT_TIMEFRAME_DAYS = 60; // How far back to fetch daily data
    const REACTIVITY_TIMEFRAME_MONTHS = 1; // Matches job calculation timeframe
    const REACTIVITY_REGION = 'US'; // Matches job calculation region

    try {
        // 1. Fetch Artist Details
        const artist = await getArtistCardById(artistId);
        if (!artist) {
            console.error(`${logPrefix} Artist not found.`);
            return null;
        }
        console.log(`${logPrefix} Fetched artist details: ${artist.NAME}`);

        // 2. Fetch Relevant Songs
        const allArtistSongs = await getArtistSongs(artistId);
        const songsToInclude = songIds && songIds.length > 0
            ? allArtistSongs.filter(s => songIds.includes(s.unifiedSongId))
            : allArtistSongs;
        const songIdsToFetch = songsToInclude.map(s => s.unifiedSongId);
        console.log(`${logPrefix} Processing ${songsToInclude.length} songs out of ${allArtistSongs.length} total.`);

        // 3. Fetch Reactivity Scores for relevant songs
        const reactivityScores = await getReactivityScores(songIdsToFetch, REACTIVITY_REGION, REACTIVITY_TIMEFRAME_MONTHS);
        console.log(`${logPrefix} Fetched ${Object.keys(reactivityScores).length} reactivity scores.`);

        // 4. Fetch Detailed UGC Time Series for the artist (e.g., last 2 months for context)
        // Note: getDetailedUgcTimeSeriesForArtist aggregates by sound ID
        const ugcTimeSeries = await getDetailedUgcTimeSeriesForArtist(artistId, 2);
        console.log(`${logPrefix} Fetched UGC time series for ${Object.keys(ugcTimeSeries).length} sounds.`);

        // 5. Fetch Daily Streams for each included song (can be slow, consider parallelization)
        const songDetails: ReportSongDetail[] = [];
        for (const songInfo of songsToInclude) {
            console.log(`${logPrefix} Fetching streams for song: ${songInfo.unifiedSongId} (${songInfo.name})`);
            // Assuming getDailySongStreamsForArtist works correctly for single song ID
            const dailyStreams = await getDailySongStreamsForArtist(artistId, REPORT_TIMEFRAME_DAYS, songInfo.unifiedSongId);
            songDetails.push({
                info: songInfo,
                dailyStreams: dailyStreams,
                reactivityScore: reactivityScores[songInfo.unifiedSongId] // Add score if found
            });
        }
        console.log(`${logPrefix} Finished fetching daily streams for ${songDetails.length} songs.`);

        // 6. Construct final report data object
        const reportData: ReportData = {
            artist: artist,
            songs: songDetails,
            ugcTimeSeries: ugcTimeSeries,
            generationDate: new Date()
        };

        console.log(`${logPrefix} Data aggregation complete.`);
        return reportData;

    } catch (error) {
        console.error(`${logPrefix} Error during data aggregation:`, error);
        throw error; // Re-throw the error to be handled by the router
    }
}; 