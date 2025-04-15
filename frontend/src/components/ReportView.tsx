import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, AlertTriangle, FileText, RadioTower, Users } from 'lucide-react';
import { format, differenceInDays, subDays } from 'date-fns';
import ReportLineChart from './charts/ReportLineChart';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info } from 'lucide-react';

// Helper function to format large numbers (similar to ArtistCard)
const formatNumber = (num: number | null | undefined): string => {
    if (num === null || num === undefined) return 'N/A';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
};

// Helper to format reactivity score (correlation)
const formatCorrelation = (num: number | null | undefined): string => {
    if (num === null || num === undefined) return 'N/A';
    return num.toFixed(2); // Show two decimal places
};

// Helper function to calculate grade from numeric score
const calculateGradeFromScore = (score: number | null | undefined): string => {
    if (score === null || score === undefined || isNaN(score)) return 'N/A';
    if (score >= 0.9) return 'A';
    if (score >= 0.8) return 'B';
    if (score >= 0.7) return 'C';
    if (score >= 0.6) return 'D';
    return 'F'; 
};

// Define interfaces matching the expected structure from reportService.ts
interface Artist {
    ID: number;
    NAME: string | null;
    IMAGE_URL_LARGE?: string | null;
}
interface ReportSongDetail {
    info: {
        unifiedSongId: number;
        name: string | null;
        spotifyTrackId?: number | null;
    };
    dailyStreams?: Array<{ metricDate: string; usStreams: number | null }>;
    reactivityScore?: {
        unifiedSongId: number;
        correlation: number | null;
        grade: string;
        calculatedAt: string;
    };
}
interface ReportData {
    artist: Artist;
    songs: ReportSongDetail[]; 
    ugcTimeSeries?: Record<string, Array<{ DATE: string; VALUE: number | null }>>;
    generationDate: string; 
}

// Fetch function for report data
const fetchReportData = async (reportId: string | undefined): Promise<ReportData> => {
    if (!reportId) throw new Error('Report ID is required');
    const response = await fetch(`/api/reports/${reportId}`);
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Report not found or may have expired.');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch report data');
    }
    return response.json();
};

// Helper function to determine badge color based on grade (optional styling)
const getGradeColor = (grade: string): string => {
    switch (grade) {
        case 'A+':
        case 'A':
        case 'A-':
            return 'text-green-700 bg-green-100';
        case 'B+':
        case 'B':
        case 'B-':
            return 'text-blue-700 bg-blue-100';
        case 'C+':
        case 'C':
        case 'C-':
            return 'text-yellow-700 bg-yellow-100';
        case 'D':
            return 'text-orange-700 bg-orange-100';
        case 'F':
            return 'text-red-700 bg-red-100';
        default:
            return 'text-gray-700 bg-gray-100';
    }
};

const ReportView: React.FC = () => {
    const { reportId } = useParams<{ reportId: string }>();
    const navigate = useNavigate();

    const { 
        data: reportData, 
        isLoading, 
        error 
    } = useQuery<ReportData, Error>({
        queryKey: ['reportData', reportId],
        queryFn: () => fetchReportData(reportId),
        enabled: !!reportId, // Only run query if reportId is available
        retry: false, // Don't retry on 404
        staleTime: 5 * 60 * 1000, // Cache for 5 mins
    });

    // --- Process data for charts (Call BEFORE early returns) ---
    const streamingChartData = React.useMemo(() => {
        // Handle case where data is not yet loaded
        if (!reportData?.songs) return []; 

        const aggregatedStreams: Record<string, number> = {};
        let streamCount = 0;

        // Aggregate streams across all songs in the report
        reportData.songs.forEach(songDetail => {
            songDetail.dailyStreams?.forEach(stream => {
                if (stream.usStreams !== null) {
                    aggregatedStreams[stream.metricDate] = (aggregatedStreams[stream.metricDate] || 0) + stream.usStreams;
                    streamCount++;
                }
            });
        });

        if (streamCount === 0) return [];

        // Convert to chart format and sort by date
        return Object.entries(aggregatedStreams)
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    }, [reportData?.songs]); // Dependency remains the same

    // --- Process data for UGC Chart --- 
    const ugcChartData = React.useMemo(() => {
        console.log("[ReportView] Processing UGC Chart Data. Raw ugcTimeSeries:", reportData?.ugcTimeSeries);
        // Handle case where data is not yet loaded or empty
        if (!reportData?.ugcTimeSeries || Object.keys(reportData.ugcTimeSeries).length === 0) {
            console.log("[ReportView UGC] No raw ugcTimeSeries data found.");
            return [];
        }

        const aggregatedUgc: Record<string, number> = {};
        let ugcCount = 0;
        let pointsProcessed = 0;

        // Aggregate UGC posts across all sounds in the report
        Object.values(reportData.ugcTimeSeries).forEach((soundData, soundIndex) => {
            console.log(`[ReportView UGC] Processing soundData[${soundIndex}]:`, soundData);
            soundData.forEach((point, pointIndex) => {
                pointsProcessed++;
                // Adjust check and access to use UPPERCASE properties from backend
                if (point && point.VALUE !== null && typeof point.DATE === 'string') { 
                    // Ensure date is in YYYY-MM-DD format before aggregation
                    const dateKey = point.DATE.substring(0, 10);
                    aggregatedUgc[dateKey] = (aggregatedUgc[dateKey] || 0) + point.VALUE;
                    ugcCount++;
                } else {
                     // Log potentially incorrect casing or missing properties
                     console.warn(`[ReportView UGC] Skipping invalid point[${pointIndex}] in soundData[${soundIndex}]:`, point, `Expected { DATE: string, VALUE: number }`);
                }
            });
        });
        console.log(`[ReportView UGC] Total points processed: ${pointsProcessed}, Valid points counted: ${ugcCount}`);

        if (ugcCount === 0) {
            console.log("[ReportView UGC] No valid UGC points found after processing.");
            return [];
        }

        // Convert to chart format and sort by date
        const finalChartData = Object.entries(aggregatedUgc)
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => new Date(a.date + 'T00:00:00').getTime() - new Date(b.date + 'T00:00:00').getTime());
            
        console.log("[ReportView UGC] Final chart data:", finalChartData);
        return finalChartData;

    }, [reportData?.ugcTimeSeries]);

    // --- Calculate Key Metrics ---
    const keyMetrics = React.useMemo(() => {
        if (!reportData) return { totalStreams30d: null, avgReactivity: null, peakUgc: null, avgReactivityGrade: 'N/A' };

        // Calculate Total Streams (Last 30 Days)
        let totalStreams30d = 0;
        let streamCount = 0;
        const thirtyDaysAgo = subDays(new Date(reportData.generationDate), 30);
        reportData.songs.forEach(song => {
            song.dailyStreams?.forEach(stream => {
                const streamDate = new Date(stream.metricDate);
                if (stream.usStreams !== null && streamDate >= thirtyDaysAgo) {
                    totalStreams30d += stream.usStreams;
                    streamCount++;
                }
            });
        });

        // Calculate Average Reactivity
        let totalCorrelation = 0;
        let reactivityCount = 0;
        reportData.songs.forEach(song => {
            if (song.reactivityScore?.correlation !== null && song.reactivityScore?.correlation !== undefined) {
                totalCorrelation += song.reactivityScore.correlation;
                reactivityCount++;
            }
        });
        const avgReactivity = reactivityCount > 0 ? totalCorrelation / reactivityCount : null;
        const avgReactivityGrade = calculateGradeFromScore(avgReactivity);

        // Calculate Peak UGC (from processed ugcChartData)
        const peakUgc = ugcChartData.length > 0 ? Math.max(...ugcChartData.map(d => d.value)) : null;

        return {
            totalStreams30d: streamCount > 0 ? totalStreams30d : null,
            avgReactivity,
            peakUgc,
            avgReactivityGrade
        };
    }, [reportData, ugcChartData]); // Dependencies include reportData and derived ugcChartData

    // Function to navigate back to the dashboard (home route)
    const goToDashboard = () => {
        navigate('/');
    };

    if (isLoading) {
        return (
             <div className="min-h-screen p-4 md:p-8">
                <Skeleton className="h-8 w-24 mb-8" /> {/* Back button placeholder */}
                <div className="max-w-4xl mx-auto">
                    <Skeleton className="h-16 w-1/2 mb-4 mx-auto" />
                    <Skeleton className="h-8 w-1/4 mb-8 mx-auto" />
                    <Card>
                        <CardHeader><Skeleton className="h-6 w-1/3" /></CardHeader>
                        <CardContent className="space-y-4">
                            <Skeleton className="h-40 w-full" />
                            <Skeleton className="h-10 w-full" />
                        </CardContent>
                    </Card>
                </div>
             </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen p-4 md:p-8 flex flex-col items-center justify-center">
                 <Alert variant="destructive" className="max-w-2xl mx-auto">
                    <AlertTitle>Error Loading Report</AlertTitle>
                    <AlertDescription>{error.message}</AlertDescription>
                 </Alert>
                 <Button variant="outline" onClick={goToDashboard} className="mt-4">
                     <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Dashboard
                 </Button>
            </div>
        );
    }

    if (!reportData) {
         // Should be covered by error state, but good fallback
        return <div className="p-8 text-center">Report data not available.</div>;
    }

    // --- Render the Beautiful Report --- 
    return (
        <div className="min-h-screen p-4 md:p-8 bg-gradient-to-br from-gray-100 to-slate-200 font-sans">
            {/* Back Button - Updated onClick */}
            <Button variant="outline" onClick={goToDashboard} className="mb-6 bg-white shadow-sm hover:bg-gray-50">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
            </Button>

            <div className="max-w-5xl mx-auto bg-white rounded-lg shadow-xl overflow-hidden p-8">
                {/* Report Header */}
                <header className="mb-10 pb-6 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                        <h1 className="text-4xl font-bold text-gray-800 tracking-tight">
                            Artist Performance Report
                        </h1>
                        {/* Optional: Logo placement */}
                        {/* <img src="/logo.PNG" alt="Logo" className="h-10" /> */}
                    </div>
                    <div className="flex items-center space-x-4">
                        {reportData.artist.IMAGE_URL_LARGE && (
                             <img 
                                src={reportData.artist.IMAGE_URL_LARGE}
                                alt={reportData.artist.NAME || 'Artist'}
                                className="h-16 w-16 rounded-full object-cover border-2 border-white shadow-md"
                             />
                        )}
                        <div>
                            <h2 className="text-2xl font-semibold text-gray-700">
                                {reportData.artist.NAME || 'Unknown Artist'}
                            </h2>
                             <p className="text-sm text-gray-500">
                                Report Generated: {format(new Date(reportData.generationDate), 'MMMM d, yyyy, h:mm a')}
                            </p>
                        </div>
                    </div>
                </header>

                {/* Report Body - Placeholder Sections */}
                <section className="mb-8">
                    <h3 className="text-xl font-semibold text-gray-700 mb-4">Key Metrics Overview</h3>
                    {/* Placeholder for KPI cards (Streams, UGC, Reactivity Summary) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card className="bg-slate-50">
                            <CardHeader><CardTitle className="text-sm text-muted-foreground">Total Streams (30d)</CardTitle></CardHeader>
                            <CardContent><p className="text-2xl font-bold">{formatNumber(keyMetrics.totalStreams30d)}</p></CardContent>
                        </Card>
                        <Card className="bg-slate-50">
                            <CardHeader>
                                <CardTitle className="text-sm text-muted-foreground flex justify-between items-center">
                                    <span>Avg. Reactivity (US)</span>
                                    {/* Info Popover Trigger */}
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-foreground -mr-2">
                                                <Info className="h-4 w-4" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="text-sm w-60" side="top" align="end">
                                            <p className="font-semibold mb-1">Avg. Reactivity Score</p>
                                            <p className="text-xs text-muted-foreground mb-2">
                                                Average correlation between daily streams & UGC posts (US, 1 month) across songs in this report.
                                            </p>
                                            <p>Avg Score: <span className="font-semibold">{formatCorrelation(keyMetrics.avgReactivity)}</span></p>
                                            <p>Avg Grade: <span className={`font-semibold ${getGradeColor(keyMetrics.avgReactivityGrade)}`}>{keyMetrics.avgReactivityGrade}</span></p>
                                            {/* Optional: Add count */} 
                                            {/* <p className="text-xs text-muted-foreground mt-1">Based on {reactivityCount} songs</p> */}
                                        </PopoverContent>
                                    </Popover>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {/* Display Grade */} 
                                <p className={`text-2xl font-bold px-2 py-0.5 rounded-md inline-block ${getGradeColor(keyMetrics.avgReactivityGrade)}`}>
                                    {keyMetrics.avgReactivityGrade}
                                </p>
                            </CardContent>
                        </Card>
                        <Card className="bg-slate-50">
                            <CardHeader><CardTitle className="text-sm text-muted-foreground">Peak Daily UGC Posts</CardTitle></CardHeader>
                            <CardContent><p className="text-2xl font-bold">{formatNumber(keyMetrics.peakUgc)}</p></CardContent>
                        </Card>
                    </div>
                </section>

                <section className="mb-8">
                    <h3 className="text-xl font-semibold text-gray-700 mb-4">Streaming Trends</h3>
                    <Card>
                         <CardContent className="pt-6">
                              <div className="h-72">
                                 <ReportLineChart 
                                     data={streamingChartData} 
                                     color="#10b981"
                                     tooltipLabel="Streams"
                                     dataKey="value"
                                 />
                             </div>
                         </CardContent>
                    </Card>
                </section>
                
                 <section className="mb-8">
                    <h3 className="text-xl font-semibold text-gray-700 mb-4">UGC Trends</h3>
                     {/* Render UGC Chart */}
                     <Card>
                         <CardContent className="pt-6">
                             <div className="h-72">
                                 <ReportLineChart 
                                     data={ugcChartData} 
                                     color="#8b5cf6" // Example: Purple color
                                     tooltipLabel="UGC Posts"
                                     dataKey="value"
                                 />
                             </div>
                         </CardContent>
                    </Card>
                </section>

                {/* Report Footer */}
                <footer className="mt-10 pt-6 border-t border-gray-200 text-center">
                    <p className="text-xs text-gray-500">
                         powered by stats - know ur numbers
                         {/* Optional: Logo */}
                         {/* <img src="/logo.PNG" alt="stats logo" className="inline-block h-4 ml-1" /> */}
                    </p>
                </footer>
            </div>
        </div>
    );
};

export default ReportView; 