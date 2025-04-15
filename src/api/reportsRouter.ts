import express, { Request, Response, Router, NextFunction } from 'express';
import asyncHandler from 'express-async-handler'; // Import the wrapper
import { generateReportData } from '../services/reportService.js'; // Import the service
import crypto from 'crypto'; // For generating unique IDs
import * as dateFns from 'date-fns'; // Import date-fns for report naming
import { saveReport, getSavedReportById, listSavedReports } from '../data/savedReportsData.js'; // Import DB functions

const router: Router = express.Router();

// Define expected request body structure
interface ReportRequestBody {
    artistId: number;
    songIds?: number[]; // Optional, empty array means artist-level
    format: 'web' | 'pdf';
}

// --- Simple In-Memory Store for Web Reports (Replace with DB later) ---
// let webReportStore: Record<string, any> = {};

// --- Placeholder Functions for Actual Report Generation ---
const createPdfReport = async (reportData: any): Promise<Buffer> => {
    // TODO: Implement PDF generation using pdfkit, puppeteer, etc.
    console.log('[Reports Router] Generating PDF report (placeholder)... Artist:', reportData?.artist?.NAME);
    // Return a dummy buffer for now
    return Buffer.from(`Placeholder PDF Report for ${reportData?.artist?.NAME || 'Unknown Artist'}`);
};

const createWebReportLink = async (reportData: any): Promise<string> => {
    // Generate a unique ID
    const reportId = crypto.randomBytes(8).toString('hex');
    console.log('[Reports Router] Generating web report link (placeholder)... Artist:', reportData?.artist?.NAME);
    
    // Store the data in memory (replace with DB later)
    // webReportStore[reportId] = reportData;
    console.log(`[Reports Router] Stored report data in memory with ID: ${reportId}`);
    
    // Return the link to view the report
    return `/reports/view/${reportId}`;
};

// POST /api/reports - Generate and Save Report
router.post('/', asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { artistId, songIds, format } = req.body;
    console.log(`[Reports Router] Received report request:`);
    console.log(`  Artist ID: ${artistId}`);
    console.log(`  Song IDs: ${songIds?.join(', ') || 'All'}`);
    console.log(`  Format: ${format}`);

    if (!artistId) {
        res.status(400).json({ error: 'Artist ID is required' });
        return; // Return void
    }

    // --- Generate Report Data ---
    let reportData;
    try {
        reportData = await generateReportData(artistId, songIds);
        if (!reportData) {
            // generateReportData returns null if artist not found
            res.status(404).json({ error: 'Artist not found' });
            return; // Return void
        }
    } catch (error) {
        console.error(`[Reports Router] Error generating report data for artist ${artistId}:`, error);
        res.status(500).json({ error: 'Failed to generate report data' });
        return; // Return void
    }

    // --- Handle Different Formats ---
    if (format === 'pdf') {
        // TODO: Implement actual PDF generation logic
        console.log('[Reports Router] PDF format requested (not implemented yet)');
        res.status(501).json({ message: 'PDF report generation is not yet implemented.' });
        return; // Return void
    } else { // Default to 'web' format
        // --- Save Report to Database ---
        const reportId = crypto.randomUUID(); // Generate unique ID
        const reportName = `${reportData.artist.NAME || 'Unknown Artist'} - ${dateFns.format(new Date(), 'yyyy-MM-dd')}`;
        
        try {
            await saveReport(reportId, artistId, reportName, reportData);
            console.log(`[Reports Router] Successfully saved report ${reportId} to DB.`);
            
            // --- Respond with the persistent link --- 
            // Construct the URL based on how your frontend routing is set up
            // This link should navigate to the ReportView component with the correct reportId
            const reportUrl = `/reports/view/${reportId}`; // Matches the frontend route

            res.status(200).json({
                message: 'Report generated and saved successfully.',
                reportId: reportId,
                reportUrl: reportUrl 
            });

        } catch (dbError) {
            console.error(`[Reports Router] Error saving report ${reportId} to database:`, dbError);
            // If saving fails, we still generated the data, but can't provide a persistent link
            // Consider how to handle this - maybe return data directly, or a temporary link?
            // For now, return a server error.
            res.status(500).json({ error: 'Report generated, but failed to save.' });
        }
    }
}));

// GET /api/reports/:reportId - Retrieve Saved Report Data
router.get('/:reportId', asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { reportId } = req.params;
    console.log(`[Reports Router] Request received for saved report ID: ${reportId}`);

    // REMOVE In-memory check
    // const reportData = webReportStore[reportId];

    // --- Fetch Report from Database --- 
    try {
        const reportData = await getSavedReportById(reportId);

        if (reportData) {
            console.log(`[Reports Router] Found saved report ${reportId}, returning data.`);
            res.status(200).json(reportData);
        } else {
            console.log(`[Reports Router] Report ${reportId} not found in DB.`);
            res.status(404).json({ error: 'Report not found or has expired.' });
        }
    } catch (dbError) {
        console.error(`[Reports Router] Database error fetching report ${reportId}:`, dbError);
        res.status(500).json({ error: 'Failed to retrieve report due to database error.' });
    }
}));

// GET /api/reports - List Saved Reports (NEW ENDPOINT)
router.get('/', asyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logPrefix = '[Reports Router - List]';
    // Optional: Add query params for pagination (limit, offset) later
    const limit = parseInt(req.query.limit as string || '50', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);

    console.log(`${logPrefix} Request received to list reports. Limit: ${limit}, Offset: ${offset}`);
    
    try {
        const reports = await listSavedReports(limit, offset);
        console.log(`${logPrefix} Found ${reports.length} reports.`);
        res.status(200).json(reports);
    } catch (dbError) {
        console.error(`${logPrefix} Database error fetching reports list:`, dbError);
        res.status(500).json({ error: 'Failed to retrieve reports list.' });
    }
}));

export default router; 