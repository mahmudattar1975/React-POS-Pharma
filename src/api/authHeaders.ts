import { useAuthStore } from '../store/authStore';

// The Express mirror validates the same JWT the dotnet-pos API issued at login. Keeping this in one
// helper makes it easy to verify that every :4300 request carries credentials.
export function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().session?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
