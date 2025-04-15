import { executeQuery } from './connection.js';

const ARTIST_CARD_TABLE = 'us_labels_sandbox.arya_s.ARTIST_CARDS';
const UGC_LINK_TABLE = 'us_labels_sandbox.arya_s.ARTIST_UGC_LINKS';
// Define other needed table names
// const SPOTIFY_TRACKS_TABLE = 'sodatone.sodatone.spotify_tracks';
// const SPOTIFY_ACCOUNT_TRACKS_TABLE = 'sodatone.sodatone.spotify_account_tracks';
// const UNIFIED_SONG_MAPPING_TABLE = 'sodatone.sodatone.luminate_unified_song_spotify_tracks';
const ARTIST_SONGS_TABLE = 'us_labels_sandbox.arya_s.ARTIST_SONGS';

// Interface matching the ARTIST_CARDS table
export interface ArtistCard {
    ID: number;
    SPOTIFY_ARTIST_ID: string;
    NUMERIC_ACCOUNT_ID: number;
    NAME: string | null;
    IMAGE_URL_LARGE: string | null;
    CREATED_AT: Date;
    UPDATED_AT: Date;
    // Added Caching Columns
    US_METRICS_THIS_WEEK: number | null;
    US_METRICS_LAST_WEEK: number | null;
    US_METRICS_PERCENT_CHANGE: number | null;
    US_METRICS_UPDATED_AT: Date | null;
    GLOBAL_METRICS_THIS_WEEK: number | null;
    GLOBAL_METRICS_LAST_WEEK: number | null;
    GLOBAL_METRICS_PERCENT_CHANGE: number | null;
    GLOBAL_METRICS_UPDATED_AT: Date | null;
    // Add field for latest UGC count
    LATEST_UGC_POST_COUNT: number | null; 
    // Add field for UGC percentage change
    LATEST_UGC_PERCENT_CHANGE: number | null;
}

// Interface matching the ARTIST_UGC_LINKS table
export interface ArtistUgcLink {
    ID: number;
    ARTIST_CARD_ID: number;
    TIKTOK_SOUND_ID: number;
    TIKTOK_SOUND_NAME: string | null;
    ARTIST_TIKTOK_HANDLE: string | null;
    ISRC: string | null;
    CREATED_AT: Date;
}

// Interface for detailed UGC Link data (including potential song link)
export interface ArtistUgcLinkDetailed extends ArtistUgcLink { // Assuming ArtistUgcLink exists
    UNIFIED_SONG_ID: number | null; // Added field from DB alteration
}

// --- NEW: Interface for Song Info ---
export interface ArtistSongInfo {
    unifiedSongId: number;
    spotifyTrackId: number; // Now directly from ARTIST_SONGS_TABLE
    name: string | null;
}

// --- ArtistCard Functions ---

/** Input type for creating an artist card - only fields provided at creation */
export type CreateArtistCardInput = {
    SPOTIFY_ARTIST_ID: string;
    NUMERIC_ACCOUNT_ID: number;
    NAME: string | null;
    IMAGE_URL_LARGE: string | null;
};

/**
 * Creates a new artist card record in the database.
 * Automatically sets CREATED_AT and UPDATED_AT.
 * @param data - The data for the new artist card.
 * @returns A promise resolving to the newly created ArtistCard object (including its ID).
 * @throws If the insert fails (e.g., duplicate spotify_artist_id).
 */
export async function createArtistCard(data: CreateArtistCardInput): Promise<ArtistCard> {
    const sqlText = `
        INSERT INTO ${ARTIST_CARD_TABLE}
            (SPOTIFY_ARTIST_ID, NUMERIC_ACCOUNT_ID, NAME, IMAGE_URL_LARGE)
        VALUES (?, ?, ?, ?)
    `;
    const binds = [
        data.SPOTIFY_ARTIST_ID,
        data.NUMERIC_ACCOUNT_ID,
        data.NAME,
        data.IMAGE_URL_LARGE
    ];
    try {
        // Snowflake INSERT doesn't easily return the inserted row by default like some DBs.
        // We execute the insert, then query by the unique spotify_artist_id to get the full row.
        await executeQuery<any>(sqlText, binds); // Use <any> as insert result isn't standard rows

        // Query back the inserted row using the unique spotify_artist_id
        const newCard = await getArtistCardBySpotifyId(data.SPOTIFY_ARTIST_ID);
        if (!newCard) {
            throw new Error(`Failed to retrieve newly created artist card for Spotify ID: ${data.SPOTIFY_ARTIST_ID}`);
        }
        console.log(`Created Artist Card with ID: ${newCard.ID}`);
        return newCard;
    } catch (error) {
        console.error(`Error creating artist card for Spotify ID ${data.SPOTIFY_ARTIST_ID}:`, error);
        throw error;
    }
}

/**
 * Retrieves an artist card by its unique Spotify Artist ID string.
 * @param spotifyArtistId - The alphanumeric Spotify artist ID.
 * @returns A promise resolving to the ArtistCard object or null if not found.
 */
export async function getArtistCardBySpotifyId(spotifyArtistId: string): Promise<ArtistCard | null> {
    const sqlText = `SELECT * FROM ${ARTIST_CARD_TABLE} WHERE SPOTIFY_ARTIST_ID = ? LIMIT 1`;
    try {
        const results = await executeQuery<ArtistCard>(sqlText, [spotifyArtistId]);
        return results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error(`Error fetching artist card for Spotify ID ${spotifyArtistId}:`, error);
        throw error;
    }
}

/**
 * Retrieves an artist card by its primary key ID.
 * @param id - The numeric ID of the artist card.
 * @returns A promise resolving to the ArtistCard object or null if not found.
 */
export async function getArtistCardById(id: number): Promise<ArtistCard | null> {
    const sqlText = `SELECT * FROM ${ARTIST_CARD_TABLE} WHERE ID = ? LIMIT 1`;
    try {
        const results = await executeQuery<ArtistCard>(sqlText, [id]);
        return results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error(`Error fetching artist card for ID ${id}:`, error);
        throw error;
    }
}

/**
 * Retrieves all artist cards, reading pre-calculated UGC stats.
 * Assumes a Snowflake Task populates LATEST_UGC_POST_COUNT and LATEST_UGC_PERCENT_CHANGE.
 * @returns A promise resolving to an array of ArtistCard objects.
 */
export async function listArtistCards(): Promise<ArtistCard[]> {
    // Simplified SQL to select directly from the table
    const sqlText = `SELECT * FROM ${ARTIST_CARD_TABLE} ORDER BY NAME ASC`; 
    
    console.log(`[listArtistCards] Executing simplified query: ${sqlText}`);
    try {
        // The ArtistCard interface should already include the UGC columns
        const results = await executeQuery<ArtistCard>(sqlText);
        console.log(`[listArtistCards] Fetched ${results.length} artist cards with pre-calculated stats.`);
        return results;
    } catch (error) {
        console.error(`Error listing artist cards (simplified query):`, error);
        throw error;
    }
}

// Add UPDATE and DELETE functions for ArtistCard if needed later

// --- ArtistUgcLink Functions ---

/**
 * Adds a link between an artist card, a TikTok sound ID, and optionally a Unified Song ID.
 * @param artistCardId - The ID of the artist card.
 * @param tiktokSoundId - The numeric ID of the TikTok sound.
 * @param unifiedSongId - The numeric Luminate Unified Song ID (optional).
 * @param tiktokSoundName - The name of the TikTok sound.
 * @param artistTikTokHandle - The TikTok handle of the artist.
 * @param isrc - The ISRC of the song.
 * @returns A promise resolving to the newly created ArtistUgcLinkDetailed object.
 * @throws If the insert fails (e.g., unique constraint violation).
 */
export async function addUgcLink(
    artistCardId: number,
    tiktokSoundId: number,
    unifiedSongId: number | null, // Added parameter
    tiktokSoundName: string | null, // Keep existing params
    artistTikTokHandle: string | null,
    isrc: string | null
): Promise<ArtistUgcLinkDetailed> { // Return the detailed type

    // Include UNIFIED_SONG_ID in the INSERT statement
    const sqlTextInsert = `
        INSERT INTO ${UGC_LINK_TABLE} 
            (ARTIST_CARD_ID, TIKTOK_SOUND_ID, UNIFIED_SONG_ID, TIKTOK_SOUND_NAME, ARTIST_TIKTOK_HANDLE, ISRC)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    // Add unifiedSongId (or null) to the binds
    const bindsInsert = [
        artistCardId, 
        tiktokSoundId, 
        unifiedSongId, // Pass null if not provided
        tiktokSoundName, 
        artistTikTokHandle, 
        isrc
    ];

    try {
        await executeQuery<any>(sqlTextInsert, bindsInsert);

        // Query back the inserted record to return it
        const sqlQueryBack = `
            SELECT *
            FROM ${UGC_LINK_TABLE}
            WHERE ARTIST_CARD_ID = ? AND TIKTOK_SOUND_ID = ? 
            -- Add condition for unifiedSongId if it was provided, handle NULL case
            ${unifiedSongId !== null ? 'AND UNIFIED_SONG_ID = ?' : 'AND UNIFIED_SONG_ID IS NULL'} 
            ORDER BY CREATED_AT DESC LIMIT 1
        `;
        
        // Adjust binds for the query back based on whether unifiedSongId is null
        const bindsQueryBack = unifiedSongId !== null 
            ? [artistCardId, tiktokSoundId, unifiedSongId] 
            : [artistCardId, tiktokSoundId];

        // Expect the detailed type
        const links = await executeQuery<ArtistUgcLinkDetailed>(sqlQueryBack, bindsQueryBack);
        
        if (!links || links.length === 0) {
            throw new Error(`Failed to retrieve newly created UGC link for ArtistCard ${artistCardId}, TikTok Sound ${tiktokSoundId}, Unified Song ${unifiedSongId ?? 'NULL'}`);
        }
        
        console.log(`Created UGC Link with ID: ${links[0].ID} linking ArtistCard ${artistCardId} to TikTok Sound ID: ${links[0].TIKTOK_SOUND_ID} and Unified Song ID: ${links[0].UNIFIED_SONG_ID}`);
        
        return links[0];

    } catch (error) {
        console.error(`Error adding UGC link for ArtistCard ${artistCardId}, TikTok Sound ${tiktokSoundId}, Unified Song ${unifiedSongId ?? 'NULL'}:`, error);
        throw error;
    }
}

/**
 * Retrieves UGC links, optionally filtering by a specific song.
 * If unifiedSongId is provided, returns links for that song.
 * If unifiedSongId is null or undefined, returns all links for the artist card.
 * 
 * @param artistCardId - The ID of the artist card.
 * @param unifiedSongId - Optional: The Luminate Unified Song ID to filter by.
 * @returns A promise resolving to an array of ArtistUgcLinkDetailed objects.
 */
export async function getUgcLinksForArtist(
    artistCardId: number, 
    unifiedSongId?: number | null // Make unifiedSongId optional
): Promise<ArtistUgcLinkDetailed[]> { 
    
    let sqlText = `SELECT * FROM ${UGC_LINK_TABLE} WHERE ARTIST_CARD_ID = ?`;
    const binds: (number | string)[] = [artistCardId];

    // Add filter for unifiedSongId if provided
    if (unifiedSongId !== undefined && unifiedSongId !== null) {
        sqlText += ` AND UNIFIED_SONG_ID = ?`;
        binds.push(unifiedSongId);
        console.log(`[getUgcLinks] Fetching UGC links for Artist Card ${artistCardId} AND Unified Song ${unifiedSongId}`);
    } else {
        console.log(`[getUgcLinks] Fetching ALL UGC links for Artist Card ${artistCardId}`);
    }

    sqlText += ` ORDER BY CREATED_AT DESC`;

    try {
        const results = await executeQuery<ArtistUgcLinkDetailed>(sqlText, binds);
        return results;
    } catch (error) {
        console.error(`Error retrieving UGC links for ArtistCard ${artistCardId}${unifiedSongId ? ` and Unified Song ${unifiedSongId}` : ''}:`, error);
        throw error;
    }
}

/**
 * Deletes a specific UGC link by its unique ID.
 * @param ugcLinkId - The ID of the UGC link record to delete.
 * @returns A promise resolving to true if deletion was successful, false otherwise.
 * @throws If the database query fails.
 */
export async function deleteUgcLink(ugcLinkId: number): Promise<boolean> {
    console.log(`[deleteUgcLink] Attempting to delete UGC Link with ID: ${ugcLinkId}`);
    if (!ugcLinkId) {
        console.error('[deleteUgcLink] UGC Link ID is required.');
        return false;
    }

    const sqlText = `DELETE FROM ${UGC_LINK_TABLE} WHERE ID = ?`;
    const binds = [ugcLinkId];

    try {
        // executeQuery might return information about rows affected, but behavior varies.
        // We'll assume success if no error is thrown. Check driver docs if specific confirmation needed.
        await executeQuery<any>(sqlText, binds); // Use <any> as DELETE doesn't return rows
        console.log(`[deleteUgcLink] Successfully deleted UGC Link ID: ${ugcLinkId}`);
        return true;
    } catch (error) {
        console.error(`[deleteUgcLink] Error deleting UGC Link ID ${ugcLinkId}:`, error);
        throw error; // Re-throw for higher-level handling
    }
}

/** Input type for updating metrics */
interface UpdateMetricsInput {
    thisWeek?: number | null;
    lastWeek?: number | null;
    percentageChange?: number | null;
}

/**
 * Updates the cached metrics for a specific region for a given artist card.
 * Also updates the corresponding METRICS_UPDATED_AT timestamp.
 *
 * @param artistCardId The ID of the artist card to update.
 * @param region The region ('US' or 'GLOBAL') whose metrics are being updated.
 * @param metrics The calculated metrics data.
 * @returns A promise resolving to void. // Changed: Doesn't need to return the card
 * @throws If the update fails.
 */
export async function updateArtistCardMetrics(
    artistCardId: number,
    region: 'US' | 'GLOBAL',
    metrics: UpdateMetricsInput
): Promise<void> { // Changed: Return void
    const timestampCol = region === 'US' ? 'US_METRICS_UPDATED_AT' : 'GLOBAL_METRICS_UPDATED_AT';
    const thisWeekCol = region === 'US' ? 'US_METRICS_THIS_WEEK' : 'GLOBAL_METRICS_THIS_WEEK';
    const lastWeekCol = region === 'US' ? 'US_METRICS_LAST_WEEK' : 'GLOBAL_METRICS_LAST_WEEK';
    const percentChangeCol = region === 'US' ? 'US_METRICS_PERCENT_CHANGE' : 'GLOBAL_METRICS_PERCENT_CHANGE';

    const sqlText = `
        UPDATE ${ARTIST_CARD_TABLE}
        SET
            ${thisWeekCol} = ?,
            ${lastWeekCol} = ?,
            ${percentChangeCol} = ?,
            ${timestampCol} = CURRENT_TIMESTAMP(),
            UPDATED_AT = CURRENT_TIMESTAMP() -- Also update the general updated_at
        WHERE ID = ?;
    `;

    // Handle potential nulls before binding
    const binds = [
        metrics.thisWeek ?? null,
        metrics.lastWeek ?? null,
        metrics.percentageChange ?? null,
        artistCardId
    ];

    try {
        await executeQuery<any>(sqlText, binds); // Update doesn't return rows
        console.log(`Updated cached ${region} metrics for Artist Card ID: ${artistCardId}`);
        // No need to query back or return the card
    } catch (error) {
        console.error(`Error updating ${region} metrics for Artist Card ID ${artistCardId}:`, error);
        throw error;
    }
}

// --- NEW: Function to get Songs for an Artist (Optimized) ---
/**
 * Fetches a list of songs associated with a given artist card ID.
 * Retrieves the Unified Song ID, Spotify Track ID, and Song Name directly from the optimized ARTIST_SONGS table.
 *
 * @param artistCardId The ID of the artist card.
 * @returns A promise resolving to an array of ArtistSongInfo objects.
 */
export async function getSongsForArtist(artistCardId: number): Promise<ArtistSongInfo[]> {
    console.log(`[getSongsForArtist] Fetching songs for Artist Card ID: ${artistCardId} from ${ARTIST_SONGS_TABLE}`);
    if (!artistCardId) {
        console.error('[getSongsForArtist] Artist Card ID is required.');
        return [];
    }

    // Query the optimized ARTIST_SONGS table directly
    const sqlText = `
        SELECT
            UNIFIED_SONG_ID     AS "unifiedSongId",
            SPOTIFY_TRACK_ID    AS "spotifyTrackId",
            NAME                AS "name"
        FROM ${ARTIST_SONGS_TABLE}
        WHERE ARTIST_CARD_ID = ?
        ORDER BY "name" ASC;
    `;

    const binds = [artistCardId];

    try {
        // Use the specific interface ArtistSongInfo for type safety
        const results = await executeQuery<any>(sqlText, binds); // Use <any> temporarily to inspect results
        console.log(`[getSongsForArtist] Found ${results.length} songs in ${ARTIST_SONGS_TABLE} for Artist Card ID: ${artistCardId}`);
        
        // Log raw results to confirm structure/casing
        // console.log("[getSongsForArtist] Raw results:", JSON.stringify(results[0], null, 2)); // Log first result if needed

        // Map results, handling potential uppercase keys from Snowflake driver
        return results.map(row => ({
            unifiedSongId: row.unifiedSongId ?? row.UNIFIEDSONGID ?? row.UNIFIED_SONG_ID, // Check multiple casings
            spotifyTrackId: row.spotifyTrackId ?? row.SPOTIFYTRACKID ?? row.SPOTIFY_TRACK_ID, // Check multiple casings
            name: row.name ?? row.NAME // Check multiple casings
        }));

    } catch (error) {
        console.error(`[getSongsForArtist] Error fetching songs from ${ARTIST_SONGS_TABLE} for Artist Card ID ${artistCardId}:`, error);
        throw error; // Re-throw for higher-level handling
    }
}

// --- Add Artist Card Deletion Function ---
/**
 * Deletes an artist card and its associated songs and UGC links.
 * IMPORTANT: This performs deletions across multiple tables. Use with caution.
 * @param artistCardId - The ID of the artist card to delete.
 * @returns A promise resolving to true if all deletions were successful, false otherwise.
 * @throws If any of the database queries fail.
 */
export async function deleteArtistCard(artistCardId: number): Promise<boolean> {
    console.log(`[deleteArtistCard] Initiating deletion for Artist Card ID: ${artistCardId}`);
    if (!artistCardId) {
        console.error('[deleteArtistCard] Artist Card ID is required.');
        return false;
    }

    // Use a transaction or ensure atomicity if your connection setup supports it.
    // For simplicity here, we execute deletes sequentially. If one fails, subsequent ones might not run.
    // Consider adding transaction logic to executeQuery or handling failures more robustly.

    const deleteSongsSql = `DELETE FROM ${ARTIST_SONGS_TABLE} WHERE ARTIST_CARD_ID = ?`;
    const deleteUgcLinksSql = `DELETE FROM ${UGC_LINK_TABLE} WHERE ARTIST_CARD_ID = ?`;
    const deleteArtistCardSql = `DELETE FROM ${ARTIST_CARD_TABLE} WHERE ID = ?`;
    const binds = [artistCardId];

    try {
        console.log(`[deleteArtistCard] Deleting associated songs from ${ARTIST_SONGS_TABLE}...`);
        await executeQuery<any>(deleteSongsSql, binds);
        console.log(`[deleteArtistCard] Songs deleted.`);

        console.log(`[deleteArtistCard] Deleting associated UGC links from ${UGC_LINK_TABLE}...`);
        await executeQuery<any>(deleteUgcLinksSql, binds);
        console.log(`[deleteArtistCard] UGC links deleted.`);

        console.log(`[deleteArtistCard] Deleting artist card ${artistCardId} from ${ARTIST_CARD_TABLE}...`);
        await executeQuery<any>(deleteArtistCardSql, binds);
        console.log(`[deleteArtistCard] Artist Card ID: ${artistCardId} successfully deleted.`);

        return true; // All deletions succeeded without throwing errors

    } catch (error) {
        console.error(`[deleteArtistCard] Error during deletion process for Artist Card ID ${artistCardId}:`, error);
        // If an error occurred, some deletions might have succeeded while others failed.
        // Transaction management would be needed for rollback.
        throw error; // Re-throw the error
    }
}