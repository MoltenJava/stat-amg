import express, { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { getTopReactiveSongs } from '../services/analysisService.js'; // Assuming path

const router = express.Router();

/**
 * GET /api/songs/top-reactive
 * Fetches the top N most reactive songs based on pre-calculated scores.
 * Query Parameters:
 *  - limit: number (optional, default: 7) - The max number of songs to return.
 */
router.get('/top-reactive', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const limitParam = req.query.limit as string | undefined;
    let limit = 7; // Default limit

    if (limitParam) {
        const parsedLimit = parseInt(limitParam, 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
            limit = parsedLimit;
        } else {
            res.status(400).json({ error: 'Invalid limit parameter. Must be a positive number.' });
            return; // Exit early, return type is void
        }
    }

    console.log(`[API /songs/top-reactive] Request received with limit: ${limit}`);

    // Call the service function (which currently returns mock data)
    const topSongs = await getTopReactiveSongs(limit);

    res.status(200).json(topSongs);
    // Implicitly returns void
}));


// Add other song-related routes here...

export default router; 