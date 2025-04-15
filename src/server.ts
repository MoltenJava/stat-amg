// src/server.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
// Remove apicache import - will be used in router
// import apicache from 'apicache'; 
import artistCardsRouter from './api/artistCardsRouter.js'; // Use .js
import songsRouter from './api/songsRouter.js'; // Import the new songs router
import reportsRouter from './api/reportsRouter.js'; // Import the reports router
import cors from 'cors';
// Remove admin routes import
// import adminRoutes from './routes/adminRoutes.js';
import {
    getUgcLinksForArtist, // Keep this one
    getDailySongStreamsForArtist // ADD THIS IMPORT BACK
} from './data/artistDetailData.js'; // PUT BACK .js extension

// Load environment variables (especially for PORT)
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000; // Use port from env var or default to 3000

// Remove cache initialization
// let cache = apicache.middleware;
// const cacheSuccesses = cache('1 hour');

// --- Middleware ---
// Express JSON middleware is already applied in the router,
// but applying it here is also fine and common practice.
app.use(express.json());
// Could add other middleware like CORS, logging later if needed
app.use(cors());

// --- Routes ---
app.get('/', (_req: Request, res: Response) => {
  res.send('Artist Trend Dashboard API');
});

// Remove incorrect cache application
// app.get('/api/artist-cards', cacheSuccesses, (req, res, next) => {
//     next(); 
// });

// Mount the artist cards router
app.use('/api/artist-cards', artistCardsRouter);

// Mount the new songs router
app.use('/api/songs', songsRouter);

// Mount the reports router
app.use('/api/reports', reportsRouter);

// Mount the admin routes (remove this line)
// app.use('/api/admin', adminRoutes);

// Define types for daily-streams endpoint
interface DailyStreamsParams {
    artistId: string;
}
interface DailyStreamsQuery {
    daysLookback?: string;
    unifiedSongId?: string;
}

// --- Endpoint to get COMBINED daily song streams for ONE artist (can filter by song) ---
// UNCOMMENTED the endpoint
app.get<
    DailyStreamsParams, 
    any, // Define response body type later if needed (e.g., DailySongStreamData[] | { error: string })
    any, 
    DailyStreamsQuery
>('/api/artist-cards/:artistId/daily-streams', async (req, res) => { 
  
  const logPrefix = '[API /daily-streams]'; // For logging
  
  // --- Parameter Parsing and Validation ---
  const artistId = parseInt(req.params.artistId, 10);
  // Default daysLookback to 30 if not provided or invalid
  const daysLookback = parseInt(req.query.daysLookback || '30', 10) || 30; 
  const unifiedSongIdQuery = req.query.unifiedSongId;
  const unifiedSongId = typeof unifiedSongIdQuery === 'string' ? parseInt(unifiedSongIdQuery, 10) : null;

  if (isNaN(artistId)) {
    console.error(`${logPrefix} Invalid artist ID received:`, req.params.artistId);
    res.status(400).json({ error: 'Invalid artist ID' });
    return;
  }
  // Validate unifiedSongId only if the query parameter existed and parsing failed
  if (unifiedSongIdQuery && isNaN(unifiedSongId as number)) { 
    console.error(`${logPrefix} Invalid unified song ID received:`, unifiedSongIdQuery);
    res.status(400).json({ error: 'Invalid unified song ID format' });
    return;
  }
  
  console.log(`${logPrefix} Received request for artist ${artistId}, days: ${daysLookback}, song: ${unifiedSongId ?? 'all'}`);

  // --- Data Fetching ---
  try {
    // Call the correct data function (which now points to SONG_DAILY_STREAM_METRICS)
    const data = await getDailySongStreamsForArtist(artistId, daysLookback, unifiedSongId);
    console.log(`${logPrefix} Successfully fetched ${data.length} stream records.`);
    res.json(data); 
  } catch (error) {
    console.error(`${logPrefix} Error fetching daily song streams for artist ${artistId}:`, error);
    res.status(500).json({ error: 'Internal server error fetching daily streams' }); 
  }
});

// --- REMOVED Endpoint for AGGREGATED daily streams (no longer needed) ---
/* // Removing this endpoint 
app.get('/api/artist-cards/:artistId/daily-streams/all', async (req, res) => {
  // ... (previous handler code) ... 
});
*/

// --- REMOVED Endpoint for HISTORICAL WEEKLY streams (decided against this approach for now) ---
/* // Removing this endpoint for now
app.get('/api/artists/:numericAccountId/weekly-streams-history', async (req, res) => {
  // ... (previous handler code) ...
});
*/

// Define types for request parameters and query
interface UgcLinksParams {
    artistId: string;
}

interface UgcLinksQuery {
    unifiedSongId?: string;
}

// --- Endpoint to get UGC links for an artist (can filter by song) ---
app.get<
    UgcLinksParams, // Type for req.params
    // Response body type is inferred or can be added back if needed, removing for now to fix TS error
    any, // Type for req.body (not used here)
    UgcLinksQuery // Type for req.query
>('/api/artist-cards/:artistId/ugc-links', async (req, res) => { // Removed explicit return type for res
    // --- Start of implementation ---
    const artistId = parseInt(req.params.artistId, 10);
    const unifiedSongIdQuery = req.query.unifiedSongId;
    // Ensure unifiedSongIdQuery is a string before parsing
    const unifiedSongId = 
        typeof unifiedSongIdQuery === 'string' ? 
        parseInt(unifiedSongIdQuery, 10) : 
        null;

    if (isNaN(artistId)) {
        res.status(400).json({ error: 'Invalid artist ID' });
        return; // Ensure function exits
    }
    // Check unifiedSongId only if the query param *existed* and *failed* parsing
    if (unifiedSongIdQuery && isNaN(unifiedSongId as number)) {
        res.status(400).json({ error: 'Invalid unified song ID format' }); // Clarify error
        return; // Ensure function exits
    }

    console.log(`[API /ugc-links] Received request for artist ${artistId}, song: ${unifiedSongId ?? 'all'}`);

    try {
        const links = await getUgcLinksForArtist(artistId, unifiedSongId);
        console.log(`[API /ugc-links] Found ${links.length} links.`);
        res.json(links);
    } catch (error) {
        console.error(`[API /ugc-links] Error fetching UGC links for artist ${artistId}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching UGC links' });
        // No explicit return needed here as it's the end of the try-catch
    }
    // --- End of implementation ---
});

// --- Error Handling ---
// Basic error handler middleware (catches errors passed by asyncHandler)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled Error:", err.stack || err.message);
  // Avoid sending stack traces in production
  res.status(500).json({ error: 'Something went wrong!' });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`[server]: Server is running at http://localhost:${PORT}`);
}); 