import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Artist } from '../pages/Index'; // Import the existing Artist type

// API function to post the new artist URL
const addArtist = async (spotifyUrl: string): Promise<Artist> => {
  const response = await fetch('/api/artist-cards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ spotifyUrl }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
};

const AddArtistForm: React.FC = () => {
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: addArtist,
    onSuccess: (data) => {
      toast.success(`Artist "${data.NAME || 'New Artist'}" added successfully!`);
      setSpotifyUrl(''); // Clear the input
      queryClient.invalidateQueries({ queryKey: ['artists'] }); // Refetch the artists list
    },
    onError: (error: Error) => {
      toast.error(`Failed to add artist: ${error.message}`);
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!spotifyUrl.trim()) {
      toast.warning('Please enter a Spotify Artist URL.');
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
    <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-4 w-full max-w-lg mx-auto">
      <Input
        type="url"
        placeholder="Enter Spotify Artist URL..."
        value={spotifyUrl}
        onChange={(e) => setSpotifyUrl(e.target.value)}
        disabled={mutation.isPending}
        className="flex-grow bg-white/80 backdrop-blur-sm border-white/40 rounded-lg px-4 py-2 focus:ring-primary focus:border-primary"
      />
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Artist'}
      </Button>
    </form>
  );
};

export default AddArtistForm; 