import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "../../frontend/src/components/ui/card.js";
import { Input } from "../../frontend/src/components/ui/input.js";
import { Button } from "../../frontend/src/components/ui/button.js";
import { Alert, AlertDescription, AlertTitle } from "../../frontend/src/components/ui/alert.js";
import { ArtistCard } from '../data/artistCardData.js'; // Add .js extension
import { findOrCreateArtistCardByUrl } from '../services/artistCardService.js'; // Add .js extension
import ArtistDetail from '../components/ArtistDetail.js'; // Update path
import { Dialog, DialogTrigger, DialogContent } from "../../frontend/src/components/ui/dialog.js";
import { X } from 'lucide-react'; // Import the X icon

// --- API Fetching Functions ---

// Fetch all artist cards
const fetchArtistCards = async (): Promise<ArtistCard[]> => {
    console.log("[fetchArtistCards] Fetching...");
    const response = await fetch('/api/artist-cards');
    if (!response.ok) {
        console.error(`[fetchArtistCards] Failed. Status: ${response.status}`);
        throw new Error('Network response was not ok');
    }
    const data = await response.json();
    console.log(`[fetchArtistCards] Success. Fetched ${data.length} cards.`);
    return data;
};

// --- Add Delete Artist Function ---
const deleteArtist = async (artistId: number): Promise<void> => {
    console.log(`[deleteArtist] Deleting artist ID: ${artistId}`);
    const response = await fetch(`/api/artist-cards/${artistId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); // Try to get error body
        console.error(`[deleteArtist] Failed for ID ${artistId}. Status: ${response.status}`, errorData);
        throw new Error(errorData.error || `Failed to delete artist ${artistId}`);
    }
    // No body expected on 204 No Content
    console.log(`[deleteArtist] Successfully deleted artist ID: ${artistId}`);
};

// --- Component ---

const Index: React.FC = () => {
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState('');
    const [newArtistUrl, setNewArtistUrl] = useState('');
    const [selectedArtist, setSelectedArtist] = useState<ArtistCard | null>(null); // For modal

    // --- Queries ---
    const { data: artistCards, isLoading, error, refetch } = useQuery<ArtistCard[], Error>({
        queryKey: ['artistCards'],
        queryFn: fetchArtistCards,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });

    // --- Mutations ---
    // Existing mutation for creating artists (keep if needed)
    const createMutation = useMutation({
        mutationFn: findOrCreateArtistCardByUrl,
        onSuccess: () => {
            console.log("[createMutation] Success. Invalidating artistCards query.");
            queryClient.invalidateQueries({ queryKey: ['artistCards'] });
            setNewArtistUrl(''); // Clear input on success
        },
        onError: (err) => {
             console.error("[createMutation] Error:", err);
            // Add user feedback here (e.g., toast notification)
        },
    });

    // --- Add Delete Mutation ---
    const deleteMutation = useMutation({
        mutationFn: deleteArtist,
        onSuccess: () => {
            console.log("[deleteMutation] Success. Invalidating artistCards query.");
            queryClient.invalidateQueries({ queryKey: ['artistCards'] });
            // If the deleted artist was selected, close the modal
            if (selectedArtist && selectedArtist.ID === deleteMutation.variables) {
                setSelectedArtist(null);
            }
        },
        onError: (err) => {
            console.error("[deleteMutation] Error:", err);
            alert(`Failed to delete artist: ${err.message}`); // Simple error feedback
        },
    });

    // --- Event Handlers ---
    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value);
    };

    const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setNewArtistUrl(event.target.value);
    };

    const handleAddArtist = (event: React.FormEvent) => {
        event.preventDefault();
        if (!newArtistUrl.trim()) return;
        console.log(`[handleAddArtist] Triggering create mutation for URL: ${newArtistUrl}`);
        createMutation.mutate(newArtistUrl);
    };

    // --- Add Delete Handler ---
    const handleDeleteArtist = (e: React.MouseEvent, artistId: number, artistName: string | null) => {
        e.stopPropagation(); // Prevent triggering navigation/modal open
        e.preventDefault(); // Prevent any default link behavior

        if (window.confirm(`Are you sure you want to delete ${artistName || 'this artist'}? This action cannot be undone.`)) {
            console.log(`[handleDeleteArtist] Triggering delete mutation for ID: ${artistId}`);
            // Pass the artistId as variables to the mutation
            deleteMutation.mutate(artistId);
        }
    };

    // --- Filtering ---
    const filteredArtistCards = artistCards?.filter(artist =>
        artist.NAME?.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];

    // --- Render Logic ---
    return (
        <div className="container mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Artist Trend Dashboard</h1>

            {/* Add Artist Section (Keep if needed) */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>Add New Artist</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleAddArtist} className="flex gap-2">
                        <Input
                            type="url"
                            placeholder="Enter Spotify Artist URL..."
                            value={newArtistUrl}
                            onChange={handleUrlChange}
                            required
                            className="flex-grow"
                            disabled={createMutation.isPending}
                        />
                        <Button type="submit" disabled={createMutation.isPending}>
                            {createMutation.isPending ? 'Adding...' : 'Add Artist'}
                        </Button>
                    </form>
                     {createMutation.isError && (
                        <Alert variant="destructive" className="mt-4">
                            <AlertTitle>Error Adding Artist</AlertTitle>
                            <AlertDescription>
                                {(createMutation.error as Error)?.message || 'An unknown error occurred.'}
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>

            {/* Artist List Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Artists</CardTitle>
                    <Input
                        type="search"
                        placeholder="Search artists..."
                        value={searchTerm}
                        onChange={handleSearchChange}
                        className="mt-2"
                    />
                </CardHeader>
                <CardContent>
                    {isLoading && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {[...Array(6)].map((_, i) => <div className="animate-pulse bg-muted rounded-md h-20"></div>)}
                        </div>
                    )}
                    {error && (
                         <Alert variant="destructive">
                            <AlertTitle>Error Loading Artists</AlertTitle>
                            <AlertDescription>
                                {error.message || 'Could not fetch artist data.'}
                                <Button onClick={() => refetch()} variant="link" className="ml-2">Retry</Button>
                            </AlertDescription>
                        </Alert>
                    )}
                    {!isLoading && !error && filteredArtistCards.length === 0 && (
                        <p>No artists found{searchTerm ? ' matching your search' : ''}.</p>
                    )}
                    {!isLoading && !error && filteredArtistCards.length > 0 && (
                        <Dialog> {/* Wrap list in Dialog for modal */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filteredArtistCards.map(artist => (
                                    <div key={artist.ID} className="relative group"> {/* Added relative and group for positioning delete button */}
                                        <DialogTrigger asChild onClick={() => setSelectedArtist(artist)}>
                                            <Card className="hover:shadow-lg transition-shadow cursor-pointer flex items-center p-4 gap-4">
                                                <img
                                                    src={artist.IMAGE_URL_LARGE || 'placeholder.jpg'}
                                                    alt={artist.NAME || 'Artist'}
                                                    className="h-12 w-12 rounded-full object-cover flex-shrink-0"
                                                />
                                                <span className="font-medium truncate">{artist.NAME || 'Unnamed Artist'}</span>
                                                {/* Link functionality removed, using DialogTrigger now */}
                                            </Card>
                                        </DialogTrigger>
                                        {/* Delete Button */}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity z-10" // Positioned top-right, initially hidden, appears on hover
                                            onClick={(e: React.MouseEvent) => handleDeleteArtist(e, artist.ID, artist.NAME)}
                                            disabled={deleteMutation.isPending && deleteMutation.variables === artist.ID} // Disable only the specific button being deleted
                                            title={`Delete ${artist.NAME || 'artist'}`}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            {selectedArtist && (
                                <DialogContent className="max-w-4xl"> {/* Adjust width if needed */}
                                    {/* Pass selected artist and onClose handler */}
                                    <ArtistDetail artist={selectedArtist} onClose={() => setSelectedArtist(null)} />
                                </DialogContent>
                            )}
                        </Dialog>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default Index; 