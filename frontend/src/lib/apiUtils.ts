const API_BASE_URL = import.meta.env.VITE_API_URL;

/**
 * Constructs the full API URL.
 * @param path The API path (e.g., "/artist-cards")
 * @returns The full URL including the base API URL from environment variables.
 */
export const getApiUrl = (path: string): string => {
  if (!API_BASE_URL) {
    // In development or if env var is not set, fallback to relative path (works with Vite proxy)
    // Ensure path starts with /
    const correctedPath = path.startsWith('/') ? path : `/${path}`;
    console.warn("VITE_API_URL not set, falling back to relative path. This might not work in production.", correctedPath);
    return correctedPath;
  }
  // Ensure path starts with / and base URL does not end with /
  const cleanBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  return `${cleanBase}${cleanPath}`;
}; 