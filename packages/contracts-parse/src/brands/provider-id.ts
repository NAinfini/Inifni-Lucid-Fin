/**
 * `ProviderId` brand parsers — Phase D-2.
 *
 * Agent tool and IPC handler inputs receive raw `unknown` arguments. Every
 * `typeof args.providerId === 'string'` check in the codebase is a pre-brand
 * survival tactic. This module replaces those checks with a typed gateway:
 *
 *   const providerId = tryProviderId(args.providerId);   // ProviderId | undefined
 *
 * Downstream code accepts `ProviderId` only — the compiler rejects raw
 * strings, so there's no accidental bypass.
 */

import { z } from 'zod';
import type { ProviderId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const ProviderIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'providerId must be non-empty after trim' });

export const parseProviderId = makeBrandParser<ProviderId, string>(ProviderIdSchema, 'ProviderId');

export const tryProviderId = makeTryBrand<ProviderId, string>(ProviderIdSchema);
