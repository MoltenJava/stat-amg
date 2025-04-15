// src/api/artistCardsRouter.ts
import express, { Request, Response, Router, NextFunction } from 'express';
import apicache from 'apicache';
import { findOrCreateArtistCardByUrl, getArtistCardWithMetrics } from '../services/artistCardService.js';
import { 
    getArtistStreamingTimeSeries,
    getArtistUgcTimeSeries,
    getArtistUgcTimeSeriesDetails,
    extractTikTokSoundDetailsFromUrl
 } from '../services/artistMetricsService.js';
import { calculateSongReactivity } from '../services/analysisService.js';
import { 
    listArtistCards,
    addUgcLink,
    getUgcLinksForArtist,
    getSongsForArtist,
    deleteArtistCard,
    deleteUgcLink
 } from '../data/artistCardData.js';
import { 
    getDailyStreamingTimeSeriesByUnifiedSongId,
    Region, 
    TimeSeriesDatapoint 
 } from '../data/luminate.js';
import { getInternalTikTokId } from '../data/tiktok.js';
import { 
    getDailySongStreamsForArtist,
    DailySongStreamData
 } from '../data/artistDetailData.js';

// --- Initialize Cache ---
let cache = apicache.middleware;
// Cache successful responses for 1 hour by default
const cacheSuccesses = cache('1 hour');

// --- Helper for async routes ---
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next); // Catch async errors and pass to Express
  };
// ---

const router = Router();

// Middleware for JSON body parsing
router.use(express.json());

/**
 * POST /api/artist-cards
 * Creates a new artist card from a Spotify URL or finds the existing one.
 * Expects JSON body: { "spotifyUrl": "..." }
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
    const { spotifyUrl } = req.body;

    if (!spotifyUrl || typeof spotifyUrl !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid spotifyUrl in request body' });
    }

    try {
        const artistCard = await findOrCreateArtistCardByUrl(spotifyUrl);
        if (artistCard) {
            res.status(201).json(artistCard); // 201 Created (or 200 OK if found existing)
        } else {
            // This case implies findOrCreateArtistCardByUrl failed to get source data
            res.status(500).json({ error: 'Failed to fetch artist data to create card.' });
        }
    } catch (error) {
        console.error(`API Error POST /api/artist-cards:`, error);
        // Basic error handling, check if it's a known constraint violation (like unique ID)
        // Note: Snowflake error codes/messages might need specific parsing
        if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
             return res.status(409).json({ error: 'Conflict: Artist card potentially already exists (concurrent request?).' });
        }
        throw error; // Re-throw for the asyncHandler to catch
    }
}));

/**
 * GET /api/artist-cards
 * Lists all existing artist cards.
 */
router.get('/', cacheSuccesses, asyncHandler(async (_req: Request, res: Response) => {
    const artistCards = await listArtistCards();
    res.status(200).json(artistCards);
}));

/**
 * GET /api/artist-cards/:id
 * Gets a specific artist card by its numeric ID, including
 * potentially cached metrics for the specified region.
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
    // --- ID Validation ---
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid numeric ID provided in path.' });
    }

    // --- Region Validation ---
    const regionParam = req.query.region as string;
    if (!regionParam) {
         return res.status(400).json({ error: 'Missing required query parameter: region (e.g., ?region=US)' });
    }
    let region: Region; // Use original Region type ('US' | 'GLOBAL')
    if (regionParam.toUpperCase() === 'US') { // Keep comparison uppercase
        region = 'US';
    } else if (regionParam.toUpperCase() === 'GLOBAL') {
        region = 'GLOBAL';
    } else {
        return res.status(400).json({ error: 'Invalid region specified. Must be US or GLOBAL.' }); // Keep error message uppercase
    }

    // --- Call Service ---
    // No try-catch needed here, asyncHandler handles errors
    const artistCardWithMetrics = await getArtistCardWithMetrics(id, region);

    // --- Handle Response ---
    if (artistCardWithMetrics) {
        // Add log before sending response
        console.log(`Successfully retrieved card ID ${id}, sending JSON response...`);
        console.log(JSON.stringify(artistCardWithMetrics)); // Log the object being sent

        res.status(200).json(artistCardWithMetrics);
    } else {
        // This covers both "card not found" and "failed to recalculate metrics" if service returns null
        console.log(`Artist card ID ${id} not found or metrics retrieval failed, sending 404.`);
        res.status(404).json({ error: `Artist card with ID ${id} not found or metrics could not be retrieved.` });
    }
}));

/**
 * GET /api/artist-cards/:id/timeseries
 * Gets weekly streaming time series data for a specific artist card.
 * Query Parameters:
 *  - region: 'US' | 'GLOBAL' (required)
 *  - startDate: 'YYYY-MM-DD' (required)
 *  - endDate: 'YYYY-MM-DD' (required)
 */
router.get('/:id/timeseries', cacheSuccesses, asyncHandler(async (req: Request, res: Response) => {
    // --- ID Validation ---
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid numeric ID provided in path.' });
    }

    // --- Query Parameter Validation ---
    const { region: regionParam, startDate: startDateParam, endDate: endDateParam } = req.query;

    // Region
    if (!regionParam || typeof regionParam !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: region (e.g., ?region=US)' });
    }
    let region: Region;
    if (regionParam.toUpperCase() === 'US') { // Keep comparison uppercase
        region = 'US';
    } else if (regionParam.toUpperCase() === 'GLOBAL') {
        region = 'GLOBAL';
    } else {
        return res.status(400).json({ error: 'Invalid region specified. Must be US or GLOBAL.' }); // Keep error message uppercase
    }

    // Dates (Basic ISO 8601 YYYY-MM-DD validation)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!startDateParam || typeof startDateParam !== 'string' || !dateRegex.test(startDateParam)) {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: startDate (format YYYY-MM-DD)' });
    }
    if (!endDateParam || typeof endDateParam !== 'string' || !dateRegex.test(endDateParam)) {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: endDate (format YYYY-MM-DD)' });
    }
    const startDate = startDateParam; // Keep as string for the service layer
    const endDate = endDateParam;

    // Optional: Add validation that startDate <= endDate
    if (new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({ error: 'startDate cannot be after endDate' });
    }

    // --- Fetch Artist Card to get URL (using existing service function for simplicity)
    // We pass region 'US' arbitrarily here as we only need the core card data (URL)
    // A dedicated getArtistCardById might be slightly cleaner if available.
    const artistCardData = await getArtistCardWithMetrics(id, 'US');

    if (!artistCardData) {
        console.log(`Artist card ID ${id} not found when fetching for timeseries, sending 404.`);
        return res.status(404).json({ error: `Artist card with ID ${id} not found.` });
    }

    // Reconstruct the Spotify URL from the artist ID
    if (!artistCardData.SPOTIFY_ARTIST_ID) {
        console.error(`Artist card ID ${id} found but missing SPOTIFY_ARTIST_ID.`);
        // This shouldn't happen with current DB constraints, but good practice to check
        return res.status(500).json({ error: 'Internal server error: Artist card data is incomplete.'});
    }
    const artistUrl = `https://open.spotify.com/artist/${artistCardData.SPOTIFY_ARTIST_ID}`;

    // --- Call Time Series Service ---
    // Errors within getArtistStreamingTimeSeries are caught by asyncHandler
    // Handle potential null return by defaulting to an empty array
    const timeSeriesData: TimeSeriesDatapoint[] = (await getArtistStreamingTimeSeries(
        artistUrl,
        region,
        startDate,
        endDate
    )) ?? [];

    // --- Handle Response ---
    // The service function returns an empty array if no data, not null/undefined
    res.status(200).json(timeSeriesData);

}));

/**
 * GET /api/artist-cards/:id/songs
 * Gets a list of songs (with UnifiedSongID, name, etc.) associated with an artist card.
 */
router.get('/:id/songs', cacheSuccesses, asyncHandler(async (req: Request, res: Response) => {
    // --- ID Validation ---
    const artistCardId = parseInt(req.params.id, 10);
    if (isNaN(artistCardId)) {
        return res.status(400).json({ error: 'Invalid numeric Artist Card ID provided in path.' });
    }

    // --- Call Data Function ---
    const songs = await getSongsForArtist(artistCardId);
    
    // --- Handle Response ---
    // getSongsForArtist returns [] if not found or error occurred (and logged), safe to return directly
    res.status(200).json(songs); 
}));

/**
 * GET /api/artist-cards/:id/daily-streams
 * Gets daily US stream data for songs linked to a specific artist card.
 * Query Parameters:
 *  - daysLookback: number (optional, default: 90)
 */
router.get('/:id/daily-streams', cacheSuccesses, asyncHandler(async (req: Request, res: Response) => {
    // --- ID Validation ---
    const artistCardId = parseInt(req.params.id, 10);
    if (isNaN(artistCardId)) {
        return res.status(400).json({ error: 'Invalid numeric Artist Card ID provided in path.' });
    }

    // --- Query Parameter Validation (Optional daysLookback) ---
    let daysLookback = 60; // Default value (will be overridden by frontend call)
    const daysParam = req.query.daysLookback as string | undefined;
    if (daysParam) {
        const parsedDays = parseInt(daysParam, 10);
        if (!isNaN(parsedDays) && parsedDays > 0) {
            daysLookback = parsedDays;
        } else {
            return res.status(400).json({ error: 'Invalid daysLookback query parameter. Must be a positive number.' });
        }
    }

    // --- ADD Query Parameter Validation (Optional unifiedSongId) ---
    let unifiedSongId: number | null = null;
    const songIdParam = req.query.unifiedSongId as string | undefined;
    if (songIdParam) {
        const parsedSongId = parseInt(songIdParam, 10);
        if (!isNaN(parsedSongId)) {
            unifiedSongId = parsedSongId;
        } else {
            return res.status(400).json({ error: 'Invalid unifiedSongId query parameter. Must be a number.' });
        }
    }

    // --- ADD TIMING START ---
    const timingLabel = `[Route /daily-streams] Artist: ${artistCardId}, Song: ${unifiedSongId ?? 'all'}, Days: ${daysLookback}`;
    console.log(`[Route /daily-streams START] Request received for ${timingLabel}`);
    console.time(timingLabel);
    // --- END TIMING START ---

    try {
        const dailyStreams: DailySongStreamData[] = await getDailySongStreamsForArtist(
            artistCardId, 
            daysLookback, 
            unifiedSongId // Pass the parsed song ID (or null)
        );
        // --- ADD TIMING END ---
        console.timeEnd(timingLabel);
        console.log(`[Route /daily-streams END] Successfully fetched ${dailyStreams.length} streams for ${timingLabel}`);
        // --- END TIMING END ---
        res.status(200).json(dailyStreams); 
    } catch (error) {
        // --- ADD TIMING END (Error Case) ---
        console.timeEnd(timingLabel); 
        // --- END TIMING END (Error Case) ---
        console.error(`[Route /daily-streams ERROR] Error fetching daily streams for Artist ${artistCardId}, Song ${unifiedSongId ?? 'all'}:`, error);
        res.status(500).json({ message: 'Error fetching daily song streams' });
    }
}));

/**
 * GET /api/artist-cards/:id/songs/:unifiedSongId/streaming
 * Gets daily streaming time series data for a specific song.
 * Query Parameters:
 *  - region: 'US' | 'GLOBAL' (required)
 *  - startDate: 'YYYY-MM-DD' (required)
 *  - endDate: 'YYYY-MM-DD' (required)
 */
router.get('/:id/songs/:unifiedSongId/streaming', cacheSuccesses, asyncHandler(async (req: Request, res: Response) => {
    // --- ID Validation (Artist ID from path - kept for consistency, not used in data call) ---
    const artistCardId = parseInt(req.params.id, 10);
    if (isNaN(artistCardId)) {
        return res.status(400).json({ error: 'Invalid numeric Artist Card ID provided in path.' });
    }
    // --- ID Validation (Unified Song ID from path) ---
    const unifiedSongId = parseInt(req.params.unifiedSongId, 10);
    if (isNaN(unifiedSongId)) {
        return res.status(400).json({ error: 'Invalid numeric Unified Song ID provided in path.' });
    }

    // --- Query Parameter Validation (Copied from /timeseries route) ---
    const { region: regionParam, startDate: startDateParam, endDate: endDateParam } = req.query;
    // Region
    if (!regionParam || typeof regionParam !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: region (e.g., ?region=US)' });
    }
    let region: Region;
    if (regionParam.toUpperCase() === 'US') {
        region = 'US';
    } else if (regionParam.toUpperCase() === 'GLOBAL') {
        region = 'GLOBAL';
    } else {
        return res.status(400).json({ error: 'Invalid region specified. Must be US or GLOBAL.' });
    }
    // Dates
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!startDateParam || typeof startDateParam !== 'string' || !dateRegex.test(startDateParam)) {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: startDate (format YYYY-MM-DD)' });
    }
    if (!endDateParam || typeof endDateParam !== 'string' || !dateRegex.test(endDateParam)) {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: endDate (format YYYY-MM-DD)' });
    }
    const startDate = startDateParam;
    const endDate = endDateParam;
    if (new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({ error: 'startDate cannot be after endDate' });
    }
    // --- End Query Param Validation ---

    // --- Call Data Function ---
    const timeSeriesData = await getDailyStreamingTimeSeriesByUnifiedSongId(
        unifiedSongId, // Use validated song ID
        region,
        startDate,
        endDate
    );

    // --- Handle Response ---
    // Function returns empty array if no data
    res.status(200).json(timeSeriesData);

}));

/**
 * GET /api/artist-cards/:id/ugc-timeseries
 * Gets daily TikTok post count time series data for a specific artist card.
 * Query Parameters:
 *  - startDate: 'YYYY-MM-DD' (required)
 *  - endDate: 'YYYY-DD' (required)
 */
router.get('/:id/ugc-timeseries', cacheSuccesses, asyncHandler(async (req: Request, res: Response) => {
    // --- ID Validation ---
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid numeric ID provided in path.' });
    }

    // --- Query Parameter Validation ---
    const { startDate: startDateParam, endDate: endDateParam } = req.query;

    // Dates (Basic ISO 8601 YYYY-MM-DD validation)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!startDateParam || typeof startDateParam !== 'string' || !dateRegex.test(startDateParam)) {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: startDate (format YYYY-MM-DD)' });
    }
    if (!endDateParam || typeof endDateParam !== 'string' || !dateRegex.test(endDateParam)) {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: endDate (format YYYY-MM-DD)' });
    }
    const startDate = startDateParam;
    const endDate = endDateParam;

    // Optional: Add validation that startDate <= endDate
    if (new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({ error: 'startDate cannot be after endDate' });
    }

    // --- Call UGC Time Series Service ---
    // Errors within getArtistUgcTimeSeries are caught by asyncHandler
    const timeSeriesData = await getArtistUgcTimeSeries(id, startDate, endDate);

    // --- Handle Response ---
    if (timeSeriesData === null) {
        // Service function returns null on error
        return res.status(500).json({ error: 'Failed to retrieve UGC time series data.' });
    } else {
        // Service returns empty array [] if no data found, which is a valid 200 response
        res.status(200).json(timeSeriesData);
    }
}));

/**
 * GET /api/artist-cards/:id/ugc-timeseries/details
 * Gets detailed daily TikTok post count time series data for a specific artist card,
 * broken down by individual linked TikTok sound ID.
 * Query Parameters:
 *  - startDate: 'YYYY-MM-DD' (required)
 *  - endDate: 'YYYY-MM-DD' (required)
 */
router.get('/:id/ugc-timeseries/details', cacheSuccesses, asyncHandler(async (req: Request, res: Response) => {
    const artistCardId = parseInt(req.params.id, 10);
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    if (isNaN(artistCardId) || !startDate || !endDate) {
        return res.status(400).json({ error: 'Invalid parameters. Requires numeric artistCardId, startDate, and endDate.' });
    }

    // Basic date validation (can be improved)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    try {
        const detailedData = await getArtistUgcTimeSeriesDetails(artistCardId, startDate, endDate);
        if (detailedData) {
            res.status(200).json(detailedData);
        } else {
            // Service layer returned null, indicating an internal error occurred
            res.status(500).json({ error: 'Failed to retrieve detailed UGC time series data.' });
        }
    } catch (error) {
        // Error logging should happen in the service/data layer
        res.status(500).json({ error: 'Internal server error while fetching detailed UGC time series.' });
    }
}));

/**
 * POST /api/artist-cards/:id/ugc-links
 * MODIFIED: Links a new TikTok sound URL to an artist card AND optionally a specific song.
 * Expects JSON body: { "tiktokSoundUrl": "...", "unifiedSongId": number | null }
 */
router.post('/:id/ugc-links', asyncHandler(async (req: Request, res: Response) => {
    // 1. Validate Artist ID from path
    const artistCardId = parseInt(req.params.id, 10);
    if (isNaN(artistCardId)) {
        return res.status(400).json({ error: 'Invalid numeric Artist Card ID provided in path.' });
    }

    // 2. Validate TikTok Sound URL from body
    const { tiktokSoundUrl, unifiedSongId: unifiedSongIdBody } = req.body;
    if (!tiktokSoundUrl || typeof tiktokSoundUrl !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid tiktokSoundUrl in request body' });
    }
    
    // 2b. Validate optional unifiedSongId from body
    let unifiedSongId: number | null = null;
    if (unifiedSongIdBody !== undefined && unifiedSongIdBody !== null) {
        if (typeof unifiedSongIdBody !== 'number' || !Number.isInteger(unifiedSongIdBody)) {
             return res.status(400).json({ error: 'Invalid unifiedSongId in request body, must be an integer or null.' });
        }
        unifiedSongId = unifiedSongIdBody;
    }

    // 3. Extract EXTERNAL TikTok Sound ID (String) and Name from URL
    const soundDetails = extractTikTokSoundDetailsFromUrl(tiktokSoundUrl);
    if (!soundDetails || !soundDetails.tiktokSoundId) {
        console.warn(`Failed to extract sound details from URL: ${tiktokSoundUrl}`);
        return res.status(400).json({ error: 'Could not extract valid TikTok sound details from the provided URL.' });
    }
    const externalTikTokIdStr = soundDetails.tiktokSoundId;
    const tiktokSoundName = soundDetails.tiktokSoundName; // Keep name for later

    // 4. Look up INTERNAL TikTok Sound ID (Numeric) using the EXTERNAL ID
    const internalTikTokId = await getInternalTikTokId(externalTikTokIdStr);
    if (internalTikTokId === null) {
        console.warn(`Internal TikTok ID not found in tiktok_sounds table for external ID: ${externalTikTokIdStr}`);
        // Return 404 - sound not tracked in our system
        return res.status(404).json({ error: `TikTok sound with external ID ${externalTikTokIdStr} is not currently tracked in the database.` }); 
    }
    // internalTikTokId is now the correct numeric ID to use
    console.log(`Found internal TikTok ID ${internalTikTokId} for external ID ${externalTikTokIdStr}`);

    // 5. Call data layer function to add the link using the INTERNAL ID and unifiedSongId
    try {
        console.log(`Attempting to link ArtistCard ${artistCardId} to INTERNAL TikTok Sound ID ${internalTikTokId} (${tiktokSoundName || 'No Name'}), Unified Song ID: ${unifiedSongId}`);
        const newLink = await addUgcLink(
            artistCardId,
            internalTikTokId, 
            unifiedSongId, // Pass the validated unifiedSongId
            tiktokSoundName, 
            null, // artistTikTokHandle - still null
            null  // isrc - still null
        );
        console.log(`Successfully created UGC link with ID: ${newLink.ID}`);
        res.status(201).json(newLink); // 201 Created
    } catch (error) {
        console.error(`API Error POST /api/artist-cards/${artistCardId}/ugc-links for internal ID ${internalTikTokId}, Unified Song ID ${unifiedSongId}:`, error);
        if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
             return res.status(409).json({ error: 'Conflict: This TikTok sound may already be linked to this artist/song.' }); // Slightly updated message
        }
        if (error instanceof Error && error.message.includes('violates foreign key constraint')) {
             // Could be artist or song FK, keep message general
             console.warn(`Attempted to link sound to non-existent ArtistCard ID ${artistCardId} or Unified Song ID ${unifiedSongId}`);
             return res.status(404).json({ error: `Artist card with ID ${artistCardId} or specified Song ID not found.` });
        }
        throw error; 
    }
}));

/**
 * GET /api/artist-cards/:id/ugc-links
 * MODIFIED: Retrieves UGC links associated with an artist card.
 * Optionally filters by unifiedSongId query parameter.
 * Query Params: ?unifiedSongId=<number>
 */
router.get('/:id/ugc-links', asyncHandler(async (req: Request, res: Response) => {
    // Validate Artist ID
    const artistCardId = parseInt(req.params.id, 10);
    if (isNaN(artistCardId)) {
        return res.status(400).json({ error: 'Invalid numeric Artist Card ID provided in path.' });
    }

    // Validate optional unifiedSongId from query params
    let unifiedSongIdQuery: number | null = null;
    const unifiedSongIdParam = req.query.unifiedSongId;
    if (unifiedSongIdParam !== undefined && unifiedSongIdParam !== null) {
         if (typeof unifiedSongIdParam === 'string' && /^[0-9]+$/.test(unifiedSongIdParam)) {
            unifiedSongIdQuery = parseInt(unifiedSongIdParam, 10);
         } else {
            console.warn(`Invalid non-numeric unifiedSongId query parameter received: ${unifiedSongIdParam}`);
            // Optionally return 400, or just ignore it and return all links for the artist
            // Let's ignore for now, maybe add strict validation later if needed.
         }
    }

    try {
        // Pass the validated (or null) unifiedSongId to the data function
        const links = await getUgcLinksForArtist(artistCardId, unifiedSongIdQuery);
        res.status(200).json(links);
    } catch (error) {
        // Error logging in data function already includes IDs
        // console.error(`API Error GET /api/artist-cards/${artistCardId}/ugc-links:`, error);
        throw error; // Re-throw for asyncHandler
    }
}));

/**
 * GET /api/artist-cards/:id/songs/:unifiedSongId/reactivity
 * Calculates the reactivity score (correlation & grade) between streaming and UGC
 * for a specific song over a given period.
 * Query Parameters:
 *  - artistId: number (required) - The internal artist_card ID.
 *  - region: 'US' | 'GLOBAL' (required)
 *  - startDate: 'YYYY-MM-DD' (required)
 *  - endDate: 'YYYY-MM-DD' (required)
 */
router.get('/:id/songs/:unifiedSongId/reactivity', cacheSuccesses, asyncHandler(async (req: Request, res: Response) => {
    // --- Path Parameter Validation (Unified Song ID) ---
    const unifiedSongId = parseInt(req.params.unifiedSongId, 10);
    if (isNaN(unifiedSongId)) {
        return res.status(400).json({ error: 'Invalid numeric Unified Song ID provided in path.' });
    }
    // --- Path Parameter Validation (Artist ID - :id) ---
    // We get the *actual* artistId to use from query params, but we still need to validate the path param
    const artistIdFromPath = parseInt(req.params.id, 10);
    if (isNaN(artistIdFromPath)) {
        return res.status(400).json({ error: 'Invalid numeric Artist Card ID provided in path.' });
    }

    // --- Query Parameter Validation ---
    const { artistId: artistIdParam, region: regionParam, startDate: startDateParam, endDate: endDateParam } = req.query;

    // Artist ID (Required from Query)
    const artistId = parseInt(artistIdParam as string, 10);
     if (isNaN(artistId)) {
         return res.status(400).json({ error: 'Missing or invalid required query parameter: artistId (must be numeric)' });
     }
     // Optional: Check if artistId from query matches artistId from path for consistency?
     // if (artistId !== artistIdFromPath) { 
     //     console.warn(`[API /reactivity] Mismatch between path artist ID (${artistIdFromPath}) and query artist ID (${artistId}). Using query ID.`);
     // }
    
    // Region (Required - logic copied from /streaming route)
    if (!regionParam || typeof regionParam !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: region (e.g., ?region=US)' });
    }
    let region: Region;
    if (regionParam.toUpperCase() === 'US') {
        region = 'US';
    } else if (regionParam.toUpperCase() === 'GLOBAL') {
        region = 'GLOBAL';
    } else {
        return res.status(400).json({ error: 'Invalid region specified. Must be US or GLOBAL.' });
    }

    // Dates (Required - logic copied from /streaming route)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!startDateParam || typeof startDateParam !== 'string' || !dateRegex.test(startDateParam as string)) {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: startDate (format YYYY-MM-DD)' });
    }
    if (!endDateParam || typeof endDateParam !== 'string' || !dateRegex.test(endDateParam as string)) {
        return res.status(400).json({ error: 'Missing or invalid required query parameter: endDate (format YYYY-MM-DD)' });
    }
    const startDate = startDateParam as string;
    const endDate = endDateParam as string;
    if (new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({ error: 'startDate cannot be after endDate' });
    }
    // --- End Query Param Validation ---

    console.log(`[API /reactivity] Request received for Song ${unifiedSongId}, Artist ${artistId}, Region ${region}, Start ${startDate}, End ${endDate}`);

    // --- Call Service Function ---
    const reactivityResult = await calculateSongReactivity(
        artistId, // Use ID from query param
        unifiedSongId,
        region,
        startDate,
        endDate
    );

    // --- Handle Response ---
    // calculateSongReactivity returns { correlation: null, grade: 'N/A' } on error
    res.status(200).json(reactivityResult);

}));

// --- Add DELETE Endpoint for an Artist Card ---
/**
 * DELETE /api/artist-cards/:id
 * Deletes an artist card and all associated data (songs, UGC links).
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    const artistCardId = parseInt(req.params.id, 10);
    if (isNaN(artistCardId)) {
        return res.status(400).json({ error: 'Invalid numeric Artist Card ID provided.' });
    }

    console.log(`[API DELETE /artist-cards/:id] Received request to delete Artist Card ID: ${artistCardId}`);
    
    // Clear entire cache (simpler approach)
    apicache.clear(); 

    const success = await deleteArtistCard(artistCardId);
    
    if (success) {
        res.status(204).send(); // 204 No Content is standard for successful DELETE with no body
    } else {
        // The function throws on error, so this path might not be reached unless it returns false explicitly
        res.status(500).json({ error: 'Failed to delete artist card.' }); 
    }
}));

// --- Add DELETE Endpoint for a specific UGC Link ---
/**
 * DELETE /api/artist-cards/:artistId/ugc-links/:linkId 
 * Deletes a specific UGC link associated with an artist.
 * Note: artistId in the path isn't strictly needed if linkId is globally unique,
 * but kept for API structure consistency.
 */
router.delete('/:artistId/ugc-links/:linkId', asyncHandler(async (req: Request, res: Response) => {
    // const artistId = parseInt(req.params.artistId, 10); // We don't strictly need the artistId for deletion if linkId is PK
    const linkId = parseInt(req.params.linkId, 10);
    
    if (isNaN(linkId)) {
        return res.status(400).json({ error: 'Invalid numeric UGC Link ID provided.' });
    }

    console.log(`[API DELETE /ugc-links/:linkId] Received request to delete UGC Link ID: ${linkId}`);
    
    // Clear entire cache
    apicache.clear();

    const success = await deleteUgcLink(linkId);
    
    if (success) {
        res.status(204).send();
    } else {
        res.status(500).json({ error: 'Failed to delete UGC link.' });
    }
}));

// We can add PUT /:id and DELETE /:id later if needed

export default router;