import { executeQuery } from './connection.js';

/**
 * Interface representing the mapping between Spotify's internal track ID
 * and Luminate's unified song ID.
 */
export interface LuminateUnifiedSongSpotifyTrack {
  SPOTIFY_TRACK_ID: number; // Links to ID in spotify_tracks table
  UNIFIED_SONG_ID: number;
}

// Note: Double-check spelling 'spotfiy' vs 'spotify' if issues arise.
const UNIFIED_SONG_MAPPING_TABLE = 'sodatone.sodatone.luminate_unified_song_spotify_tracks';

/**
 * Fetches the Luminate Unified Song IDs for a given list of Spotify Track IDs.
 * Assumes SPOTIFY_TRACK_ID in this table maps to the ID column (PK) in the spotify_tracks table.
 *
 * @param spotifyTrackIds An array of Spotify track IDs (numeric primary keys from spotify_tracks).
 * @returns A promise that resolves with a Map where keys are Spotify Track IDs
 *          and values are the corresponding Luminate Unified Song IDs.
 */
export async function getUnifiedSongIdsBySpotifyTrackIds(
  spotifyTrackIds: number[]
): Promise<Map<number, number>> {
  if (!spotifyTrackIds || spotifyTrackIds.length === 0) {
    return new Map();
  }

  // Snowflake doesn't directly support array binding in IN clauses like some other DBs.
  // We need to construct the placeholders dynamically.
  const placeholders = spotifyTrackIds.map(() => '?').join(',');
  const sqlText = `
    SELECT
      SPOTIFY_TRACK_ID,
      UNIFIED_SONG_ID
    FROM ${UNIFIED_SONG_MAPPING_TABLE}
    WHERE SPOTIFY_TRACK_ID IN (${placeholders});
  `;

  try {
    const results = await executeQuery<LuminateUnifiedSongSpotifyTrack>(sqlText, spotifyTrackIds);
    const mapping = new Map<number, number>();
    results.forEach((row: LuminateUnifiedSongSpotifyTrack) => {
      mapping.set(row.SPOTIFY_TRACK_ID, row.UNIFIED_SONG_ID);
    });
    console.log(`Fetched ${mapping.size} unified song ID mappings for ${spotifyTrackIds.length} track IDs.`);
    return mapping;
  } catch (error) {
    console.error(`Error fetching unified song IDs for Spotify track IDs:`, error);
    throw error; // Re-throw for higher-level handling
  }
}

// --- LUMINATE_DAILY_SONG_METRICS ---

// Interface based on the provided schema
export interface LuminateDailySongMetric {
  UNIFIED_SONG_ID: number;
  ARTIST: string | null;
  TITLE: string | null;
  METRIC_TYPE: string; // e.g., 'AUDIO ON DEMAND'
  REGION: string; // e.g., 'US', 'GLOBAL'
  DATE: Date; // Date object
  UPDATED_ON: Date | null;
  THIS_DAY: number | null;
  THIS_WEEK: number | null;
  LAST_WEEK: number | null;
  YEAR_TO_DATE: number | null;
  ACTIVITY_TO_DATE: number | null;
  YEAR: number | null;
  WEEK: number | null;
  WEEK_ID: string | null;
  END_OF_WEEK: boolean | null;
}

export type Region = 'US' | 'GLOBAL';

// Structure to hold the aggregated weekly comparison
export interface WeeklyMetricComparison {
  thisWeek: number | null;
  lastWeek: number | null;
}

// CONFIRM TABLE NAME: Replace with actual table name if different
const DAILY_METRICS_TABLE_NAME = 'sodatone.sodatone.luminate_daily_song_metrics';
const AUDIO_METRIC_TYPE = 'AUDIO ON DEMAND'; // As specified in PRD

/**
 * Fetches the latest 'THIS_WEEK' and 'LAST_WEEK' values for the 'AUDIO ON DEMAND'
 * metric for a given list of Unified Song IDs and region.
 * It assumes the latest DATE entry for a song/region/metric combo holds the correct weekly totals.
 *
 * @param unifiedSongIds An array of Luminate Unified Song IDs.
 * @param region The region to filter by ('US' or 'GLOBAL').
 * @returns A promise resolving to a Map<number, WeeklyMetricComparison> where the key is the Unified Song ID.
 */
export async function getWeeklyAudioMetricsByUnifiedSongIds(
  unifiedSongIds: number[],
  region: Region
): Promise<Map<number, WeeklyMetricComparison>> {
  const weeklyMetricsMap = new Map<number, WeeklyMetricComparison>();
  if (!unifiedSongIds || unifiedSongIds.length === 0) {
    return weeklyMetricsMap;
  }

  // Use ROW_NUMBER() to get the latest record per song/metric/region based on DATE
  // Construct placeholders for the IN clause
  const placeholders = unifiedSongIds.map(() => '?').join(',');

  const sqlText = `
    WITH RankedMetrics AS (
      SELECT
        UNIFIED_SONG_ID,
        THIS_WEEK,
        LAST_WEEK,
        ROW_NUMBER() OVER(PARTITION BY UNIFIED_SONG_ID, METRIC_TYPE, REGION ORDER BY DATE DESC) as rn
      FROM ${DAILY_METRICS_TABLE_NAME}
      WHERE UNIFIED_SONG_ID IN (${placeholders})
        AND METRIC_TYPE = ?
        AND REGION = ?
    )
    SELECT
      UNIFIED_SONG_ID,
      THIS_WEEK,
      LAST_WEEK
    FROM RankedMetrics
    WHERE rn = 1;
  `;

  // Combine song IDs with metric type and region for binding
  const binds = [...unifiedSongIds, AUDIO_METRIC_TYPE, region];

  try {
    // Define a type for the specific query result
    type WeeklyResult = {
        UNIFIED_SONG_ID: number;
        THIS_WEEK: number | null;
        LAST_WEEK: number | null;
    }

    const results = await executeQuery<WeeklyResult>(sqlText, binds);

    results.forEach((row: WeeklyResult) => {
      weeklyMetricsMap.set(row.UNIFIED_SONG_ID, {
        thisWeek: row.THIS_WEEK,
        lastWeek: row.LAST_WEEK,
      });
    });

    console.log(`Fetched latest weekly metrics for ${weeklyMetricsMap.size} songs in region ${region}.`);
    return weeklyMetricsMap;

  } catch (error) {
    console.error(`Error fetching weekly audio metrics for region ${region}:`, error);
    throw error; // Re-throw for higher-level handling
  }
}

// --- LUMINATE_ACCOUNTS (Fallback) ---

export interface LuminateAccount {
  ID: number;
  LUMINATE_ID: number | null;
  SPOTIFY_ACCOUNT_ID: number; // Key to link to artist
  LUMINATE_ID_UPDATED_AT: Date | null;
  CREATED_AT: Date | null;
  UPDATED_AT: Date | null;
  US_THIS_PERIOD: number | null;
  US_LAST_PERIOD: number | null;
  US_ACTIVITY_TO_DATE: number | null;
  US_PERIOD_PERCENT_GROWTH: number | null;
  US_CURRENT_YEAR: number | null;
  US_CURRENT_WEEK: number | null;
  GLOBAL_THIS_PERIOD: number | null;
  GLOBAL_LAST_PERIOD: number | null;
  GLOBAL_ACTIVITY_TO_DATE: number | null;
  GLOBAL_PERIOD_PERCENT_GROWTH: number | null;
  GLOBAL_CURRENT_YEAR: number | null;
  GLOBAL_CURRENT_WEEK: number | null;
}

// PLEASE VERIFY THIS TABLE PATH IS CORRECT
const ACCOUNTS_TABLE_NAME = 'sodatone.sodatone.luminate_accounts';

/**
 * Fetches the account-level weekly audio metrics ('THIS_PERIOD', 'LAST_PERIOD')
 * for a given Spotify Account ID and region. Used as a fallback.
 * Assumes the SPOTIFY_ACCOUNT_ID corresponds to the artist's primary Spotify ID.
 * Assumes these PERIOD metrics represent the 'AUDIO ON DEMAND' aggregation.
 *
 * @param spotifyAccountId The Spotify Account ID (e.g., PRIMARY_SPOTIFY_ACCOUNT_ID from tracks).
 * @param region The region ('US' or 'GLOBAL').
 * @returns A promise resolving to a WeeklyMetricComparison object or null if not found.
 */
export async function getWeeklyAudioMetricsBySpotifyAccountId(
  spotifyAccountId: number,
  region: Region
): Promise<WeeklyMetricComparison | null> {
  if (!spotifyAccountId) {
    console.error('Spotify Account ID is required for fallback metrics.');
    return null;
  }

  // Select the correct columns based on region
  const thisPeriodCol = region === 'US' ? 'US_THIS_PERIOD' : 'GLOBAL_THIS_PERIOD';
  const lastPeriodCol = region === 'US' ? 'US_LAST_PERIOD' : 'GLOBAL_LAST_PERIOD';

  const sqlText = `
    SELECT
      ${thisPeriodCol} as "thisWeek",
      ${lastPeriodCol} as "lastWeek"
    FROM ${ACCOUNTS_TABLE_NAME}
    WHERE SPOTIFY_ACCOUNT_ID = ?
    LIMIT 1;
  `;

  try {
    const results = await executeQuery<any>(sqlText, [spotifyAccountId]); // Use <any> for flexibility

    if (results.length > 0) {
      const rawResult = results[0];
      console.log(`Fetched fallback weekly metrics for Spotify Account ID ${spotifyAccountId} in region ${region}. Raw result: ${JSON.stringify(rawResult)}`);
      
      // Normalize the result keys to lowercase
      const normalizedResult: WeeklyMetricComparison = {
        thisWeek: rawResult.thisWeek ?? rawResult.THISWEEK ?? null,
        lastWeek: rawResult.lastWeek ?? rawResult.LASTWEEK ?? null
      };

      return normalizedResult;
    } else {
      console.log(`No fallback metrics found for Spotify Account ID ${spotifyAccountId} in region ${region}.`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching fallback weekly audio metrics for Spotify Account ID ${spotifyAccountId}, region ${region}:`, error);
    throw error; // Re-throw for higher-level handling
  }
}

// Add functions for other Luminate tables here later...

// --- Time Series Data ---

export interface TimeSeriesDatapoint {
    date: string; // YYYY-MM-DD format
    value: number | null;
}

/**
 * Fetches weekly time-series data for 'AUDIO ON DEMAND' metrics for a given set of Unified Song IDs.
 * Assumes the 'THIS_WEEK' value on rows where 'END_OF_WEEK' is TRUE represents the total for that week.
 *
 * @param unifiedSongIds An array of Luminate Unified Song IDs.
 * @param region The region ('US' or 'GLOBAL').
 * @param startDate The start date (inclusive) in 'YYYY-MM-DD' format.
 * @param endDate The end date (inclusive) in 'YYYY-MM-DD' format.
 * @returns A promise resolving to an array of TimeSeriesDatapoint objects, ordered by date.
 */
export async function getWeeklyTimeSeriesByUnifiedSongIds(
    unifiedSongIds: number[],
    region: Region,
    startDate: string,
    endDate: string
): Promise<TimeSeriesDatapoint[]> {

    if (!unifiedSongIds || unifiedSongIds.length === 0) {
        console.log('No Unified Song IDs provided for time series.');
        return [];
    }

    const placeholders = unifiedSongIds.map(() => '?').join(',');

    // Query uses DATE as the primary grouping/ordering key, assuming END_OF_WEEK=TRUE
    // marks the correct weekly total for the week ending on that DATE.
    const sqlText = `
        SELECT
            DATE::VARCHAR AS date,  -- Cast DATE to string in YYYY-MM-DD format
            SUM(THIS_WEEK) AS value -- Sum streams across all relevant songs for that week-ending date
        FROM ${DAILY_METRICS_TABLE_NAME}
        WHERE UNIFIED_SONG_ID IN (${placeholders})
          AND METRIC_TYPE = ?
          AND REGION = ?
          AND DATE BETWEEN ? AND ?
          AND END_OF_WEEK = TRUE -- Filter for week-ending rows
        GROUP BY DATE -- Group by the week-ending date
        ORDER BY DATE ASC; -- Order chronologically
    `;

    // Combine binds: song IDs, metric type, region, start date, end date
    const binds = [
        ...unifiedSongIds,
        'Streaming On-Demand Audio', // Corrected metric type
        region.toLowerCase(), // Convert region to lowercase for the SQL query
        startDate,
        endDate
    ];

    try {
        console.log(`Fetching weekly time series for ${unifiedSongIds.length} songs in ${region} from ${startDate} to ${endDate}`);
        const results = await executeQuery<TimeSeriesDatapoint>(sqlText, binds);
        console.log(`Found ${results.length} weekly data points.`);
        return results;
    } catch (error) {
        console.error(`Error fetching weekly time series for region ${region}:`, error);
        throw error; // Re-throw for higher-level handling
    }
}

// --- NEW: Function to fetch DAILY streaming time series for a SINGLE song ---

/**
 * Fetches daily time-series data for 'AUDIO ON DEMAND' metrics for a single Unified Song ID.
 * Uses the 'THIS_DAY' column for daily stream counts.
 *
 * @param unifiedSongId The Luminate Unified Song ID for the specific song.
 * @param region The region ('US' or 'GLOBAL').
 * @param startDate The start date (inclusive) in 'YYYY-MM-DD' format.
 * @param endDate The end date (inclusive) in 'YYYY-MM-DD' format.
 * @returns A promise resolving to an array of TimeSeriesDatapoint objects, ordered by date.
 */
export async function getDailyStreamingTimeSeriesByUnifiedSongId(
    unifiedSongId: number,
    region: Region,
    startDate: string,
    endDate: string
): Promise<TimeSeriesDatapoint[]> {

    if (!unifiedSongId) {
        console.log('[DailySongStreams] No Unified Song ID provided.');
        return [];
    }

    const sqlText = `
        SELECT
            DATE::VARCHAR AS date,  -- Cast DATE to string in YYYY-MM-DD format
            THIS_DAY AS value     -- Select the daily stream count
        FROM ${DAILY_METRICS_TABLE_NAME} -- sodatone.sodatone.luminate_daily_song_metrics
        WHERE UNIFIED_SONG_ID = ?      -- Filter by the specific song ID
          AND METRIC_TYPE = ?          -- Filter by the audio metric type
          AND REGION = ?               -- Filter by region
          AND DATE BETWEEN ? AND ?     -- Filter by date range
        ORDER BY DATE ASC;             -- Order chronologically
    `;

    // Combine binds: song ID, metric type, region, start date, end date
    const binds = [
        unifiedSongId,
        'Streaming On-Demand Audio', // <<< USE THE SAME METRIC TYPE AS WEEKLY FUNCTION
        region.toLowerCase(), // Convert region to lowercase for the SQL query
        startDate,
        endDate
    ];

    try {
        console.log(`[DailySongStreams] Fetching daily streams for song ${unifiedSongId} in ${region} from ${startDate} to ${endDate}`);
        // Ensure the return type matches { date: string, value: number | null }
        type DailyQueryResult = { date: string; value: number | null };
        const results = await executeQuery<DailyQueryResult>(sqlText, binds);
        console.log(`[DailySongStreams] Found ${results.length} daily data points for song ${unifiedSongId}.`);
        // Map results to ensure correct structure, handling potential nulls in value
        return results.map(row => { 
            // Ensure we access the keys as returned by the Snowflake driver (likely uppercase)
            return {
                date: (row as any).DATE, 
                value: (row as any).VALUE ?? null 
            };
        });
    } catch (error) {
        console.error(`[DailySongStreams] Error fetching daily streams for song ${unifiedSongId} in ${region}:`, error);
        throw error; // Re-throw for higher-level handling
    }
}