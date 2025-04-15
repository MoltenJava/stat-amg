import {
    getSpotifyAccountBySpotifyId,
    getTrackIdsBySpotifyAccountId,
    SpotifyAccount,
    getUnifiedSongIdsBySpotifyTrackIds,
    getWeeklyAudioMetricsByUnifiedSongIds,
    getWeeklyAudioMetricsBySpotifyAccountId,
    WeeklyMetricComparison,
    Region,
    getUgcLinksForArtist
} from '../data/index.js';
import { getWeeklyTimeSeriesByUnifiedSongIds, TimeSeriesDatapoint } from '../data/luminate.js';
import { getTikTokTimeSeriesBySoundIds, getDetailedTikTokTimeSeriesBySoundIds } from '../data/tiktok.js';

/**
 * Extracts the Spotify Artist ID from various Spotify URL formats.
 * Handles URLs like:
 * - https://open.spotify.com/artist/ARTIST_ID
 * - https://open.spotify.com/artist/ARTIST_ID?si=...
 * @param url The Spotify Artist URL.
 * @returns The extracted Artist ID string, or null if not found/invalid URL.
 */
function extractSpotifyArtistIdFromUrl(url: string): string | null {
    try {
        const urlObject = new URL(url);
        // Check if the hostname is open.spotify.com
        if (urlObject.hostname !== 'open.spotify.com') {
            console.warn(`URL hostname is not open.spotify.com: ${urlObject.hostname}`);
            return null;
        }
        // Split the pathname and find the 'artist' segment
        const pathSegments = urlObject.pathname.split('/');
        const artistIndex = pathSegments.indexOf('artist');
        if (artistIndex !== -1 && pathSegments.length > artistIndex + 1) {
            const artistId = pathSegments[artistIndex + 1];
            // Basic validation: Spotify IDs are typically alphanumeric
            if (artistId && /^[a-zA-Z0-9]+$/.test(artistId)) {
                 console.log(`Extracted Artist ID: ${artistId}`);
                 return artistId;
            } else {
                console.warn(`Invalid Artist ID format found: ${artistId}`);
                return null;
            }
        }
    } catch (error) {
        // Handle cases where the input string is not a valid URL
        if (error instanceof TypeError) {
            console.warn(`Invalid URL provided: ${url}`);
        } else {
            console.error(`Error parsing Spotify URL: ${url}`, error);
        }
        return null;
    }
    console.warn(`Could not extract Artist ID from URL: ${url}`);
    return null;
}

// --- NEW Return Structure ---
export interface ArtistData {
    spotifyArtistId: string; // Alphanumeric ID from URL
    numericAccountId: number; // Numeric ID from spotify_accounts table
    name: string | null;
    imageUrlLarge: string | null;
    trackIds: number[]; // Array of numeric SPOTIFY_TRACK_IDs
}

/**
 * Fetches core artist data (details and track IDs) based on a Spotify Artist URL.
 *
 * @param artistUrl The URL of the Spotify artist profile.
 * @returns A promise resolving to an ArtistData object, or null if the URL is invalid or the artist isn't found.
 * @throws Rethrows errors from the data access layer.
 */
export async function getArtistDataByUrl(artistUrl: string): Promise<ArtistData | null> {
    // 1. Extract string artist ID from URL
    const spotifyArtistId = extractSpotifyArtistIdFromUrl(artistUrl);
    if (!spotifyArtistId) {
        console.error(`Could not get valid Spotify Artist ID from URL: ${artistUrl}`);
        return null;
    }

    try {
        // 2. Get numeric account ID and artist details from spotify_accounts table
        console.log(`Fetching account details for Spotify Artist ID: ${spotifyArtistId}`);
        const account: SpotifyAccount | null = await getSpotifyAccountBySpotifyId(spotifyArtistId);

        if (!account) {
            console.warn(`No account found in spotify_accounts for Spotify Artist ID: ${spotifyArtistId}`);
            return null;
        }

        const numericAccountId = account.ID;
        console.log(`Found numeric Account ID: ${numericAccountId} for Artist ID: ${spotifyArtistId}`);

        // 3. Get associated track IDs using the numeric account ID
        console.log(`Fetching track IDs for numeric Account ID: ${numericAccountId}`);
        const trackIds: number[] = await getTrackIdsBySpotifyAccountId(numericAccountId);
        console.log(`Found ${trackIds.length} track IDs for Account ID: ${numericAccountId}`);

        // 4. Assemble and return the result
        const artistData: ArtistData = {
            spotifyArtistId: spotifyArtistId,
            numericAccountId: numericAccountId,
            name: account.NAME,
            imageUrlLarge: account.IMAGE_URL_LARGE,
            trackIds: trackIds,
        };

        return artistData;

    } catch (error) {
        console.error(`Error processing artist URL ${artistUrl}:`, error);
        throw error; // Re-throw to allow higher-level handling
    }
}

/**
 * Maps an array of Spotify Track IDs (numeric) to Luminate Unified Song IDs.
 *
 * @param trackIds An array of numeric Spotify Track IDs (from spotify_account_tracks).
 * @returns A promise resolving to a Map where keys are Spotify Track IDs and values are Luminate Unified Song IDs.
 *          Tracks without a mapping will not be included in the map.
 * @throws Rethrows errors from the data access layer.
 */
async function mapTrackIdsToUnifiedIds(trackIds: number[]): Promise<Map<number, number>> {
    if (!trackIds || trackIds.length === 0) {
        console.log("No track IDs provided for mapping to unified IDs.");
        return new Map();
    }

    try {
        console.log(`Mapping ${trackIds.length} Spotify track IDs to Unified Song IDs...`);
        const unifiedIdMap = await getUnifiedSongIdsBySpotifyTrackIds(trackIds);
        console.log(`Successfully mapped ${unifiedIdMap.size} track IDs.`);
        // Log which tracks couldn't be mapped (optional debug)
        if (trackIds.length !== unifiedIdMap.size) {
             const unmappedIds = trackIds.filter(id => !unifiedIdMap.has(id));
             console.warn(`Could not find Unified Song ID mapping for ${unmappedIds.length} Spotify Track IDs:`, unmappedIds);
        }
        return unifiedIdMap;
    } catch (error) {
        console.error(`Error mapping Spotify Track IDs to Unified Song IDs:`, error);
        throw error;
    }
}

/**
 * Aggregates weekly streaming data (AUDIO ON DEMAND) for a list of Unified Song IDs.
 *
 * @param unifiedSongIds An array of Luminate Unified Song IDs for the artist's tracks.
 * @param region The region ('US' or 'GLOBAL') for which to fetch metrics.
 * @returns A promise resolving to a WeeklyMetricComparison object containing the sum of
 *          'thisWeek' and 'lastWeek' streams across all provided unified song IDs.
 *          Returns { thisWeek: 0, lastWeek: 0 } if no IDs are provided or no metrics found.
 * @throws Rethrows errors from the data access layer.
 */
async function aggregateTrackStreamingData(
    unifiedSongIds: number[],
    region: Region
): Promise<WeeklyMetricComparison> {
    // Internal accumulator with definite number types
    const accumulator = { thisWeek: 0, lastWeek: 0 };

    if (!unifiedSongIds || unifiedSongIds.length === 0) {
        console.log("No Unified Song IDs provided for streaming aggregation.");
        // Return type allows null, but we return 0 here
        return { thisWeek: 0, lastWeek: 0 };
    }

    try {
        console.log(`Fetching weekly audio metrics for ${unifiedSongIds.length} unified song IDs in region ${region}...`);
        // Fetch metrics for all songs at once
        const weeklyMetricsMap = await getWeeklyAudioMetricsByUnifiedSongIds(unifiedSongIds, region);

        console.log(`Aggregating metrics for ${weeklyMetricsMap.size} songs found...`);
        // Sum the metrics from the map
        for (const comparison of weeklyMetricsMap.values()) {
            // comparison.thisWeek can be null, accumulator.thisWeek is number
            accumulator.thisWeek += comparison.thisWeek ?? 0;
            accumulator.lastWeek += comparison.lastWeek ?? 0;
        }

        console.log(`Aggregated Track Metrics (${region}): This Week = ${accumulator.thisWeek}, Last Week = ${accumulator.lastWeek}`);
        // Assign the final numbers back to the return type structure
        return {
             thisWeek: accumulator.thisWeek,
             lastWeek: accumulator.lastWeek
        };

    } catch (error) {
        console.error(`Error aggregating streaming data for region ${region}:`, error);
        throw error;
    }
}

/**
 * Provides artist-level fallback metrics if track-level aggregation is empty.
 *
 * @param trackAggregatedMetrics The aggregated metrics calculated from tracks.
 * @param numericAccountId The numeric Spotify Account ID for the artist.
 * @param region The region ('US' or 'GLOBAL').
 * @returns A promise resolving to the track metrics if they are non-zero,
 *          otherwise resolves to the artist-level fallback metrics.
 *          Returns { thisWeek: 0, lastWeek: 0 } if fallback also fails.
 * @throws Rethrows errors from the data access layer.
 */
async function getMetricsWithFallback(
    trackAggregatedMetrics: WeeklyMetricComparison,
    numericAccountId: number,
    region: Region
): Promise<WeeklyMetricComparison> {
    // Check if track-level metrics are essentially empty (consider 0 or null as empty)
    const trackMetricsAreEmpty = (trackAggregatedMetrics.thisWeek ?? 0) === 0 &&
                                 (trackAggregatedMetrics.lastWeek ?? 0) === 0;

    if (trackMetricsAreEmpty) {
        console.warn(`Track-level metrics for Account ID ${numericAccountId} (${region}) are empty. Attempting artist-level fallback.`);
        try {
            const fallbackMetrics = await getWeeklyAudioMetricsBySpotifyAccountId(numericAccountId, region);
            
            // Add this log to inspect the received object structure
            console.log(`Received fallback object in getMetricsWithFallback:`, JSON.stringify(fallbackMetrics));

            if (fallbackMetrics) {
                console.log(`Using fallback metrics for Account ID ${numericAccountId} (${region}): This Week = ${fallbackMetrics.thisWeek}, Last Week = ${fallbackMetrics.lastWeek}`);
                // Ensure we return non-null values if possible, defaulting to 0
                return {
                    thisWeek: fallbackMetrics.thisWeek ?? 0,
                    lastWeek: fallbackMetrics.lastWeek ?? 0
                };
            } else {
                console.warn(`Artist-level fallback metrics not found for Account ID ${numericAccountId} (${region}). Returning zeros.`);
                 // Return zeros if fallback also fails
                return { thisWeek: 0, lastWeek: 0 };
            }
        } catch (error) {
             console.error(`Error fetching fallback metrics for Account ID ${numericAccountId} (${region}):`, error);
             throw error; // Re-throw error
        }
    } else {
        // Track metrics are valid, return them (ensure nulls are handled if necessary for consistency, though aggregateTrackStreamingData returns 0)
        console.log(`Using track-level aggregated metrics for Account ID ${numericAccountId} (${region}).`);
        return {
            thisWeek: trackAggregatedMetrics.thisWeek ?? 0, // Should already be 0 from previous step if null
            lastWeek: trackAggregatedMetrics.lastWeek ?? 0 // Should already be 0 from previous step if null
        };
    }
}

/**
 * Calculates the percentage change between two numbers.
 * Handles division by zero.
 *
 * @param current The current value.
 * @param previous The previous value.
 * @returns The percentage change (e.g., 0.1 for 10%), or null if previous value is 0 or null.
 */
function calculatePercentageChange(current: number | null, previous: number | null): number | null {
    const currentVal = current ?? 0;
    const previousVal = previous ?? 0;

    if (previousVal === 0) {
        // Avoid division by zero. Return null or potentially Infinity/large number depending on desired behavior.
        // Returning null indicates change is undefined or infinitely large.
        return null;
    }

    return (currentVal - previousVal) / previousVal;
}

// --- Final Response Structure ---
export interface ArtistMetricsResponse {
    artist: {
        spotifyArtistId: string;
        numericAccountId: number;
        name: string | null;
        imageUrlLarge: string | null;
    };
    metrics: {
        region: Region;
        thisWeek: number;
        lastWeek: number;
        percentageChange: number | null; // e.g., 0.1 for 10%, null if undefined
    };
    // We might add UGC metrics here later based on other tasks
}

/**
 * Orchestrates the fetching and calculation of artist streaming metrics for a given URL and region.
 *
 * @param artistUrl The URL of the Spotify artist profile.
 * @param region The region ('US' or 'GLOBAL') for metrics.
 * @returns A promise resolving to the ArtistMetricsResponse object, or null if the artist data cannot be processed.
 * @throws Rethrows errors from underlying service or data access functions.
 */
export async function getArtistStreamingMetrics(
    artistUrl: string,
    region: Region
): Promise<ArtistMetricsResponse | null> {
    try {
        // 1. Get Artist Details and Track IDs
        const artistData = await getArtistDataByUrl(artistUrl);
        if (!artistData) {
            return null; // Error already logged by getArtistDataByUrl
        }

        // 2. Map Track IDs to Unified IDs
        const unifiedIdMap = await mapTrackIdsToUnifiedIds(artistData.trackIds);
        const unifiedSongIds = Array.from(unifiedIdMap.values()); // Get just the unified IDs

        // 3. Aggregate Streaming Data from Tracks
        const trackAggregatedMetrics = await aggregateTrackStreamingData(unifiedSongIds, region);

        // 4. Apply Fallback Logic if necessary
        const finalMetrics = await getMetricsWithFallback(
            trackAggregatedMetrics,
            artistData.numericAccountId,
            region
        );

        // 5. Calculate Percentage Change
        const percentageChange = calculatePercentageChange(finalMetrics.thisWeek, finalMetrics.lastWeek);

        // 6. Format Response
        const response: ArtistMetricsResponse = {
            artist: {
                spotifyArtistId: artistData.spotifyArtistId,
                numericAccountId: artistData.numericAccountId,
                name: artistData.name,
                imageUrlLarge: artistData.imageUrlLarge,
            },
            metrics: {
                region: region,
                thisWeek: finalMetrics.thisWeek ?? 0, // Ensure non-null for response type
                lastWeek: finalMetrics.lastWeek ?? 0, // Ensure non-null for response type
                percentageChange: percentageChange,
            },
        };

        console.log(`Successfully generated metrics for ${artistData.name || artistData.spotifyArtistId} (${region})`);
        return response;

    } catch (error) {
        console.error(`Failed to get complete artist streaming metrics for URL ${artistUrl} (${region}):`, error);
        // Depending on desired error handling, you might return null or re-throw
        return null; // Return null to indicate failure at this top level
    }
}

// --- New Time Series Function ---
/**
 * Fetches weekly streaming time series data for a given artist URL and region/date range.
 *
 * @param artistUrl The URL of the Spotify artist profile.
 * @param region The region ('US' or 'GLOBAL') for metrics.
 * @param startDate Start date in 'YYYY-MM-DD' format.
 * @param endDate End date in 'YYYY-MM-DD' format.
 * @returns A promise resolving to an array of TimeSeriesDatapoint objects, or null if artist data cannot be processed.
 * @throws Rethrows errors from underlying service or data access functions.
 */
export async function getArtistStreamingTimeSeries(
    artistUrl: string,
    region: Region,
    startDate: string,
    endDate: string
): Promise<TimeSeriesDatapoint[] | null> {
    console.log(`[TimeSeries] Starting for URL: ${artistUrl}, Region: ${region}, Start: ${startDate}, End: ${endDate}`); // Log inputs
    try {
        // 1. Get Artist Details and Track IDs
        const artistData = await getArtistDataByUrl(artistUrl);
        if (!artistData || !artistData.trackIds || artistData.trackIds.length === 0) {
             console.warn(`[TimeSeries] No artist data or track IDs found for URL ${artistUrl}. Returning empty array.`); // Log empty artist data
            return []; // Return empty array if no tracks to query
        }
        console.log(`[TimeSeries] Found artist: ${artistData.name} (ID: ${artistData.numericAccountId}) with ${artistData.trackIds.length} track IDs.`); // Log artist found

        // 2. Map Track IDs to Unified IDs
        const unifiedIdMap = await mapTrackIdsToUnifiedIds(artistData.trackIds);
        const unifiedSongIds = Array.from(unifiedIdMap.values());
        if (unifiedSongIds.length === 0) {
            console.warn(`[TimeSeries] No Unified Song IDs mapped for artist ${artistData.name || artistUrl}. Returning empty array.`); // Log empty mapping
            return []; // Return empty array if no unified IDs found
        }
        console.log(`[TimeSeries] Mapped to ${unifiedSongIds.length} Unified Song IDs: [${unifiedSongIds.slice(0, 10).join(', ')}${unifiedSongIds.length > 10 ? '...' : ''}]`); // Log mapped IDs (sample)

        // 3. Fetch Time Series Data using the new data layer function
        console.log(`[TimeSeries] Calling getWeeklyTimeSeriesByUnifiedSongIds with ${unifiedSongIds.length} IDs, Region: ${region}, Start: ${startDate}, End: ${endDate}`); // Log call to data layer
        const timeSeries = await getWeeklyTimeSeriesByUnifiedSongIds(
            unifiedSongIds,
            region,
            startDate,
            endDate
        );

        console.log(`Successfully fetched ${timeSeries.length} time series data points for ${artistData.name || artistUrl} (${region})`);
        return timeSeries;

    } catch (error) {
        console.error(`Failed to get time series metrics for URL ${artistUrl} (${region}):`, error);
        // Return null or re-throw based on desired top-level error handling
        return null; 
    }
}

// --- NEW UGC Time Series Function ---
/**
 * Fetches daily UGC (TikTok post count) time series data for a given artist card ID and date range.
 *
 * @param artistCardId The numeric ID of the artist card.
 * @param startDate Start date in 'YYYY-MM-DD' format.
 * @param endDate End date in 'YYYY-MM-DD' format.
 * @returns A promise resolving to an array of TimeSeriesDatapoint objects, or null if an error occurs.
 *          Returns an empty array if no linked TikTok sounds are found or no data exists for those sounds/dates.
 * @throws Rethrows errors from underlying service or data access functions.
 */
export async function getArtistUgcTimeSeries(
    artistCardId: number,
    startDate: string,
    endDate: string
): Promise<TimeSeriesDatapoint[] | null> {
    console.log(`[UgcTimeSeries] Starting for ArtistCard ID: ${artistCardId}, Start: ${startDate}, End: ${endDate}`);
    try {
        // 1. Get linked TikTok Sound IDs for the Artist Card
        const ugcLinks = await getUgcLinksForArtist(artistCardId);
        if (!ugcLinks || ugcLinks.length === 0) {
            console.log(`[UgcTimeSeries] No UGC links (TikTok sounds) found for ArtistCard ID: ${artistCardId}. Returning empty array.`);
            return [];
        }

        // TIKTOK_SOUND_ID from ArtistUgcLink interface is now number (internal ID)
        const internalTikTokSoundIds = ugcLinks.map(link => link.TIKTOK_SOUND_ID);
        console.log(`[UgcTimeSeries] Found ${internalTikTokSoundIds.length} linked internal TikTok Sound IDs: [${internalTikTokSoundIds.slice(0, 10).join(', ')}${internalTikTokSoundIds.length > 10 ? '...' : ''}]`);

        // 2. Fetch time series data for these internal sound IDs
        const timeSeries = await getTikTokTimeSeriesBySoundIds(
            internalTikTokSoundIds, // Pass number[]
            startDate,
            endDate
        );

        console.log(`[UgcTimeSeries] Successfully fetched ${timeSeries.length} daily UGC data points for ArtistCard ID: ${artistCardId}`);
        return timeSeries; // Already in { date: string, value: number | null } format

    } catch (error) {
        console.error(`[UgcTimeSeries] Failed to get UGC time series for ArtistCard ID ${artistCardId}:`, error);
        return null; // Return null to indicate failure at the service level
    }
}

// --- NEW Detailed UGC Time Series Function ---

/** Structure for the response of the detailed UGC time series endpoint */
interface DetailedUgcTimeSeriesResponse {
    soundTimeSeries: { // Key is the TikTok Sound ID (as string for JSON compatibility)
        [key: string]: { date: string; value: number | null }[];
    };
}

/**
 * Fetches detailed daily UGC (TikTok post count) time series data for a given artist card ID,
 * broken down by individual TikTok sound.
 *
 * @param artistCardId The numeric ID of the artist card.
 * @param startDate Start date in 'YYYY-MM-DD' format.
 * @param endDate End date in 'YYYY-MM-DD' format.
 * @returns A promise resolving to a DetailedUgcTimeSeriesResponse object, or null if an error occurs.
 *          Returns { soundTimeSeries: {} } if no linked sounds or data found.
 */
export async function getArtistUgcTimeSeriesDetails(
    artistCardId: number,
    startDate: string,
    endDate: string
): Promise<DetailedUgcTimeSeriesResponse | null> {
    console.log(`[DetailedUgcTimeSeries] Starting for ArtistCard ID: ${artistCardId}, Start: ${startDate}, End: ${endDate}`);
    try {
        // 1. Get linked TikTok Sound IDs for the Artist Card
        const ugcLinks = await getUgcLinksForArtist(artistCardId);
        if (!ugcLinks || ugcLinks.length === 0) {
            console.log(`[DetailedUgcTimeSeries] No UGC links found for ArtistCard ID: ${artistCardId}. Returning empty object.`);
            return { soundTimeSeries: {} }; // Return empty structure
        }

        const internalTikTokSoundIds = ugcLinks.map(link => link.TIKTOK_SOUND_ID);
        console.log(`[DetailedUgcTimeSeries] Found ${internalTikTokSoundIds.length} linked internal TikTok Sound IDs.`);

        // 2. Fetch detailed, non-aggregated time series data using the new data layer function
        const flatTimeSeries = await getDetailedTikTokTimeSeriesBySoundIds(
            internalTikTokSoundIds,
            startDate,
            endDate
        );

        if (!flatTimeSeries || flatTimeSeries.length === 0) {
            console.log(`[DetailedUgcTimeSeries] No detailed time series data found for the linked sounds in the date range.`);
            return { soundTimeSeries: {} }; // Return empty structure if no data points
        }

        // 3. Transform the flat list into a nested structure keyed by sound ID
        const detailedResponse: DetailedUgcTimeSeriesResponse = { soundTimeSeries: {} };

        for (const point of flatTimeSeries) {
            const soundIdStr = point.tiktokSoundId.toString(); // Use string key for JSON
            if (!detailedResponse.soundTimeSeries[soundIdStr]) {
                detailedResponse.soundTimeSeries[soundIdStr] = []; // Initialize array if first time seeing this sound ID
            }
            // Add the data point (without the sound ID itself)
            detailedResponse.soundTimeSeries[soundIdStr].push({ date: point.date, value: point.value });
        }

        console.log(`[DetailedUgcTimeSeries] Successfully processed detailed UGC data for ArtistCard ID: ${artistCardId}`);
        return detailedResponse;

    } catch (error) {
        console.error(`[DetailedUgcTimeSeries] Failed to get detailed UGC time series for ArtistCard ID ${artistCardId}:`, error);
        return null;
    }
}

// --- NEW TikTok URL Parser ---
interface TikTokSoundDetailsFromUrl {
    tiktokSoundId: string;
    tiktokSoundName: string | null;
}

/**
 * Extracts the TikTok Sound ID and Name from various TikTok URL formats.
 * Handles URLs like:
 * - https://www.tiktok.com/music/Sound-Name-SOUND_ID
 * - https://www.tiktok.com/music/Sound-Name-SOUND_ID?si=...&lang=en
 * @param url The TikTok Sound URL.
 * @returns An object containing the extracted sound ID (as string) and name, or null if not found/invalid.
 */
export function extractTikTokSoundDetailsFromUrl(url: string): TikTokSoundDetailsFromUrl | null {
    try {
        const urlObject = new URL(url);
        // Check hostname
        if (urlObject.hostname !== 'www.tiktok.com') {
            console.warn(`[TikTokParser] URL hostname is not www.tiktok.com: ${urlObject.hostname}`);
            return null;
        }
        // Pathname should be like /music/Sound-Name-SOUND_ID
        const pathSegments = urlObject.pathname.split('/');
        if (pathSegments.length < 3 || pathSegments[1] !== 'music' || !pathSegments[2]) {
            console.warn(`[TikTokParser] Unexpected path structure: ${urlObject.pathname}`);
            return null;
        }

        const soundPart = pathSegments[2];
        // Find the last hyphen, the ID should follow it
        const lastHyphenIndex = soundPart.lastIndexOf('-');
        if (lastHyphenIndex === -1 || lastHyphenIndex === soundPart.length - 1) {
             console.warn(`[TikTokParser] Could not find sound ID separator '-' in path segment: ${soundPart}`);
            return null;
        }

        const soundIdStr = soundPart.substring(lastHyphenIndex + 1);
        const soundName = soundPart.substring(0, lastHyphenIndex).replace(/-/g, ' '); // Replace hyphens with spaces for name

        // Validate ID is numeric string
        if (/^\d+$/.test(soundIdStr)) {
             console.log(`[TikTokParser] Extracted Sound ID: ${soundIdStr}, Name: ${soundName}`);
             return {
                 tiktokSoundId: soundIdStr,
                 tiktokSoundName: soundName || null
             };
        } else {
            console.warn(`[TikTokParser] Invalid Sound ID format found (non-numeric): ${soundIdStr}`);
            return null;
        }

    } catch (error) {
        if (error instanceof TypeError) {
            console.warn(`[TikTokParser] Invalid URL provided: ${url}`);
        } else {
            console.error(`[TikTokParser] Error parsing TikTok URL: ${url}`, error);
        }
        return null;
    }
}

// --- Placeholders for subsequent subtasks ---
// function formatMetricsResponse(...) { ... } 