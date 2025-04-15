import {
    ArtistCard,
    CreateArtistCardInput,
    createArtistCard,
    getArtistCardBySpotifyId,
    updateArtistCardMetrics,
    Region,
    addUgcLink,
    getArtistCardById,
} from '../data/index.js'; // Functions for our ARTIST_CARDS table
import { getTikTokSoundDetails } from '../data/tiktok.js'; // Added import
import { getIsrcsBySpotifyTrackIds } from '../data/spotify.js'; // Added import
import { getArtistDataByUrl } from './artistMetricsService.js'; // ArtistData removed
import { getArtistStreamingMetrics } from './artistMetricsService.js'; // ArtistMetricsResponse removed

// --- Caching Configuration --- (Move to config file later)
const CACHE_DURATION_HOURS = 12;
const CACHE_DURATION_MS = CACHE_DURATION_HOURS * 60 * 60 * 1000;

/**
 * Checks if the cached metrics for a specific region are still valid.
 *
 * @param artistCard The ArtistCard object containing cache timestamps.
 * @param region The region ('US' | 'GLOBAL') to check.
 * @returns True if cache is valid, false otherwise.
 */
function isCacheValid(artistCard: ArtistCard, region: Region): boolean {
    const timestamp = region === 'US' ? artistCard.US_METRICS_UPDATED_AT : artistCard.GLOBAL_METRICS_UPDATED_AT;
    if (!timestamp) {
        return false; // No cache timestamp means invalid
    }
    const cacheAge = Date.now() - timestamp.getTime();
    return cacheAge < CACHE_DURATION_MS;
}

/** Type combining ArtistCard details with its metrics */
export interface ArtistCardWithMetrics extends ArtistCard {
    metrics: {
        region: Region;
        thisWeek: number;
        lastWeek: number;
        percentageChange: number | null;
    } | null; // Metrics might be null if calculation fails
}

/**
 * Retrieves an Artist Card by its ID and includes streaming metrics,
 * using cached data if valid, otherwise recalculating and caching.
 *
 * @param id The numeric ID of the artist card.
 * @param region The region ('US' | 'GLOBAL') for which to retrieve metrics.
 * @returns A promise resolving to ArtistCardWithMetrics (including metrics) or null if card not found.
 */
export async function getArtistCardWithMetrics(id: number, region: Region): Promise<ArtistCardWithMetrics | null> {
    try {
        // 1. Get the base artist card data
        const artistCard = await getArtistCardById(id);
        if (!artistCard) {
            console.log(`Artist card with ID ${id} not found.`);
            return null;
        }

        // 2. Check cache validity
        if (isCacheValid(artistCard, region)) {
            console.log(`Using cached ${region} metrics for Artist Card ID: ${id}`);
            const cachedMetrics = {
                region: region,
                // Extract metrics, providing defaults if they happen to be null in DB
                thisWeek: (region === 'US' ? artistCard.US_METRICS_THIS_WEEK : artistCard.GLOBAL_METRICS_THIS_WEEK) ?? 0,
                lastWeek: (region === 'US' ? artistCard.US_METRICS_LAST_WEEK : artistCard.GLOBAL_METRICS_LAST_WEEK) ?? 0,
                percentageChange: (region === 'US' ? artistCard.US_METRICS_PERCENT_CHANGE : artistCard.GLOBAL_METRICS_PERCENT_CHANGE) ?? null,
            };
            return { ...artistCard, metrics: cachedMetrics };
        }

        // 3. Cache invalid or missing - Recalculate metrics
        console.log(`Cache invalid or missing for ${region} metrics, Artist Card ID: ${id}. Recalculating...`);
        // Need the original spotify URL to recalculate. We only have the ID here.
        // This reveals a design consideration: Should recalculation be triggered here?
        // Or should there be a separate process/endpoint to *refresh* metrics?
        // For now, let's assume we *need* the URL to recalculate. We don't have it.
        // --> Alternative: Add spotify_url to ARTIST_CARDS table?
        // --> Simpler for now: Fetch metrics using artistMetricsService which needs the URL.
        // --> We need to store the URL or reconstruct it.
        // Let's assume we can reconstruct a basic URL from SPOTIFY_ARTIST_ID
        // (This might not work for all cases if URLs change format)
        const reconstructedUrl = `https://open.spotify.com/artist/${artistCard.SPOTIFY_ARTIST_ID}`;
        console.log(`Reconstructed URL for recalculation: ${reconstructedUrl}`);

        const freshMetricsResponse = await getArtistStreamingMetrics(reconstructedUrl, region);

        if (!freshMetricsResponse) {
            console.error(`Failed to recalculate ${region} metrics for Artist Card ID: ${id}. Returning card without metrics.`);
            // Return the card data but indicate metrics calculation failed
             return { ...artistCard, metrics: null };
        }

        // 4. Update the cache in the database
        await updateArtistCardMetrics(id, region, freshMetricsResponse.metrics);

        // 5. Return the artist card with the fresh metrics
        // Fetch the card again to get the updated timestamps etc. (optional but safer)
        const updatedArtistCard = await getArtistCardById(id);
        if (!updatedArtistCard) throw new Error("Failed to retrieve card after metric update"); // Should not happen

        return { ...updatedArtistCard, metrics: freshMetricsResponse.metrics };

    } catch (error) {
        console.error(`Error getting artist card with metrics for ID ${id} (${region}):`, error);
        throw error;
    }
}

/**
 * Finds an existing Artist Card by Spotify URL or creates a new one
 * by fetching data from the Spotify source tables via artistMetricsService.
 *
 * @param artistUrl - The URL of the Spotify artist profile.
 * @returns A promise resolving to the existing or newly created ArtistCard, or null if fetching data failed.
 * @throws Rethrows errors from underlying services or data access layers.
 */
export async function findOrCreateArtistCardByUrl(artistUrl: string): Promise<ArtistCard | null> {
    // 1. Extract the string ID to check for existence (can reuse the helper if needed, or rely on getArtistCardBySpotifyId)
    // Let's assume getArtistDataByUrl handles URL parsing and initial lookup robustly.
    // We need the string ID for the initial check. A bit redundant to call getArtistDataByUrl twice,
    // let's refine the flow slightly.

    // Try finding the Spotify ID first (requires the helper)
    const tempArtistData = await getArtistDataByUrl(artistUrl); // This fetches from Spotify tables
    if (!tempArtistData) {
         console.error(`Failed to fetch initial artist data for URL: ${artistUrl}. Cannot create or find card.`);
         return null; // Failed to get necessary info from source
    }
    const spotifyArtistId = tempArtistData.spotifyArtistId;

    try {
        // 2. Check if card already exists in our table
        const existingCard = await getArtistCardBySpotifyId(spotifyArtistId);
        if (existingCard) {
            console.log(`Found existing Artist Card (ID: ${existingCard.ID}) for Spotify ID: ${spotifyArtistId}`);
            return existingCard;
        }

        // 3. Card doesn't exist, create it using the data we already fetched
        console.log(`No existing card found for ${spotifyArtistId}. Creating new card...`);
        const createInput: CreateArtistCardInput = {
            SPOTIFY_ARTIST_ID: tempArtistData.spotifyArtistId,
            NUMERIC_ACCOUNT_ID: tempArtistData.numericAccountId,
            NAME: tempArtistData.name,
            IMAGE_URL_LARGE: tempArtistData.imageUrlLarge,
        };

        const newCard = await createArtistCard(createInput);
        return newCard;

    } catch (error) {
        console.error(`Error finding or creating artist card for URL ${artistUrl}:`, error);
        throw error; // Re-throw
    }
}

/**
 * Fetches details for TikTok sounds, retrieves their ISRCs, and links them
 * to a specified Artist Card via the ARTIST_UGC_LINKS table.
 *
 * @param artistCardId The ID of the Artist Card to link the sounds to.
 * @param tiktokSoundIds An array of numeric TikTok Sound IDs.
 * @returns A promise resolving to void. Errors are logged internally.
 */
export async function linkTikTokSoundsToArtistCard(
    artistCardId: number,
    tiktokSoundIds: number[]
): Promise<void> {
    if (!tiktokSoundIds || tiktokSoundIds.length === 0) {
        console.log(`No TikTok Sound IDs provided for linking to Artist Card ID: ${artistCardId}.`);
        return;
    }

    console.log(`Linking ${tiktokSoundIds.length} TikTok sounds to Artist Card ID: ${artistCardId}...`);

    try {
        // 1. Get TikTok sound details (name, author, spotify_track_id)
        const soundDetailsMap = await getTikTokSoundDetails(tiktokSoundIds);
        if (soundDetailsMap.size === 0) {
            console.log(`No details found for any of the provided TikTok Sound IDs.`);
            return;
        }

        // 2. Extract Spotify Track IDs (numeric PKs) that are not null
        const spotifyTrackIds = Array.from(soundDetailsMap.values())
            .map(detail => detail.SPOTIFY_TRACK_ID)
            .filter((id): id is number => id !== null && id !== undefined);

        // 3. Get ISRCs for the found Spotify Track IDs
        let isrcMap = new Map<number, string | null>();
        if (spotifyTrackIds.length > 0) {
            isrcMap = await getIsrcsBySpotifyTrackIds(spotifyTrackIds);
        } else {
            console.log('No valid Spotify Track IDs found to fetch ISRCs.');
        }

        // 4. Iterate and link each sound
        let successfulLinks = 0;
        const linkPromises: Promise<any>[] = [];

        for (const tiktokSoundId of tiktokSoundIds) {
            const details = soundDetailsMap.get(tiktokSoundId);
            if (!details) {
                console.warn(`Skipping TikTok Sound ID ${tiktokSoundId}: Details not found.`);
                continue;
            }

            const spotifyTrackId = details.SPOTIFY_TRACK_ID;
            const isrc = spotifyTrackId ? (isrcMap.get(spotifyTrackId) ?? null) : null;

            // Call addUgcLink for each sound, inserting null for unifiedSongId
            linkPromises.push(
                addUgcLink(
                    artistCardId,
                    tiktokSoundId,
                    null, // Add null for unifiedSongId 
                    details.NAME, // tiktokSoundName
                    details.AUTHOR, // artistTikTokHandle (using AUTHOR field)
                    isrc // Pass the fetched isrc
                )
                .then(() => {
                    successfulLinks++;
                })
                .catch(linkError => {
                    console.error(`Failed to link TikTok Sound ID ${tiktokSoundId} to Artist Card ${artistCardId}:`, linkError);
                    // Continue processing other links
                })
            );
        }

        // Wait for all linking operations to complete
        await Promise.all(linkPromises);

        console.log(`Successfully linked ${successfulLinks} out of ${tiktokSoundIds.length} TikTok sounds to Artist Card ID: ${artistCardId}.`);

    } catch (error) {
        console.error(`Error during the process of linking TikTok sounds for Artist Card ID ${artistCardId}:`, error);
        // Decide if this should throw or just log
    }
}

// We might add other service functions here later, e.g., fetching card + metrics together 