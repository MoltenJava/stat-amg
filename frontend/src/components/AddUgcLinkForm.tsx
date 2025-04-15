import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

// Define type corresponding to backend ArtistUgcLink
interface ArtistUgcLink {
    ID: number;
    ARTIST_CARD_ID: number;
    TIKTOK_SOUND_ID: number;
    TIKTOK_SOUND_NAME: string | null;
    ARTIST_TIKTOK_HANDLE: string | null;
    ISRC: string | null;
    CREATED_AT: string; // Assuming date is string after JSON
}

interface AddUgcLinkFormProps {
  artistId: number;
}

// Assumed API function - Requires backend endpoint implementation
const addUgcLink = async ({ artistId, tiktokSoundUrl }: { artistId: number; tiktokSoundUrl: string }): Promise<ArtistUgcLink> => {
  const response = await fetch(`/api/artist-cards/${artistId}/ugc-links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tiktokSoundUrl }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
};

const AddUgcLinkForm: React.FC<AddUgcLinkFormProps> = ({ artistId }) => {
  const [tiktokSoundUrl, setTiktokSoundUrl] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: addUgcLink,
    onSuccess: () => {
      toast.success(`TikTok sound linked successfully!`);
      setTiktokSoundUrl(''); // Clear the input
      // Invalidate UGC query for this artist to refresh chart/data if needed
      queryClient.invalidateQueries({ queryKey: ['ugcTimeSeries', artistId] });
      // Potentially invalidate UGC details query if that exists too
    },
    onError: (error: Error) => {
      toast.error(`Failed to link TikTok sound: ${error.message}`);
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!tiktokSoundUrl.trim()) {
      toast.warning('Please enter a TikTok Sound URL.');
      return;
    }
    // Basic URL validation (can be improved)
    if (!tiktokSoundUrl.includes('tiktok.com')) { // Very basic check
        toast.error('Invalid TikTok Sound URL format.');
        return;
    }
    
    mutation.mutate({ artistId, tiktokSoundUrl });
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-4">
      <Input
        type="url"
        placeholder="Enter TikTok Sound URL..."
        value={tiktokSoundUrl}
        onChange={(e) => setTiktokSoundUrl(e.target.value)}
        disabled={mutation.isPending}
        className="flex-grow bg-white/50 backdrop-blur-sm border-white/40 rounded-lg px-4 py-2 focus:ring-primary focus:border-primary"
      />
      <Button type="submit" disabled={mutation.isPending} size="sm">
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link TikTok'}
      </Button>
    </form>
  );
};

export default AddUgcLinkForm; 