import { calculateSongReactivity, Region } from '../services/analysisService.js';
// --- IMPORTANT: Define how to get your artists/songs ---
// Example 2: Define a simple Artist type if fetching differently
interface ArtistForJob { ID: number; NAME: string | null; } // Using this simple type for now

import { getArtistSongs, getUgcLinksForArtist, ArtistUgcLink } from '../data/artistDetailData.js';
import { executeQuery } from '../data/connection.js'; // Assumed path

// --- Configuration ---
const JOB_REGION: Region = 'US'; // Region to calculate for
const JOB_MONTHS = 1; // Time period for calculation (last 1 month)
const DB_TABLE_NAME = 'us_labels_sandbox.arya_s.SONG_REACTIVITY_SCORES'; // Adjust if needed

// --- Helper to get Date Range ---
const getIsoDateRangeForJob = (monthsAgo: number): { startDate: string; endDate: string } => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - monthsAgo);
    const format = (date: Date) => date.toISOString().split('T')[0];
    return {
        startDate: format(startDate),
        endDate: format(endDate),
    };
};

// --- Function to Update or Insert Scores using MERGE ---
async function saveReactivityScore(
    unifiedSongId: number,
    artistCardId: number,
    songName: string | null,
    artistName: string | null,
    correlation: number | null,
    grade: string,
    region: Region,
    months: number
) {
    // Using MERGE to insert if not exists, or update if exists for the same song/region/month combo
    const sqlText = `
        MERGE INTO ${DB_TABLE_NAME} AS target
        USING (
            SELECT
                ? AS UNIFIED_SONG_ID, ? AS ARTIST_CARD_ID, ? AS SONG_NAME, ? AS ARTIST_NAME,
                ? AS CORRELATION, ? AS GRADE, ? AS REGION, ? AS CALCULATION_RANGE_MONTHS,
                CURRENT_TIMESTAMP() AS CALCULATED_AT
        ) AS source
        ON target.UNIFIED_SONG_ID = source.UNIFIED_SONG_ID
           AND target.REGION = source.REGION
           AND target.CALCULATION_RANGE_MONTHS = source.CALCULATION_RANGE_MONTHS
        WHEN MATCHED THEN
            UPDATE SET
                target.ARTIST_CARD_ID = source.ARTIST_CARD_ID,
                target.SONG_NAME = source.SONG_NAME,
                target.ARTIST_NAME = source.ARTIST_NAME,
                target.CORRELATION = source.CORRELATION,
                target.GRADE = source.GRADE,
                target.CALCULATED_AT = source.CALCULATED_AT
        WHEN NOT MATCHED THEN
            INSERT (UNIFIED_SONG_ID, ARTIST_CARD_ID, SONG_NAME, ARTIST_NAME, CORRELATION, GRADE, REGION, CALCULATION_RANGE_MONTHS, CALCULATED_AT)
            VALUES (
                source.UNIFIED_SONG_ID, source.ARTIST_CARD_ID, source.SONG_NAME, source.ARTIST_NAME,
                source.CORRELATION, source.GRADE, source.REGION, source.CALCULATION_RANGE_MONTHS, source.CALCULATED_AT
            );
    `;
    // Ensure binds are in the correct order corresponding to the placeholders (?)
    const binds = [
        unifiedSongId, artistCardId, songName, artistName,
        correlation, grade, region, months
    ];

    try {
        await executeQuery(sqlText, binds);
        console.log(`[Reactivity Job] Saved score for Song ID ${unifiedSongId}`);
    } catch (error) {
        console.error(`[Reactivity Job] FAILED to save score for Song ID ${unifiedSongId}:`, error);
        throw error; // Re-throw to indicate failure for this song
    }
}

// --- Function to Get All Artists for the Job ---
async function getAllArtistsForJob(): Promise<ArtistForJob[]> {
    console.log("[Reactivity Job] Fetching artists from ARTIST_CARDS table...");
    // Adjust table name if necessary
    const sqlText = `SELECT ID, NAME FROM us_labels_sandbox.arya_s.ARTIST_CARDS ORDER BY ID ASC;`; 
    try {
        const results = await executeQuery<any>(sqlText); // Use <any> or define specific type
        // Map results to the expected ArtistForJob interface
        const artists = results.map((row: any) => ({
            ID: Number(row.ID), // Ensure ID is a number
            NAME: row.NAME as string | null
        }));
        console.log(`[Reactivity Job] Found ${artists.length} artists.`);
        console.log(`[Reactivity Job] getAllArtistsForJob is about to return ${artists.length} artists.`); // Log before returning
        return artists;
    } catch (error) {
        console.error("[Reactivity Job] Error fetching artists from database:", error);
        return []; // Return empty array on error to prevent job failure
    }
}

// --- Main Job Function ---
export async function calculateAndStoreReactivityForAllSongs() {
    console.log('[Reactivity Job] Starting calculation...');
    const jobStartTime = Date.now();
    const { startDate, endDate } = getIsoDateRangeForJob(JOB_MONTHS);
    let songsProcessed = 0;
    let errorsEncountered = 0;

    try {
        const artists = await getAllArtistsForJob(); // Uses the placeholder above
        console.log(`[Reactivity Job] Found ${artists.length} artists to process.`);

        for (const artist of artists) {
            if (!artist || typeof artist.ID !== 'number') {
                 console.warn(`[Reactivity Job] Skipping invalid artist data:`, artist);
                 continue;
            }
            console.log(`[Reactivity Job] Processing Artist ID ${artist.ID} (${artist.NAME || 'N/A'})...`);
            try {
                const songs = await getArtistSongs(artist.ID);
                const ugcLinks = await getUgcLinksForArtist(artist.ID, null); // Fetch all UGC links for the artist

                if (!songs || songs.length === 0) {
                    console.log(`[Reactivity Job] No songs found for Artist ID ${artist.ID}.`);
                    continue;
                }

                // Create a set of song IDs that have UGC links
                const songIdsWithUgc = new Set<number>();
                ugcLinks.forEach(link => {
                    if (link.UNIFIED_SONG_ID !== null) { // Check for non-null before adding
                        songIdsWithUgc.add(link.UNIFIED_SONG_ID);
                    }
                });

                // Filter songs to only include those with UGC links
                const songsToProcess = songs.filter(song => song && song.unifiedSongId && songIdsWithUgc.has(song.unifiedSongId));

                if (songsToProcess.length === 0) {
                    console.log(`[Reactivity Job] No songs with linked UGC found for Artist ID ${artist.ID}. Skipping reactivity calc.`);
                    continue;
                }

                console.log(`[Reactivity Job] Found ${songs.length} total songs, ${ugcLinks.length} UGC links, processing ${songsToProcess.length} songs with linked UGC for Artist ID ${artist.ID}.`);

                for (const song of songsToProcess) {
                     if (!song || typeof song.unifiedSongId !== 'number') {
                         console.warn(`[Reactivity Job] Skipping invalid song data for Artist ${artist.ID}:`, song);
                         continue;
                     }
                    try {
                        // Calculate reactivity using the existing service function
                        const result = await calculateSongReactivity(
                            artist.ID,
                            song.unifiedSongId,
                            JOB_REGION,
                            startDate,
                            endDate
                        );

                        // Save the result (correlation and grade) to the database
                        await saveReactivityScore(
                            song.unifiedSongId,
                            artist.ID,
                            song.name, // Assuming getArtistSongs provides 'name'
                            artist.NAME,
                            result.correlation,
                            result.grade,
                            JOB_REGION,
                            JOB_MONTHS
                        );
                        songsProcessed++;

                    } catch (songError) {
                        console.error(`[Reactivity Job] Error calculating/saving reactivity for Song ${song.unifiedSongId} (Artist ${artist.ID}):`, songError);
                        errorsEncountered++;
                        // Optional: Decide whether to continue with the next song or stop
                    }
                    // Optional: Add a small delay here if hitting API rate limits
                    // await new Promise(resolve => setTimeout(resolve, 50));
                }
            } catch (artistSongsError) {
                 console.error(`[Reactivity Job] Error fetching/processing songs for Artist ${artist.ID}:`, artistSongsError);
                 errorsEncountered++;
                 // Optional: Decide whether to continue with the next artist or stop
            }
        }

    } catch (fetchArtistsError) {
        console.error('[Reactivity Job] CRITICAL error fetching artists list:', fetchArtistsError);
        errorsEncountered++; // Mark job as having errors
    }

    const duration = (Date.now() - jobStartTime) / 1000;
    console.log(`[Reactivity Job] Finished in ${duration.toFixed(2)} seconds. Songs Processed: ${songsProcessed}, Errors: ${errorsEncountered}`);
}

// --- Example: How you might trigger the job ---
// This line would typically be run by your scheduler, not necessarily kept here.
// If you run this file directly (e.g., `node dist/jobs/calculateReactivityJob.js`), it will execute.
console.log("[Reactivity Job Script] Attempting to run calculateAndStoreReactivityForAllSongs..."); // Log script execution start
calculateAndStoreReactivityForAllSongs().catch(err => {
    console.error("[Reactivity Job Script] Job execution failed:", err);
    process.exit(1); // Exit with error code if the main function fails
}); 