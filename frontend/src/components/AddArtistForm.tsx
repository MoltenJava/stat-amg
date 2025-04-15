import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { getApiUrl } from '@/lib/apiUtils'; // Import the utility

// Define a minimal structure for the expected return if any
// Replace `unknown` with a more specific type if you know the backend response
interface AddArtistResponse {
  // Define properties expected from the backend on successful add/find
  // e.g., id: number; name: string;
  [key: string]: unknown; // Use unknown instead of any
}

// API function to post the new artist URL
// The function might return the created/found Artist object or just status
// Adjust the Promise return type based on your actual backend response
const addArtist = async (spotifyUrl: string): Promise<AddArtistResponse | void> => {
  const apiUrl = getApiUrl('/api/artist-cards'); // Use util
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spotifyUrl }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  // Check if backend sends a body on success
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.indexOf("application/json") !== -1) {
    return response.json();
  } else {
    return; // No body expected
  }
};

interface AddArtistFormProps {
  onClose: () => void;
}

const AddArtistForm: React.FC<AddArtistFormProps> = ({ onClose }) => {
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation<AddArtistResponse | void, Error, string>({
    mutationFn: addArtist,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['artists'] }); // Invalidate artists query to refresh list
      // Check if data is not void and has a NAME property before showing it
      const artistName = (data as AddArtistResponse)?.NAME as string | undefined;
      toast.success(`Artist ${artistName ? `"${artistName}"` : ''} added/found successfully!`);
      setSpotifyUrl(''); // Clear input
      onClose(); // Close the modal
    },
    onError: (error) => {
      toast.error(`Error adding artist: ${error.message}`);
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!spotifyUrl.trim()) {
      toast.error('Please enter a Spotify Artist URL.');
      return;
    }
    // Basic URL validation (can be improved)
    if (!spotifyUrl.includes('open.spotify.com/artist/')) {
        toast.error('Invalid Spotify Artist URL format.');
        return;
    }
    
    mutation.mutate(spotifyUrl);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="spotifyUrl">Spotify Artist URL</Label>
        <Input
          id="spotifyUrl"
          type="url"
          placeholder="https://open.spotify.com/artist/..."
          value={spotifyUrl}
          onChange={(e) => setSpotifyUrl(e.target.value)}
          disabled={mutation.isPending}
          required
        />
      </div>
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</>
          ) : (
            'Add Artist'
          )}
        </Button>
      </div>
    </form>
  );
};

export default AddArtistForm; 