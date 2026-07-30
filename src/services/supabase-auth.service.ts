import { createClient } from '@supabase/supabase-js';

import { AppError } from '../lib/errors.js';
import type { AuthSession } from '../types/auth.js';

export interface SupabaseAuthClient {
  signInWithPassword(input: { phone: string; password: string }): Promise<AuthSession>;
  refreshSession(input: { refreshToken: string }): Promise<AuthSession>;
  signOut(input: { accessToken: string }): Promise<void>;
  createConfirmedUser(input: { phone: string; password: string }): Promise<{ userId: string }>;
  deleteUser(input: { userId: string }): Promise<void>;
  updateUserPassword(input: { userId: string; password: string }): Promise<void>;
}

export function createSupabaseAuthClient(
  supabaseUrl: string,
  publishableKey: string,
  options: { fetch?: typeof fetch; secretKey?: string } = {},
): SupabaseAuthClient {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  });
  const adminClient = options.secretKey
    ? createClient(supabaseUrl, options.secretKey, options.fetch ? { global: { fetch: options.fetch } } : {})
    : undefined;

  function requireAdmin() {
    if (!adminClient) throw new AppError('INTERNAL_ERROR', 503, 'Authentication administration is temporarily unavailable');
    return adminClient;
  }

  return {
    async signInWithPassword({ phone, password }): Promise<AuthSession> {
      const { data, error } = await client.auth.signInWithPassword({ phone, password });
      if (error || !data.session) throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid mobile number or password');
      return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, userId: data.session.user.id };
    },
    async refreshSession({ refreshToken }): Promise<AuthSession> {
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) throw new AppError('UNAUTHORIZED', 401, 'Your session has expired');
      return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, userId: data.session.user.id };
    },
    async signOut({ accessToken }): Promise<void> {
      if (!accessToken) throw new AppError('UNAUTHORIZED', 401, 'Unable to end this session');
      const { error } = await requireAdmin().auth.admin.signOut(accessToken, 'local');
      if (error) throw new AppError('UNAUTHORIZED', 401, 'Unable to end this session');
    },
    async createConfirmedUser({ phone, password }): Promise<{ userId: string }> {
      const { data, error } = await requireAdmin().auth.admin.createUser({ password, phone, phone_confirm: true });
      if (error || !data.user) throw new AppError('SCHOOL_DIRECTORY_ACCESS_DENIED', 403, 'Unable to complete signup');
      return { userId: data.user.id };
    },
    async deleteUser({ userId }): Promise<void> {
      const { error } = await requireAdmin().auth.admin.deleteUser(userId);
      if (error) throw new AppError('INTERNAL_ERROR', 503, 'Unable to complete signup');
    },
    async updateUserPassword({ userId, password }): Promise<void> {
      const { error } = await requireAdmin().auth.admin.updateUserById(userId, { password });
      if (error) throw new AppError('INTERNAL_ERROR', 503, 'Unable to reset password');
    },
  };
}
