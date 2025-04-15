    // frontend/src/pages/ReportsList.tsx
    import React from 'react';
    import { Link } from 'react-router-dom';
    import { Button } from '@/components/ui/button';
    import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';
    import { useQuery } from '@tanstack/react-query';
    import { format } from 'date-fns';
    import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

    // Define the structure matching the backend response from listSavedReports
    interface ReportListItem {
        reportId: string;
        reportName: string | null;
        artistId: number;
        artistName?: string | null; 
        generatedAt: string; // API returns date as string
    }

    // Function to fetch the list of reports
    const fetchReportsList = async (): Promise<ReportListItem[]> => {
        const response = await fetch('/api/reports'); // Call the backend endpoint
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to fetch reports list');
        }
        return response.json();
    };

    const ReportsList: React.FC = () => {
      // Fetch reports using react-query
      const { 
        data: reports, 
        isLoading, 
        error 
      } = useQuery<ReportListItem[], Error>({
          queryKey: ['savedReportsList'], // Unique query key
          queryFn: fetchReportsList,
          staleTime: 5 * 60 * 1000, // Cache for 5 minutes
      });

      return (
        <div className="container mx-auto px-4 py-8">
          <header className="mb-8 flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gradient">My Reports</h1>
            <Button asChild variant="outline">
              <Link to="/">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
              </Link>
            </Button>
          </header>

          {/* Loading State */}
          {isLoading && (
              <div className="flex justify-center items-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
          )}

          {/* Error State */}
          {error && (
              <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Error Loading Reports</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
              </Alert>
          )}

          {/* Content Area */}
          {!isLoading && !error && (
              <div className="space-y-4">
                {reports && reports.length > 0 ? (
                  reports.map((report) => (
                    <div key={report.reportId} className="p-4 border rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center shadow-sm bg-white gap-2">
                      <div className="flex-grow">
                        {/* Use reportName if available, otherwise construct one */}
                        <p className="font-medium">
                            {report.reportName || `${report.artistName || 'Artist'} Report - ${format(new Date(report.generatedAt), 'yyyy-MM-dd')}`}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            Generated: {format(new Date(report.generatedAt), 'PPpp')}
                        </p>
                      </div>
                      <Button asChild variant="secondary" size="sm" className="flex-shrink-0">
                        {/* Link to the report view page using the correct route */}
                        <Link to={`/reports/view/${report.reportId}`}>View Report</Link> 
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-muted-foreground italic py-10">
                    No reports found. Generate a report using the 'Create Report' button on the dashboard.
                  </p>
                )}
              </div>
          )}
        </div>
      );
    };

    export default ReportsList;