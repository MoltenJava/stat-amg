import { executeQuery } from './connection.js';
import { TimeSeriesDatapoint } from './luminate.js'; // Assuming shared type

// --- Simple In-Memory Cache for TikTok ID Lookups ---
// Stores: externalTikTokId (string) -> internal ID (number | null)
const tiktokIdCache = new Map<string, number | null>();
// Optional: Add cache clearing logic if needed (e.g., based on time or memory)
// ----------------------------------------------------

// Interface for the table row
export interface TikTokSoundMetric {
  TIKTOK_SOUND_ID: number;
  CREATED_AT: Date;
  POST_COUNT: number | null;
  tiktokSoundName?: string | null;
  artistTikTokHandle?: string | null;
  isrc?: string | null;
}

// Interface for the result comparison
export interface TikTokWeeklyPostComparison {
  thisWeekPosts: number | null;
  lastWeekPosts: number | null;
}

const TABLE_NAME = 'sodatone.sodatone.tiktok_sound_metrics';
const TIKTOK_SOUNDS_TABLE = 'sodatone.sodatone.TIKTOK_SOUNDS';

/**
 * Fetches the latest post count and the post count from approx. 7 days prior
 * for a list of TikTok Sound IDs.
 *
 * @param tiktokSoundIds An array of TikTok Sound IDs.
 * @returns A promise resolving to a Map<number, TikTokWeeklyPostComparison> where the key is the TikTok Sound ID.
 */
export async function getWeeklyTikTokPostCounts(
  tiktokSoundIds: number[]
): Promise<Map<number, TikTokWeeklyPostComparison>> {
  const weeklyPostCountsMap = new Map<number, TikTokWeeklyPostComparison>();
  if (!tiktokSoundIds || tiktokSoundIds.length === 0) {
    return weeklyPostCountsMap;
  }

  // Construct placeholders for the IN clause
  const placeholders = tiktokSoundIds.map(() => '?').join(',');
  // Need to repeat placeholders for the subquery join condition
  const binds = [...tiktokSoundIds, ...tiktokSoundIds];

  // This query finds the latest record (CurrentWeek) and the latest record
  // that is older than 7 days before the latest record (PreviousWeek)
  const sqlText = `
    WITH LatestRecord AS (
        SELECT
            TIKTOK_SOUND_ID,
            POST_COUNT,
            CREATED_AT,
            ROW_NUMBER() OVER (PARTITION BY TIKTOK_SOUND_ID ORDER BY CREATED_AT DESC) as rn
        FROM ${TABLE_NAME}
        WHERE TIKTOK_SOUND_ID IN (${placeholders})
    ),
    CurrentWeek AS (
        SELECT TIKTOK_SOUND_ID, POST_COUNT, CREATED_AT
        FROM LatestRecord
        WHERE rn = 1
    ),
    PreviousWeekCandidates AS (
         SELECT
            s.TIKTOK_SOUND_ID,
            s.POST_COUNT,
            ROW_NUMBER() OVER (PARTITION BY s.TIKTOK_SOUND_ID ORDER BY s.CREATED_AT DESC) as rn_prev
        FROM ${TABLE_NAME} s
        JOIN CurrentWeek cw ON s.TIKTOK_SOUND_ID = cw.TIKTOK_SOUND_ID
        WHERE s.TIKTOK_SOUND_ID IN (${placeholders})
          AND s.CREATED_AT < DATEADD(day, -7, cw.CREATED_AT) -- Records older than 7 days before the current one
    ),
    PreviousWeek AS (
        SELECT TIKTOK_SOUND_ID, POST_COUNT
        FROM PreviousWeekCandidates
        WHERE rn_prev = 1 -- The latest among the older records
    )
    SELECT
        cw.TIKTOK_SOUND_ID,
        cw.POST_COUNT as thisWeekPosts,
        pw.POST_COUNT as lastWeekPosts
    FROM CurrentWeek cw
    LEFT JOIN PreviousWeek pw ON cw.TIKTOK_SOUND_ID = pw.TIKTOK_SOUND_ID;
  `;

  try {
    // Define a type for the specific query result
    type WeeklyResult = {
      TIKTOK_SOUND_ID: number;
      thisWeekPosts: number | null;
      lastWeekPosts: number | null;
    };

    const results = await executeQuery<WeeklyResult>(sqlText, binds);

    results.forEach((row: WeeklyResult) => {
      weeklyPostCountsMap.set(row.TIKTOK_SOUND_ID, {
        thisWeekPosts: row.thisWeekPosts,
        lastWeekPosts: row.lastWeekPosts,
      });
    });

    console.log(`Fetched weekly TikTok post counts for ${weeklyPostCountsMap.size} sound IDs.`);
    return weeklyPostCountsMap;

  } catch (error) {
    console.error(`Error fetching weekly TikTok post counts:`, error);
    throw error; // Re-throw for higher-level handling
  }
}

// Interface for details fetched from TIKTOK_SOUNDS table
export interface TikTokSoundDetails {
  TIKTOK_ID: number; // Corresponds to TIKTOK_SOUND_ID in other contexts
  NAME: string | null;
  AUTHOR: string | null;
  SPOTIFY_TRACK_ID: number | null;
}

/**
 * Fetches details (name, author, spotify_track_id) for a list of TikTok Sound IDs
 * from the TIKTOK_SOUNDS table.
 *
 * @param tiktokSoundIds An array of TikTok Sound IDs (matching TIKTOK_ID in the sounds table).
 * @returns A promise resolving to a Map<number, TikTokSoundDetails> where the key is the TikTok Sound ID.
 */
export async function getTikTokSoundDetails(
  tiktokSoundIds: number[]
): Promise<Map<number, TikTokSoundDetails>> {
  const soundDetailsMap = new Map<number, TikTokSoundDetails>();
  if (!tiktokSoundIds || tiktokSoundIds.length === 0) {
    console.log('No TikTok Sound IDs provided to getTikTokSoundDetails.');
    return soundDetailsMap;
  }

  const placeholders = tiktokSoundIds.map(() => '?').join(',');
  const binds = [...tiktokSoundIds];

  // Note: TIKTOK_SOUND_ID in our ArtistUgcLink corresponds to TIKTOK_ID in TIKTOK_SOUNDS
  const sqlText = `
    SELECT
      TIKTOK_ID,
      NAME,
      AUTHOR,
      SPOTIFY_TRACK_ID
    FROM ${TIKTOK_SOUNDS_TABLE}
    WHERE TIKTOK_ID IN (${placeholders})
  `;

  try {
    const results = await executeQuery<TikTokSoundDetails>(sqlText, binds);

    results.forEach((row) => {
      soundDetailsMap.set(row.TIKTOK_ID, {
        TIKTOK_ID: row.TIKTOK_ID,
        NAME: row.NAME,
        AUTHOR: row.AUTHOR, // This is likely the artist handle
        SPOTIFY_TRACK_ID: row.SPOTIFY_TRACK_ID
      });
    });

    console.log(`Fetched details for ${soundDetailsMap.size} TikTok sound IDs.`);
    return soundDetailsMap;

  } catch (error) {
    console.error(`Error fetching TikTok sound details for IDs [${tiktokSoundIds.join(', ')}]:`, error);
    throw error;
  }
}

/**
 * Fetches daily time-series data for TikTok post counts for a given set of Sound IDs.
 *
 * @param tiktokSoundIds An array of TikTok Sound IDs.
 * @param startDate The start date (inclusive) in 'YYYY-MM-DD' format.
 * @param endDate The end date (inclusive) in 'YYYY-MM-DD' format.
 * @returns A promise resolving to an array of TimeSeriesDatapoint objects, ordered by date.
 */
export async function getTikTokTimeSeriesBySoundIds(
    tiktokSoundIds: number[],
    startDate: string,
    endDate: string
): Promise<TimeSeriesDatapoint[]> {

    if (!tiktokSoundIds || tiktokSoundIds.length === 0) {
        console.log('[TikTokTimeSeries] No TikTok Sound IDs provided.');
        return [];
    }

    const placeholders = tiktokSoundIds.map(() => '?').join(',');

    // Query aggregates POST_COUNT daily across all provided sound IDs
    const sqlText = `
        SELECT
            CREATED_AT::DATE::VARCHAR AS date,  -- Group by day, cast to string
            SUM(POST_COUNT) AS value          -- Sum post counts for all relevant sounds per day
        FROM ${TABLE_NAME} -- sodatone.sodatone.tiktok_sound_metrics
        WHERE TIKTOK_SOUND_ID IN (${placeholders})
          AND CREATED_AT::DATE BETWEEN ? AND ? -- Filter by date range (casting CREATED_AT to DATE)
        GROUP BY CREATED_AT::DATE -- Group by the day
        ORDER BY date ASC;
    `;

    // Combine binds: sound IDs, start date, end date
    const binds = [
        ...tiktokSoundIds,
        startDate,
        endDate
    ];

    try {
        console.log(`[TikTokTimeSeries] Fetching daily post counts for ${tiktokSoundIds.length} sound IDs from ${startDate} to ${endDate}`);
        console.log('[TikTokTimeSeries] Executing SQL:', sqlText);
        console.log('[TikTokTimeSeries] With Binds:', binds);
        // Define expected result structure for type safety
        type QueryResult = { date: string; value: number | null };
        const results = await executeQuery<QueryResult>(sqlText, binds);
        console.log(`[TikTokTimeSeries] Found ${results.length} daily data points.`);
        // Map results to TimeSeriesDatapoint using the correct keys from the driver result
        return results.map(row => {
             // Use the ACTUAL keys returned by the driver (likely uppercase)
             return {
                 date: (row as any).DATE, // Access uppercase DATE
                 value: (row as any).VALUE ?? null // Access uppercase VALUE from SUM(), default to null
                };
            });
    } catch (error) {
        console.error(`[TikTokTimeSeries] Error fetching daily post counts:`, error);
        throw error; // Re-throw for higher-level handling
    }
}

/** Structure for detailed time series data point, including the sound ID */
interface DetailedTimeSeriesDatapoint {
    tiktokSoundId: number; // Changed name to avoid conflict with QueryResult type keys
    date: string;
    value: number | null;
}

/**
 * Fetches detailed daily TikTok post counts for multiple sound IDs without aggregation.
 *
 * @param tiktokSoundIds An array of internal numeric TikTok Sound IDs.
 * @param startDate The start date (inclusive) in 'YYYY-MM-DD' format.
 * @param endDate The end date (inclusive) in 'YYYY-MM-DD' format.
 * @returns A promise resolving to an array of DetailedTimeSeriesDatapoint objects.
 */
export async function getDetailedTikTokTimeSeriesBySoundIds(
    tiktokSoundIds: number[],
    startDate: string,
    endDate: string
): Promise<DetailedTimeSeriesDatapoint[]> {
    if (!tiktokSoundIds || tiktokSoundIds.length === 0) {
        console.log('[DetailedTikTokTimeSeries] No TikTok Sound IDs provided.');
        return [];
    }

    const placeholders = tiktokSoundIds.map(() => '?').join(',');

    // Query selects the raw POST_COUNT for each relevant sound ID per day
    // Includes TIKTOK_SOUND_ID in the selection
    const sqlText = `
        SELECT
            TIKTOK_SOUND_ID,                  -- Select the sound ID
            CREATED_AT::DATE::VARCHAR AS date,  -- Get the date
            POST_COUNT AS value               -- Select the cumulative POST_COUNT directly
        FROM ${TABLE_NAME} -- sodatone.sodatone.tiktok_sound_metrics
        WHERE TIKTOK_SOUND_ID IN (${placeholders})
          AND CREATED_AT::DATE BETWEEN ? AND ? -- Filter by date range
        ORDER BY TIKTOK_SOUND_ID, date ASC; -- Order for easier processing later
    `;

    const binds = [
        ...tiktokSoundIds,
        startDate,
        endDate
    ];

    try {
        console.log(`[DetailedTikTokTimeSeries] Fetching daily post counts for ${tiktokSoundIds.length} sound IDs from ${startDate} to ${endDate}`);
        // Define expected result structure for type safety, matching the SELECT statement
        // Using uppercase keys based on previous findings with the driver
        type QueryResultDetailed = { TIKTOK_SOUND_ID: number; DATE: string; VALUE: number | null };
        const results = await executeQuery<QueryResultDetailed>(sqlText, binds);
        console.log(`[DetailedTikTokTimeSeries] Found ${results.length} total daily data points across sounds.`);

        // Map results, using the correct uppercase keys from the driver
        return results.map(row => ({
            tiktokSoundId: row.TIKTOK_SOUND_ID,
            date: row.DATE,
            value: row.VALUE ?? null
        }));
    } catch (error) {
        console.error(`[DetailedTikTokTimeSeries] Error fetching detailed daily post counts:`, error);
        throw error;
    }
}

/**
 * Fetches the internal primary key ID from the TIKTOK_SOUNDS table
 * based on the external TikTok ID (from URL).
 *
 * @param externalTikTokId The large numeric ID extracted from a TikTok URL (as string).
 * @returns A promise resolving to the internal numeric ID or null if not found.
 */
export async function getInternalTikTokId(externalTikTokId: string): Promise<number | null> {
    // 1. Check cache first
    if (tiktokIdCache.has(externalTikTokId)) {
        console.log(`[TikTokLookup Cache HIT] Returning cached internal ID for external ${externalTikTokId}`);
        return tiktokIdCache.get(externalTikTokId) ?? null;
    }

    // 2. If not in cache, query the database (Cache Miss)
    console.log(`[TikTokLookup Cache MISS] Querying database for external TikTok ID ${externalTikTokId}`);
    const sqlText = `
        SELECT ID
        FROM ${TIKTOK_SOUNDS_TABLE}
        WHERE TIKTOK_ID = ?
        LIMIT 1;
    `;
    try {
        // Bind the external ID as a string, Snowflake will compare to NUMBER column
        const results = await executeQuery<{ ID: number }>(sqlText, [externalTikTokId]);
        let internalId: number | null = null;

        if (results.length > 0) {
            internalId = results[0].ID;
            console.log(`[TikTokLookup DB] Found internal ID ${internalId} for external TikTok ID ${externalTikTokId}`);
        } else {
            console.warn(`[TikTokLookup DB] No internal ID found for external TikTok ID ${externalTikTokId}`);
            internalId = null;
        }

        // 3. Store the result (found ID or null) in the cache
        tiktokIdCache.set(externalTikTokId, internalId);
        // Optional: Log cache size periodically if concerned about memory
        // if (tiktokIdCache.size % 100 === 0) { console.log(`[TikTokLookup Cache Size]: ${tiktokIdCache.size}`); }

        return internalId;

    } catch (error) {
        console.error(`[TikTokLookup DB Error] Error fetching internal ID for external TikTok ID ${externalTikTokId}:`, error);
        // Don't cache errors, just re-throw
        throw error;
    }
} 