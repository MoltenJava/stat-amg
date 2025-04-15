import { executeQuery } from './connection.js';

// Import the exported ReportData interface
import { ReportData } from '../services/reportService.js';

const SAVED_REPORTS_TABLE = 'us_labels_sandbox.arya_s.SAVED_REPORTS';

/**
 * Saves a generated report to the database.
 * @param reportId - The unique ID generated for this report.
 * @param artistId - The ID of the primary artist for the report.
 * @param reportName - A user-friendly name for the report.
 * @param reportData - The full report data object (JSON).
 * @returns Promise resolving when the report is saved.
 */
export const saveReport = async (
    reportId: string,
    artistId: number,
    reportName: string | null,
    reportData: ReportData
): Promise<void> => {
    const logPrefix = '[saveReport]';
    const sql = `
        INSERT INTO ${SAVED_REPORTS_TABLE} (REPORT_ID, ARTIST_ID, REPORT_NAME, REPORT_DATA)
        VALUES (?, ?, ?, ?);
    `;
    // Store the data as a JSON string
    const reportDataString = JSON.stringify(reportData);
    const binds = [reportId, artistId, reportName, reportDataString];

    try {
        console.log(`${logPrefix} Saving report with ID: ${reportId} for Artist ID: ${artistId}`);
        await executeQuery(sql, binds);
        console.log(`${logPrefix} Successfully saved report ID: ${reportId}`);
    } catch (error) {
        console.error(`${logPrefix} Error saving report ID ${reportId}:`, error);
        // Re-throw the error so the caller knows the save failed
        throw new Error(`Failed to save report: ${(error as Error).message}`);
    }
};

/**
 * Retrieves saved report data from the database by its ID.
 * @param reportId - The unique ID of the report to retrieve.
 * @returns Promise resolving to the ReportData object or null if not found.
 */
export const getSavedReportById = async (reportId: string): Promise<ReportData | null> => {
    const logPrefix = '[getSavedReportById]';
    const sql = `
        SELECT REPORT_DATA
        FROM ${SAVED_REPORTS_TABLE}
        WHERE REPORT_ID = ?;
    `;
    const binds = [reportId];

    try {
        console.log(`${logPrefix} Fetching report with ID: ${reportId}`);
        // Expecting a string in the REPORT_DATA column now
        const results = await executeQuery<{ REPORT_DATA: string }>(sql, binds);

        if (results.length === 0 || !results[0].REPORT_DATA) {
            console.log(`${logPrefix} Report ID ${reportId} not found or has empty data.`);
            return null;
        }

        // Parse the JSON string back into an object
        try {
            const reportData = JSON.parse(results[0].REPORT_DATA) as ReportData;
            console.log(`${logPrefix} Successfully fetched and parsed report ID: ${reportId}`);
            return reportData;
        } catch (parseError) {
            console.error(`${logPrefix} Failed to parse report data for ID ${reportId}:`, parseError);
            return null; // Handle potential JSON parsing errors
        }

    } catch (error) {
        console.error(`${logPrefix} Error fetching report ID ${reportId}:`, error);
        // Return null or re-throw based on how you want calling code to handle DB errors
        return null;
    }
};

// --- Structure for Report List Items --- //
export interface ReportListItem {
    reportId: string;
    reportName: string | null;
    artistId: number;
    artistName?: string | null; // We'll need to join to get this
    generatedAt: Date;
}

/**
 * Lists saved reports, optionally joining with artist info.
 * @param limit - Max number of reports to return.
 * @param offset - Number of reports to skip (for pagination).
 * @returns Promise resolving to an array of ReportListItems.
 */
export const listSavedReports = async (limit: number = 50, offset: number = 0): Promise<ReportListItem[]> => {
    const logPrefix = '[listSavedReports]';
    // Join with ARTIST_CARDS to get the artist name
    const sql = `
        SELECT
            sr.REPORT_ID as reportId,
            sr.REPORT_NAME as reportName,
            sr.ARTIST_ID as artistId,
            ac.NAME as artistName,
            sr.GENERATED_AT as generatedAt
        FROM ${SAVED_REPORTS_TABLE} sr
        LEFT JOIN us_labels_sandbox.arya_s.ARTIST_CARDS ac ON sr.ARTIST_ID = ac.ID
        ORDER BY sr.GENERATED_AT DESC
        LIMIT ? OFFSET ?;
    `;
    const binds = [limit, offset];

    try {
        console.log(`${logPrefix} Fetching reports list with limit ${limit}, offset ${offset}`);
        // Define expected raw structure from DB (uppercase)
        const results = await executeQuery<{
            REPORTID: string;
            REPORTNAME: string | null;
            ARTISTID: number;
            ARTISTNAME: string | null;
            GENERATEDAT: string; // Snowflake returns timestamp string
        }>(sql, binds);

        // Map results to camelCase interface
        const reportList = results.map(row => ({
            reportId: row.REPORTID,
            reportName: row.REPORTNAME,
            artistId: row.ARTISTID,
            artistName: row.ARTISTNAME,
            generatedAt: new Date(row.GENERATEDAT) // Parse timestamp string
        }));

        console.log(`${logPrefix} Fetched ${reportList.length} reports.`);
        return reportList;
    } catch (error) {
        console.error(`${logPrefix} Error fetching reports list:`, error);
        return []; // Return empty array on error
    }
};
