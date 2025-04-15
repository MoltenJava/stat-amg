import dotenv from 'dotenv';
dotenv.config(); // Load .env variables

// --- Add this block for debugging ---
console.log("--- Environment Variables ---");
console.log("SNOWFLAKE_ACCOUNT:", process.env.SNOWFLAKE_ACCOUNT ? 'Loaded' : 'MISSING!');
console.log("SNOWFLAKE_USERNAME:", process.env.SNOWFLAKE_USERNAME ? 'Loaded' : 'MISSING!');
// console.log("SNOWFLAKE_PASSWORD:", process.env.SNOWFLAKE_PASSWORD ? 'Loaded' : 'MISSING!'); // Removed for SSO
console.log("SNOWFLAKE_WAREHOUSE:", process.env.SNOWFLAKE_WAREHOUSE ? 'Loaded' : 'MISSING!');
console.log("SNOWFLAKE_DATABASE:", process.env.SNOWFLAKE_DATABASE ? 'Loaded' : 'MISSING!');
console.log("SNOWFLAKE_SCHEMA:", process.env.SNOWFLAKE_SCHEMA); // Optional, might be undefined
console.log("SNOWFLAKE_ROLE:", process.env.SNOWFLAKE_ROLE); // Optional, might be undefined
console.log("---------------------------");
// --- End of debug block ---

import {
    testConnection,
    getSpotifyTracksByAccountId,
    getUnifiedSongIdsBySpotifyTrackIds,
    getWeeklyAudioMetricsByUnifiedSongIds,
    getWeeklyAudioMetricsBySpotifyAccountId,
    getWeeklyTikTokPostCounts,
    Region
} from './data/index.js'; // Assuming script is run from project root

async function runTests() {
    console.log("Testing Snowflake Connection...");
    const connectionOk = await testConnection();
    if (!connectionOk) {
        console.error("Connection test failed. Aborting further tests.");
        return;
    }

    const testSpotifyAccountId = 12345; // <-- REPLACE WITH A VALID SPOTIFY ACCOUNT ID
    const testSpotifyTrackIds = [987, 654]; // <-- REPLACE WITH VALID SPOTIFY TRACK IDs (numeric ID column)
    const testUnifiedSongIds = [555, 666]; // <-- REPLACE WITH VALID LUMINATE UNIFIED SONG IDs
    const testTiktokSoundIds = [111222, 333444]; // <-- REPLACE WITH VALID TIKTOK SOUND IDs
    const testRegion: Region = 'US';

    try {
        console.log(`\nTesting getSpotifyTracksByAccountId (${testSpotifyAccountId})...`);
        const tracks = await getSpotifyTracksByAccountId(testSpotifyAccountId);
        console.log(`Found ${tracks.length} tracks.`);
        // console.log(tracks); // Optional: Log full track data

        console.log(`\nTesting getUnifiedSongIdsBySpotifyTrackIds (${testSpotifyTrackIds})...`);
        const unifiedMap = await getUnifiedSongIdsBySpotifyTrackIds(testSpotifyTrackIds);
        console.log(`Found mappings for ${unifiedMap.size} tracks.`);
        // console.log(unifiedMap);

        console.log(`\nTesting getWeeklyAudioMetricsByUnifiedSongIds (${testUnifiedSongIds}, ${testRegion})...`);
        const weeklyMetrics = await getWeeklyAudioMetricsByUnifiedSongIds(testUnifiedSongIds, testRegion);
        console.log(`Found weekly metrics for ${weeklyMetrics.size} songs.`);
        // console.log(weeklyMetrics);

        console.log(`\nTesting getWeeklyAudioMetricsBySpotifyAccountId (Fallback) (${testSpotifyAccountId}, ${testRegion})...`);
        const fallbackMetrics = await getWeeklyAudioMetricsBySpotifyAccountId(testSpotifyAccountId, testRegion);
        console.log(`Fallback metrics:`, fallbackMetrics);

        console.log(`\nTesting getWeeklyTikTokPostCounts (${testTiktokSoundIds})...`);
        const tiktokMetrics = await getWeeklyTikTokPostCounts(testTiktokSoundIds);
        console.log(`Found TikTok metrics for ${tiktokMetrics.size} sounds.`);
        // console.log(tiktokMetrics);

        console.log("\nData layer tests completed.");

    } catch (error) {
        console.error("\nError during data layer tests:", error);
    }
}

runTests(); 