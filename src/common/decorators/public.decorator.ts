// ─── Public Decorator ────────────────────────────────────────────────────────
// Marks a route as publicly accessible — JwtAuthGuard will see this
// metadata via Reflector and short-circuit `canActivate` instead of
// rejecting with 401. Used for routes that need to be reachable by
// browser <img>/CachedNetworkImage that can't easily attach a Bearer
// token (e.g. profile photos rendered from a stable URL).

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
