import { executeQuery } from './connection.js';

// Define the interface based on the Snowflake schema
export interface SpotifyTrack {
  ID: number;
  SPOTIFY_ID: string;
  NAME: string;
  POPULARITY: number | null; // Nullable based on typical DB practices
  PREVIEW_URL: string | null;
  ISRC: string | null;
  SANITIZED_ISRC: string | null;
  DURATION_MS: number | null;
  SPOTIFY_ALBUM_ID: number | null;
  COMPUTED_LANGUAGE: string | null;
  PRIMARY_SPOTIFY_ACCOUNT_ID: number | null;
  RADIO_PLAYLIST_SPOTIFY_ID: string | null;
  UPDATED_AT: Date | null; // Map TIMESTAMP_NTZ to Date
}

const TABLE_NAME = 'sodatone.sodatone.spotify_tracks';

/**
 * Fetches Spotify tracks associated with a primary account ID (assumed artist ID).
 *
 * @param accountId The PRIMARY_SPOTIFY_ACCOUNT_ID to query for.
 * @returns A promise that resolves with an array of SpotifyTrack objects.
 */
export async function getSpotifyTracksByAccountId(accountId: number): Promise<SpotifyTrack[]> {
  if (!accountId) {
    console.error('Account ID is required to fetch Spotify tracks.');
    return [];
  }
  const sqlText = `
    SELECT
      ID,
      SPOTIFY_ID,
      NAME,
      POPULARITY,
      PREVIEW_URL,
      ISRC,
      SANITIZED_ISRC,
      DURATION_MS,
      SPOTIFY_ALBUM_ID,
      COMPUTED_LANGUAGE,
      PRIMARY_SPOTIFY_ACCOUNT_ID,
      RADIO_PLAYLIST_SPOTIFY_ID,
      UPDATED_AT
    FROM ${TABLE_NAME}
    WHERE PRIMARY_SPOTIFY_ACCOUNT_ID = ?;
  `;
  try {
    const results = await executeQuery<SpotifyTrack>(sqlText, [accountId]);
    return results;
  } catch (error) {
    console.error(`Error fetching Spotify tracks for account ID ${accountId}:`, error);
    throw error; // Re-throw the error for higher-level handling
  }
}

/**
 * Fetches a single Spotify track by its Spotify ID.
 *
 * @param spotifyId The SPOTIFY_ID of the track to fetch.
 * @returns A promise that resolves with the SpotifyTrack object or null if not found.
 */
export async function getSpotifyTrackBySpotifyId(spotifyId: string): Promise<SpotifyTrack | null> {
  if (!spotifyId) {
    console.error('Spotify ID is required to fetch a Spotify track.');
    return null;
  }
  const sqlText = `
    SELECT
      ID,
      SPOTIFY_ID,
      NAME,
      POPULARITY,
      PREVIEW_URL,
      ISRC,
      SANITIZED_ISRC,
      DURATION_MS,
      SPOTIFY_ALBUM_ID,
      COMPUTED_LANGUAGE,
      PRIMARY_SPOTIFY_ACCOUNT_ID,
      RADIO_PLAYLIST_SPOTIFY_ID,
      UPDATED_AT
    FROM ${TABLE_NAME}
    WHERE SPOTIFY_ID = ?
    LIMIT 1;
  `;
  try {
    const results = await executeQuery<SpotifyTrack>(sqlText, [spotifyId]);
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error(`Error fetching Spotify track with Spotify ID ${spotifyId}:`, error);
    throw error; // Re-throw the error for higher-level handling
  }
}

// --- NEW: SPOTIFY_ACCOUNTS Table ---
export interface SpotifyAccount {
  ID: number; // This is the numeric SPOTIFY_ACCOUNT_ID used elsewhere
  SPOTIFY_ID: string; // The alphanumeric ID from the URL
  NAME: string | null;
  POPULARITY: number | null;
  SPOTIFY_URL: string | null;
  FOLLOWER_COUNT: number | null;
  IMAGE_URL_LARGE: string | null;
  IMAGE_URL_MEDIUM: string | null;
  IMAGE_URL_SMALL: string | null;
  HEADER_IMAGE_URL: string | null;
  ARTIST_ID: number | null; // Is this different from ID?
  UPDATED_AT: Date | null;
}

const ACCOUNTS_TABLE_NAME = 'sodatone.sodatone.spotify_accounts';

/**
 * Fetches Spotify account details using the alphanumeric Spotify ID.
 *
 * @param spotifyId The alphanumeric Spotify ID (e.g., from a URL).
 * @returns A promise resolving to the SpotifyAccount object or null if not found.
 */
export async function getSpotifyAccountBySpotifyId(spotifyId: string): Promise<SpotifyAccount | null> {
  if (!spotifyId) {
    console.error('Spotify ID string is required to fetch account details.');
    return null;
  }
  const sqlText = `
    SELECT
        ID, SPOTIFY_ID, NAME, POPULARITY, SPOTIFY_URL, FOLLOWER_COUNT,
        IMAGE_URL_LARGE, IMAGE_URL_MEDIUM, IMAGE_URL_SMALL, HEADER_IMAGE_URL,
        ARTIST_ID, UPDATED_AT
    FROM ${ACCOUNTS_TABLE_NAME}
    WHERE SPOTIFY_ID = ?
    LIMIT 1;
  `;
  try {
    const results = await executeQuery<SpotifyAccount>(sqlText, [spotifyId]);
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error(`Error fetching Spotify account for Spotify ID ${spotifyId}:`, error);
    throw error;
  }
}

// --- NEW: SPOTIFY_ACCOUNT_TRACKS Table ---
export interface SpotifyAccountTrack {
  ID: number;
  SPOTIFY_ACCOUNT_ID: number; // Numeric account ID (maps to SpotifyAccount.ID)
  SPOTIFY_TRACK_ID: number; // Numeric track ID (maps to LUMINATE_UNIFIED_SONG_SPOTIFY_TRACKS.SPOTIFY_TRACK_ID)
  PRIMARY: boolean | null;
  CREATED_AT: Date | null;
  UPDATED_AT: Date | null;
}

const ACCOUNT_TRACKS_TABLE_NAME = 'sodatone.sodatone.spotify_account_tracks';

/**
 * Fetches associated Spotify Track IDs (numeric) for a given Spotify Account ID (numeric).
 *
 * @param accountId The numeric Spotify Account ID (from SpotifyAccount.ID).
 * @returns A promise resolving to an array of numeric Spotify Track IDs.
 */
export async function getTrackIdsBySpotifyAccountId(accountId: number): Promise<number[]> {
  if (!accountId) {
    console.error('Numeric Spotify Account ID is required to fetch associated track IDs.');
    return [];
  }
  const sqlText = `
    SELECT
        SPOTIFY_TRACK_ID
    FROM ${ACCOUNT_TRACKS_TABLE_NAME}
    WHERE SPOTIFY_ACCOUNT_ID = ?;
  `;
  try {
    // Result will be like [{ SPOTIFY_TRACK_ID: 123 }, { SPOTIFY_TRACK_ID: 456 }]
    type TrackIdResult = { SPOTIFY_TRACK_ID: number };
    const results = await executeQuery<TrackIdResult>(sqlText, [accountId]);
    // Extract just the IDs into a simple array
    return results.map(row => row.SPOTIFY_TRACK_ID);
  } catch (error) {
    console.error(`Error fetching track IDs for Spotify Account ID ${accountId}:`, error);
    throw error;
  }
}

/**
 * Fetches the ISRC for a given list of Spotify Track IDs (numeric primary keys).
 *
 * @param spotifyTrackIds An array of Spotify track IDs (numeric PKs from spotify_tracks).
 * @returns A promise resolving to a Map<number, string | null> where the key is the Spotify Track ID
 *          and the value is the corresponding ISRC (or null if not found/null in DB).
 */
export async function getIsrcsBySpotifyTrackIds(
  spotifyTrackIds: number[]
): Promise<Map<number, string | null>> {
  const isrcMap = new Map<number, string | null>();
  if (!spotifyTrackIds || spotifyTrackIds.length === 0) {
    console.log('No Spotify Track IDs provided to getIsrcsBySpotifyTrackIds.');
    return isrcMap;
  }

  const placeholders = spotifyTrackIds.map(() => '?').join(',');
  const binds = [...spotifyTrackIds];

  // Query the spotify_tracks table using the numeric primary key (ID)
  const sqlText = `
    SELECT
      ID, -- This is the numeric Spotify Track ID
      ISRC
    FROM ${TABLE_NAME} -- sodatone.sodatone.spotify_tracks
    WHERE ID IN (${placeholders});
  `;

  try {
    // Define a type for the specific query result
    type IsrcResult = {
      ID: number;
      ISRC: string | null;
    };

    const results = await executeQuery<IsrcResult>(sqlText, binds);

    results.forEach((row) => {
      isrcMap.set(row.ID, row.ISRC);
    });

    console.log(`Fetched ISRCs for ${isrcMap.size} out of ${spotifyTrackIds.length} requested Spotify track IDs.`);
    return isrcMap;

  } catch (error) {
    console.error(`Error fetching ISRCs for Spotify track IDs:`, error);
    throw error;
  }
}

// Add other potential functions as needed, e.g., get multiple tracks by list of IDs 