import { describe, expect, it } from 'vitest';
import { authHeaders } from './authHeaders';
import { useAuthStore } from '../store/authStore';

describe('authHeaders', () => {
  it('sends no Authorization header before login', () => {
    useAuthStore.getState().logout();
    expect(authHeaders()).toEqual({});
  });

  it('sends the current session token as a bearer credential', () => {
    useAuthStore.getState().login({
      token: 'test-token',
      cashierId: 1,
      username: 'cashier',
      fullName: 'Test Cashier',
      isAdmin: false,
    });
    expect(authHeaders()).toEqual({ Authorization: 'Bearer test-token' });
    useAuthStore.getState().logout();
  });
});
