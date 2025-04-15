import { executeQuery } from './connection.js';
import { format, subMonths } from 'date-fns'; // Import date-fns functions at the top

// Define constants for table names (Keep necessary ones)
const ARTIST_CARD_TABLE = 'us_labels_sandbox.arya_s.ARTIST_CARDS';
const ARTIST_SONGS_TABLE = 'us_labels_sandbox.arya_s.ARTIST_SONGS';
const SONG_DAILY_STREAM_METRICS_TABLE = 'us_labels_sandbox.arya_s.SONG_DAILY_STREAM_METRICS';
const ARTIST_UGC_LINKS_TABLE = 'us_labels_sandbox.arya_s.ARTIST_UGC_LINKS';
const TIKTOK_SOUND_METRICS_TABLE = 'sodatone.sodatone.tiktok_sound_metrics';

// Define the structure for the returned daily stream data
export interface DailySongStreamData {
    unifiedSongId: number;
    metricDate: string;
    usStreams: number;
    songName?: string | null;
}

// Fetches daily streams for a specific artist/song combo
export const getDailySongStreamsForArtist = async (
    artistCardId: number,
    daysLookback: number,
    unifiedSongId: number | null
): Promise<DailySongStreamData[]> => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysLookback);
    const startDateString = startDate.toISOString().split('T')[0];
    const logPrefix = `[getDailySongStreamsForArtist]`;
    
    // Query the correct metrics table
    // Note: This table might not have ARTIST_CARD_ID, adjust WHERE clause if needed.
    // Assuming the task correctly puts data for relevant songs here.
    let sql = `
        SELECT 
            UNIFIED_SONG_ID as unifiedSongId, 
            METRIC_DATE as metricDate, 
            US_STREAMS as usStreams
            -- We might need to JOIN with ARTIST_SONGS or another table if SONG_NAME is needed
            -- and not present in SONG_DAILY_STREAM_METRICS
        FROM ${SONG_DAILY_STREAM_METRICS_TABLE} -- Using the correct table name constant
        WHERE METRIC_DATE >= ? 
        -- Filter directly by unifiedSongId if provided
        ${unifiedSongId ? 'AND UNIFIED_SONG_ID = ?' : 
           '-- If unifiedSongId is null, we might need a subquery to get all relevant song IDs for the artistCardId'}
        ORDER BY METRIC_DATE DESC, UNIFIED_SONG_ID;
    `;
    
    // Bind parameters - Corrected logic
    let binds: (string | number)[];
    if (unifiedSongId) { 
        // Only bind startDateString and unifiedSongId when song is specified
        binds = [startDateString, unifiedSongId]; 
    } else {
        // If unifiedSongId is null, the query needs modification to fetch songs for the artistCardId.
        // This requires joining or a subquery involving ARTIST_SONGS or ARTIST_CARDS.
        // For now, this will likely return nothing if unifiedSongId is null.
        // Placeholder: Log a warning.
        console.warn(`${logPrefix} Fetching all songs (unifiedSongId=null) might not work correctly with SONG_DAILY_STREAM_METRICS table structure.`);
        // We might need to fetch relevant song IDs first, then query the metrics table.
        // Example (Conceptual - needs refinement):
        // 1. Fetch song IDs: SELECT UNIFIED_SONG_ID FROM ARTIST_SONGS WHERE ARTIST_ID = ? -- (using artistCardId)
        // 2. Modify SQL: WHERE METRIC_DATE >= ? AND UNIFIED_SONG_ID IN (<?>, <?>...) 
        // For now, return empty array to prevent errors until query is refined.
        return []; 
    }

    try {
        console.log(`${logPrefix} Generated SQL: ${sql.replace(/\s+/g, ' ').trim()}`);
        console.log(`${logPrefix} Executing query on ${SONG_DAILY_STREAM_METRICS_TABLE} with binds:`, binds); // Log corrected binds
        const results = await executeQuery<any>(sql, binds); // Use <any> for now, refine later if needed
        console.log(`${logPrefix} Raw results from executeQuery:`, JSON.stringify(results)); // Log raw results
        console.log(`${logPrefix} Query successful. Rows fetched: ${results.length}`);
        
        // Fix the mapping to correctly handle the uppercase field names
        const mappedResults = results.map(row => {
            // Get date as YYYY-MM-DD format regardless of its source format
            let dateStr;
            if (typeof row.METRICDATE === 'string') {
                // If it's a string, just take first 10 chars (YYYY-MM-DD)
                dateStr = row.METRICDATE.substring(0, 10);
            } else if (row.METRICDATE instanceof Date) {
                // If it's a Date object, format it as YYYY-MM-DD
                dateStr = row.METRICDATE.toISOString().split('T')[0];
            } else {
                // Fallback
                console.warn(`[getDailySongStreamsForArtist] Unexpected date format: ${row.METRICDATE}`);
                dateStr = '2025-01-01'; // Fallback date
            }
            
            // Now create proper ISO date string
            const isoDateStr = `${dateStr}T00:00:00.000Z`;
            
            return {
                unifiedSongId: row.UNIFIEDSONGID,
                metricDate: isoDateStr,
                songName: `Song ID: ${row.UNIFIEDSONGID}`,  // Default song name based on ID
                usStreams: row.USSTREAMS
            };
        });
        
        console.log(`${logPrefix} Mapped results:`, JSON.stringify(mappedResults)); // Log mapped results
        return mappedResults;
    } catch (error) {
        console.error(`${logPrefix} Error fetching daily song streams for unifiedSongId ${unifiedSongId} (Artist Card ID ${artistCardId}):`, error);
        return [];
    }
};

/* // Removing this function as we won't show a historical chart for "All Songs" for now
// --- ADD Function to get TOTAL daily streams for an ARTIST ---
// Define the expected return structure for the raw query result
interface RawArtistDailyStream {
  METRICDATE: string; // Snowflake returns date string
  TOTALUSSTREAMS: number;
}

export const getArtistDailyStreams = async (artistId: number, daysLookback: number): Promise<{ metricDate: Date, totalUsStreams: number }[]> => {
  // ... function implementation ...
};
*/

// --- ADD Function to get HISTORICAL WEEKLY streams for an ARTIST from Luminate Data ---
// Define the expected return structure for the raw query result
interface RawArtistWeeklyStream {
  WEEKDATE: string; // Snowflake returns date string
  WEEKLYUSSTREAMS: number;
}

export const getArtistWeeklyStreamsHistory = async (numericAccountId: number, weeksLookback: number): Promise<{ weekDate: Date, weeklyUsStreams: number }[]> => {
  console.log(`[getArtistWeeklyStreamsHistory START] Fetching weekly history for Acc ID: ${numericAccountId}, Lookback: ${weeksLookback} weeks`);
  console.time(`[getArtistWeeklyStreamsHistory TIME] Acc ID: ${numericAccountId}`);

  const LUMINATE_ACCOUNTS_TABLE = 'sodatone.sodatone.luminate_accounts';

  // Query Luminate table for historical weekly data
  // Assuming UPDATED_AT represents the week ending date or close enough for charting
  // Order by UPDATED_AT and take the top N rows based on weeksLookback
  const query = `
    WITH RankedWeeks AS (
      SELECT
        UPDATED_AT::DATE AS WEEKDATE,
        US_THIS_PERIOD AS WEEKLYUSSTREAMS,
        ROW_NUMBER() OVER (PARTITION BY SPOTIFY_ACCOUNT_ID ORDER BY UPDATED_AT DESC) as rn
      FROM ${LUMINATE_ACCOUNTS_TABLE}
      WHERE SPOTIFY_ACCOUNT_ID = ?
        AND US_THIS_PERIOD IS NOT NULL
    )
    SELECT 
      WEEKDATE,
      WEEKLYUSSTREAMS
    FROM RankedWeeks
    WHERE rn <= ?
    ORDER BY WEEKDATE ASC; -- Order ascending for charting
  `;

  try {
    // Use the executeQuery helper
    const rawResults = await executeQuery<RawArtistWeeklyStream>(query, [numericAccountId, weeksLookback]);
    console.timeEnd(`[getArtistWeeklyStreamsHistory TIME] Acc ID: ${numericAccountId}`);
    
    // Map the raw results to the desired output structure with Date objects
    const results = rawResults.map(row => ({
      weekDate: new Date(row.WEEKDATE + 'T00:00:00'), // Ensure correct date parsing
      weeklyUsStreams: Number(row.WEEKLYUSSTREAMS)
    }));

    console.log(`[getArtistWeeklyStreamsHistory END] Fetched ${results.length} weekly stream history points for Acc ID: ${numericAccountId}`);
    return results;
  } catch (err) {
    console.error(`Error fetching weekly stream history for Acc ID ${numericAccountId}:`, err);
    return []; 
  }
};


// --- Function to list all artist cards ---
// Define Artist type structure (replace with actual if different)
export interface Artist { 
    ID: number;
    NAME: string;
    NUMERIC_ACCOUNT_ID: number;
    IMAGE_URL_LARGE: string;
    US_METRICS_THIS_WEEK: number | null;
    US_METRICS_PERCENT_CHANGE: number | null;
    LATEST_UGC_POST_COUNT: number | null;
    LATEST_UGC_PERCENT_CHANGE: number | null;
    // Add other fields returned by SELECT *
}
export const listArtistCards = async (): Promise<Artist[]> => {
    const query = `SELECT * FROM ${ARTIST_CARD_TABLE} ORDER BY NAME ASC`;
    console.log('[listArtistCards] Fetching all artist cards...');
    try {
        const results = await executeQuery<Artist>(query);
        console.log(`[listArtistCards] Fetched ${results.length} artist cards.`);
        return results;
    } catch (error) {
        console.error('[listArtistCards] Error fetching artist cards:', error);
        return [];
    }
};

// --- Function to get songs for an artist ---
export interface ArtistSongInfo {
  unifiedSongId: number;
  spotifyTrackId: number; 
  name: string | null;
}
export const getArtistSongs = async (artistId: number): Promise<ArtistSongInfo[]> => {
    // Removed aliases as they might not be respected, will map manually
    const query = `SELECT UNIFIED_SONG_ID, SPOTIFY_TRACK_ID, NAME 
                   FROM ${ARTIST_SONGS_TABLE} WHERE ARTIST_CARD_ID = ? ORDER BY NAME ASC`; 
    console.log(`[getArtistSongs] Fetching songs for artist ID: ${artistId}`);
    try {
        // Fetch raw results (assuming uppercase keys)
        const rawResults = await executeQuery<any>(query, [artistId]); 
        console.log(`[getArtistSongs] Found ${rawResults.length} raw song rows for artist ID: ${artistId}`);

        // Manually map to the ArtistSongInfo interface (camelCase)
        const mappedResults: ArtistSongInfo[] = rawResults.map(row => ({
            unifiedSongId: row.UNIFIED_SONG_ID, // Map from uppercase
            spotifyTrackId: row.SPOTIFY_TRACK_ID, // Map from uppercase
            name: row.NAME // NAME is likely uppercase too
        }));

        console.log(`[getArtistSongs] Mapped ${mappedResults.length} songs for artist ID: ${artistId}`);
        return mappedResults; // Return the correctly mapped array
    } catch (error) {
        console.error(`[getArtistSongs] Error fetching songs for artist ${artistId}:`, error);
        return [];
    }
};

// --- Function to get UGC links for an artist --- 
export interface ArtistUgcLink {
  ID: number;
  ARTIST_CARD_ID: number;
  TIKTOK_SOUND_ID: number; 
  TIKTOK_SOUND_NAME: string | null;
  UNIFIED_SONG_ID: number | null;
}
export const getUgcLinksForArtist = async (artistId: number, unifiedSongId: number | null): Promise<ArtistUgcLink[]> => {
    let query = `SELECT * FROM ${ARTIST_UGC_LINKS_TABLE} WHERE ARTIST_CARD_ID = ?`;
    const binds: (string | number)[] = [artistId];
    if (unifiedSongId !== null) {
        query += ' AND UNIFIED_SONG_ID = ?';
        binds.push(unifiedSongId);
    }
    query += ' ORDER BY ID DESC'; // Example ordering
    console.log(`[getUgcLinksForArtist] Fetching UGC links for artist ${artistId}${unifiedSongId ? ', song ' + unifiedSongId : ''}`);
    try {
        const results = await executeQuery<ArtistUgcLink>(query, binds);
        console.log(`[getUgcLinksForArtist] Found ${results.length} UGC links.`);
        return results;
    } catch (error) {
        console.error(`[getUgcLinksForArtist] Error fetching UGC links:`, error);
        return [];
    }
};

// --- Function to get Detailed UGC time series --- 
export interface DetailedUgcData { 
  [key: string]: Array<{ DATE: string; VALUE: number | null }>; 
}
export const getDetailedUgcTimeSeriesForArtist = async (artistId: number, months: number): Promise<DetailedUgcData> => {
    const { startDate, endDate } = getIsoDateRange(months); // Assuming getIsoDateRange is defined
    const query = `
        SELECT 
            aul.TIKTOK_SOUND_ID::STRING as soundId, 
            tm.CREATED_AT::STRING as date, -- Use CREATED_AT from the correct table
            tm.POST_COUNT as value
        FROM ${ARTIST_UGC_LINKS_TABLE} aul
        JOIN ${TIKTOK_SOUND_METRICS_TABLE} tm ON aul.TIKTOK_SOUND_ID = tm.TIKTOK_SOUND_ID
        WHERE aul.ARTIST_CARD_ID = ? 
          AND tm.CREATED_AT::DATE BETWEEN ? AND ? -- Filter using CREATED_AT::DATE
        ORDER BY soundId, date;
    `;
    console.log(`[getDetailedUgcTimeSeriesForArtist] Fetching detailed UGC for artist ${artistId} from ${startDate} to ${endDate}`);
    try {
        // Update the type hint here to expect UPPERCASE keys from the database
        const flatResults = await executeQuery<{ SOUNDID: string; DATE: string; VALUE: number | null; }>(query, [artistId, startDate, endDate]);
        // Group results by soundId
        const groupedResults: DetailedUgcData = {};
        flatResults.forEach(row => {
            // Access the sound ID using the likely uppercase property name from the DB result
            const soundIdKey = row.SOUNDID || 'unknown_sound'; // Use row.SOUNDID (uppercase)
            if (!groupedResults[soundIdKey]) {
                groupedResults[soundIdKey] = [];
            }
            // Push object with uppercase keys, using the correct uppercase source props from the DB result
            groupedResults[soundIdKey].push({ DATE: row.DATE, VALUE: row.VALUE }); 
        });
        console.log(`[getDetailedUgcTimeSeriesForArtist] Processed detailed UGC data for ${Object.keys(groupedResults).length} sounds.`);
        return groupedResults;
    } catch (error) {
        console.error(`[getDetailedUgcTimeSeriesForArtist] Error fetching detailed UGC:`, error);
        throw error; // Re-throw the error so the caller knows something failed
    }
};

// Helper function (ensure it's defined if used by getDetailedUgcTimeSeriesForArtist)
const getIsoDateRange = (monthsAgo: number): { startDate: string; endDate: string } => {
    const endDate = new Date();
    const startDate = subMonths(endDate, monthsAgo);
    return {
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
    };
  };

// --- Function to add a UGC link ---
// Add export
export interface AddUgcLinkPayload {
    artistId: number;
    soundId: string;
    soundName?: string;
    unifiedSongId?: number;
}
// Add export
export const addUgcLink = async (payload: AddUgcLinkPayload): Promise<{ success: boolean; message: string }> => {
    const { artistId, soundId, soundName, unifiedSongId } = payload;
    // Basic validation
    if (!artistId || !soundId) {
        return { success: false, message: 'Artist ID and Sound ID are required.' };
    }
    const soundIdNum = parseInt(soundId, 10);
    if (isNaN(soundIdNum)) {
         return { success: false, message: 'Invalid Sound ID format.' };
    }

    // TODO: Add check if link already exists?

    const query = `
        INSERT INTO us_labels_sandbox.arya_s.ARTIST_UGC_LINKS 
          (ARTIST_CARD_ID, TIKTOK_SOUND_ID, TIKTOK_SOUND_NAME, UNIFIED_SONG_ID)
        VALUES (?, ?, ?, ?)
    `; // Use constant if defined or hardcode
    const binds = [artistId, soundIdNum, soundName || null, unifiedSongId || null];
    console.log(`[addUgcLink] Adding link for artist ${artistId}, sound ${soundIdNum}`);
    try {
        await executeQuery(query, binds); // Assuming executeQuery handles INSERTs
        console.log(`[addUgcLink] Successfully added UGC link.`);
        return { success: true, message: 'Link added successfully.' };
    } catch (error: any) {
        console.error(`[addUgcLink] Error adding UGC link:`, error);
        return { success: false, message: error.message || 'Failed to add link.' };
    }
};

// --- Function to get Reactivity Scores for multiple songs ---
export interface SongReactivityScore {
    unifiedSongId: number;
    correlation: number | null;
    grade: string;
    calculatedAt: Date;
}

export const getReactivityScores = async (
    unifiedSongIds: number[], 
    region: string,
    monthsLookback: number
): Promise<Record<number, SongReactivityScore>> => {
    const logPrefix = '[getReactivityScores]';
    if (!unifiedSongIds || unifiedSongIds.length === 0) {
        console.log(`${logPrefix} No song IDs provided, returning empty object.`);
        return {};
    }

    // Constructing the placeholders for the IN clause dynamically
    const placeholders = unifiedSongIds.map(() => '?').join(','); 
    const REACTIVITY_TABLE = 'us_labels_sandbox.arya_s.SONG_REACTIVITY_SCORES';

    const query = `
        SELECT 
            UNIFIED_SONG_ID,
            CORRELATION,
            GRADE,
            CALCULATED_AT
        FROM ${REACTIVITY_TABLE}
        WHERE UNIFIED_SONG_ID IN (${placeholders})
          AND REGION = ?
          AND CALCULATION_RANGE_MONTHS = ?;
    `;

    const binds = [...unifiedSongIds, region, monthsLookback];
    console.log(`${logPrefix} Fetching scores for ${unifiedSongIds.length} songs, Region: ${region}, Months: ${monthsLookback}`);

    try {
        const results = await executeQuery<any>(query, binds); // Use <any> temporarily
        console.log(`${logPrefix} Found ${results.length} score rows.`);

        // Map results to a Record keyed by unifiedSongId
        const scoresBySongId: Record<number, SongReactivityScore> = {};
        results.forEach(row => {
            scoresBySongId[row.UNIFIED_SONG_ID] = {
                unifiedSongId: row.UNIFIED_SONG_ID,
                correlation: row.CORRELATION,
                grade: row.GRADE,
                calculatedAt: new Date(row.CALCULATED_AT)
            };
        });
        return scoresBySongId;

    } catch (error) {
        console.error(`${logPrefix} Error fetching reactivity scores:`, error);
        return {}; // Return empty object on error
    }
}; 