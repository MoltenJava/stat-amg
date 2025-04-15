import * as ss from 'simple-statistics';
import { getDailyStreamingTimeSeriesByUnifiedSongId, TimeSeriesDatapoint, Region } from '../data/luminate.js';
export type { Region };
// Import function to get UGC links
import { getUgcLinksForArtist, ArtistUgcLinkDetailed } from '../data/artistCardData.js';
// Import the function to get aggregated UGC time series by sound IDs
import { getTikTokTimeSeriesBySoundIds } from '../data/tiktok.js';
import { executeQuery } from '../data/connection.js'; // Added import

// Define the grading scale
type ReactivityGrade = 'A' | 'B' | 'C' | 'D' | 'N/A';

interface ReactivityResult {
    correlation: number | null;
    grade: ReactivityGrade;
}

/**
 * Aligns two time series datasets by date, padding missing dates with null.
 * Assumes input arrays are sorted by date.
 */
const alignTimeSeries = (
    series1: TimeSeriesDatapoint[],
    series2: TimeSeriesDatapoint[],
    startDate: string,
    endDate: string
): { alignedValues1: (number | null)[]; alignedValues2: (number | null)[] } => {
    const map1 = new Map(series1.map(p => [p.date, p.value]));
    const map2 = new Map(series2.map(p => [p.date, p.value]));
    const alignedValues1: (number | null)[] = [];
    const alignedValues2: (number | null)[] = [];

    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    let current = start;

    while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        alignedValues1.push(map1.get(dateStr) ?? null);
        alignedValues2.push(map2.get(dateStr) ?? null);
        current.setUTCDate(current.getUTCDate() + 1); // Increment day
    }

    return { alignedValues1, alignedValues2 };
};

/**
 * Maps a correlation coefficient to a grade.
 */
const mapCorrelationToGrade = (correlation: number | null): ReactivityGrade => {
    if (correlation === null) return 'N/A';
    if (correlation > 0.9) return 'A'; // A: > 0.9
    if (correlation > 0.8) return 'B'; // B: > 0.8 to 0.9
    if (correlation > 0.7) return 'C'; // C: > 0.7 to 0.8
    return 'D'; // D: <= 0.7
};

/**
 * Calculates the reactivity score (correlation grade) between daily streaming 
 * and daily UGC posts for a specific song over a given period.
 * 
 * @param artistId The internal artist ID (from ARTIST_CARDS table).
 * @param unifiedSongId The Luminate Unified Song ID.
 * @param region The region ('US' or 'GLOBAL').
 * @param startDate Start date ('YYYY-MM-DD').
 * @param endDate End date ('YYYY-MM-DD').
 * @returns A promise resolving to the ReactivityResult.
 */
export async function calculateSongReactivity(
    artistId: number,
    unifiedSongId: number,
    region: Region,
    startDate: string,
    endDate: string
): Promise<ReactivityResult> {
    console.log(`[Reactivity] Calculating for Artist ${artistId}, Song ${unifiedSongId}, Region: ${region}, Dates: ${startDate} to ${endDate}`);
    
    try {
        // 1. Fetch Streaming Data
        const streamingData = await getDailyStreamingTimeSeriesByUnifiedSongId(
            unifiedSongId,
            region,
            startDate,
            endDate
        );
        console.log(`[Reactivity] Fetched ${streamingData.length} daily streaming data points.`);

        // 2. Fetch UGC Data
        // 2a. Find linked TikTok Sound IDs for the specific song
        const ugcLinks: ArtistUgcLinkDetailed[] = await getUgcLinksForArtist(artistId, unifiedSongId);
        const tiktokSoundIds = ugcLinks.map(link => link.TIKTOK_SOUND_ID);
        console.log(`[Reactivity] Found ${tiktokSoundIds.length} linked TikTok Sound IDs: [${tiktokSoundIds.join(', ')}]`);

        let ugcData: TimeSeriesDatapoint[] = [];
        if (tiktokSoundIds.length > 0) {
            // 2b. Fetch aggregated daily time series for these sound IDs
            ugcData = await getTikTokTimeSeriesBySoundIds(
                tiktokSoundIds,
                startDate,
                endDate
            );
            console.log(`[Reactivity] Fetched ${ugcData.length} aggregated daily UGC data points.`);
        } else {
            console.log(`[Reactivity] No linked TikTok sounds found for song ${unifiedSongId}, UGC data will be empty.`);
        }

        // 3. Align Data
        const { alignedValues1: alignedStreams, alignedValues2: alignedUgc } = alignTimeSeries(
            streamingData,
            ugcData,
            startDate,
            endDate
        );

        // Prepare data for correlation calculation (replace nulls with 0 or handle differently?)
        // simple-statistics correlation functions might ignore pairs with nulls, 
        // but let's filter them explicitly for clarity.
        const streamValues: number[] = [];
        const ugcValues: number[] = [];

        for (let i = 0; i < alignedStreams.length; i++) {
            if (alignedStreams[i] !== null && alignedUgc[i] !== null) {
                streamValues.push(alignedStreams[i] as number);
                ugcValues.push(alignedUgc[i] as number);
            }
        }
        
        console.log(`[Reactivity] Aligned data points ready for correlation: ${streamValues.length}`);

        // 4. Calculate Correlation
        let correlation: number | null = null;
        if (streamValues.length > 1 && ugcValues.length > 1) { // Need at least 2 points for correlation
             try {
                 correlation = ss.sampleCorrelation(streamValues, ugcValues);
                 // Check for NaN which can occur if variance is zero (all values the same)
                 if (isNaN(correlation)) {
                     console.warn(`[Reactivity] Correlation resulted in NaN (likely zero variance in one or both series). Treating as 0 correlation.`);
                     correlation = 0; 
                 }
             } catch (error) {
                 console.error(`[Reactivity] Error calculating correlation:`, error);
                 correlation = null; // Set to null on calculation error
             }
        } else {
            console.log(`[Reactivity] Not enough overlapping data points (${streamValues.length}) to calculate correlation.`);
        }
        console.log(`[Reactivity] Calculated Pearson correlation: ${correlation}`);

        // 5. Map to Grade
        const grade = mapCorrelationToGrade(correlation);
        console.log(`[Reactivity] Mapped to Grade: ${grade}`);

        return { correlation, grade };

    } catch (error) {
        console.error(`[Reactivity] Failed to calculate reactivity for artist ${artistId}, song ${unifiedSongId}:`, error);
        return { correlation: null, grade: 'N/A' };
    }
} 

// --- Define TopReactiveSong Interface (matches DB query result structure) ---
interface TopReactiveSong {
  rank: number;
  unifiedSongId: number;
  songName: string | null;
  artistId: number;
  artistName: string | null;
  correlation: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'N/A';
}

/**
 * Fetches the top N reactive songs from the pre-calculated database table.
 *
 * @param limit The maximum number of songs to return.
 * @param region The region to filter scores by (defaults to 'US').
 * @returns A promise resolving to an array of TopReactiveSong objects.
 */
export async function getTopReactiveSongs(limit: number, region: Region = 'US'): Promise<TopReactiveSong[]> {
    console.log(`[Service getTopReactiveSongs] Fetching top ${limit} songs for region ${region} from DB.`);

    // Note: Assumes your table is named SONG_REACTIVITY_SCORES in us_labels_sandbox.arya_s
    const sqlText = `
        SELECT
            ROW_NUMBER() OVER (ORDER BY CORRELATION DESC NULLS LAST) as "rank",
            UNIFIED_SONG_ID as "unifiedSongId",
            SONG_NAME as "songName",
            ARTIST_CARD_ID as "artistId",
            ARTIST_NAME as "artistName",
            CORRELATION as "correlation",
            GRADE as "grade"
        FROM us_labels_sandbox.arya_s.SONG_REACTIVITY_SCORES
        WHERE REGION = ? 
          AND GRADE <> 'N/A' -- Only include songs where calculation succeeded
        ORDER BY "rank" ASC
        LIMIT ?;
    `;
    const binds = [ region, limit ];

    try {
        // Ensure executeQuery returns results matching the select statement aliases
        const results = await executeQuery<any>(sqlText, binds); 

        // Map results to ensure correct types and casing for the interface
        return results.map((row: any) => ({
            rank: row.rank ?? row.RANK, // RANK comes from ROW_NUMBER()
            unifiedSongId: Number(row.unifiedSongId ?? row.UNIFIEDSONGID),
            songName: row.songName ?? row.SONGNAME,
            artistId: Number(row.artistId ?? row.ARTISTCARDID),
            artistName: row.artistName ?? row.ARTISTNAME,
            correlation: row.correlation === null ? null : Number(row.correlation ?? row.CORRELATION),
            grade: (row.grade ?? row.GRADE) as ('A' | 'B' | 'C' | 'D' | 'N/A'), // Assert the type
        }));

    } catch (error) {
        console.error(`[Service getTopReactiveSongs] Error fetching from DB:`, error);
        return []; // Return empty array on error
    }
} 