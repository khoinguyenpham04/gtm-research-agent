import { createClient } from '@supabase/supabase-js'
import { auth } from '@clerk/nextjs/server'
import { getSupabaseConfig } from '@/lib/supabase'

/**
 * Creates a Supabase client authenticated with the current Clerk user's JWT.
 *
 * The JWT is passed as an Authorization Bearer header so Supabase can evaluate
 * RLS policies via `auth.jwt()->>'sub'` (Clerk user ID).
 *
 * Use this in Server Components and Route Handlers only — never in 'use client' components.
 *
 * Requires a JWT template named 'supabase' configured in the Clerk Dashboard
 * (Configure → JWT Templates) with payload:
 *   { "sub": "{{user.id}}", "role": "authenticated" }
 * and the signing key set to your Supabase JWT Secret.
 *
 * RLS policy example:
 *   USING ((auth.jwt()->>'sub')::text = clerk_user_id)
 */
export async function createAuthenticatedSupabaseClient() {
    const { getToken } = await auth()
    const token = await getToken({ template: 'supabase' })
    const { url, publishableKey } = getSupabaseConfig()

    return createClient(url, publishableKey, {
        global: {
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        },
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionFromUrl: false,
        },
    })
}
