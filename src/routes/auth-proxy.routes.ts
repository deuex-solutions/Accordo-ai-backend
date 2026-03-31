import { Router, type Request, type Response, type NextFunction } from 'express';
import logger from '../config/logger.js';

/**
 * Forwards /api/auth/* to AUTH_SERVICE_URL with the same path, method, headers, and body.
 * Preserves contracts for migration; local auth module remains in codebase when proxy is off.
 */
export const createAuthProxyRouter = (baseUrl: string): Router => {
  logger.info('auth-proxy: creating proxy router', { baseUrl });
  const router = Router();

  router.all('*', async (req: Request, res: Response, next: NextFunction) => {
    const pathname = req.originalUrl.split('?')[0];
    const search = req.originalUrl.includes('?')
      ? `?${req.originalUrl.split('?').slice(1).join('?')}`
      : '';

    if (!pathname.startsWith('/api/auth')) {
      logger.warn('auth-proxy: unexpected path', { pathname: req.originalUrl });
      res.status(502).json({ message: 'Auth proxy configuration error' });
      return;
    }

    const rest = pathname.slice('/api/auth'.length) || '/';
    const target = `${baseUrl.replace(/\/$/, '')}/api/auth${rest}${search}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (['host', 'connection', 'content-length'].includes(lower)) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }

    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        redirect: 'manual',
      };

      if (!['GET', 'HEAD'].includes(req.method) && req.body && typeof req.body === 'object') {
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
        init.body = JSON.stringify(req.body);
      }

      const r = await fetch(target, init);

      res.status(r.status);
      r.headers.forEach((v, k) => {
        const kl = k.toLowerCase();
        if (['transfer-encoding', 'connection'].includes(kl)) return;
        res.setHeader(k, v);
      });

      const buf = Buffer.from(await r.arrayBuffer());
      res.send(buf);
    } catch (error) {
      logger.error('auth-proxy: upstream error', { target, error: String(error) });
      next(error);
    }
  });

  return router;
};
