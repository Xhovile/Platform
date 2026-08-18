import express, { type RequestHandler } from 'express';
import {
  disconnectConnectAccount,
  getConnectAccount,
  recordConnectCallback,
  revokeConnectAccessToken,
  startConnectOnboarding,
} from './connect.service.js';
import { getRequestUser } from '../../routes/escrow/shared.js';
import type {
  PayChanguConnectAuthorizeLinkRequest,
  PayChanguConnectCallbackPayload,
  PayChanguConnectMode,
  PayChanguConnectStartRequest,
} from './connect.types.js';

function jsonError(error: unknown, fallback: string): { error: string } {
  return { error: error instanceof Error ? error.message : fallback };
}

export function createConnectRouter(requireAuth?: RequestHandler): express.Router {
  const router = express.Router();
  const auth = requireAuth ?? ((_req, _res, next) => next());

  router.post('/start', auth, async (req, res) => {
    try {
      const sellerUid = getRequestUser(req)?.uid ?? null;
      if (!sellerUid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { clientId, redirectUri, mode, scope, whUrl, whSecret, metadata } = req.body as PayChanguConnectStartRequest & {
        metadata?: Record<string, unknown> | null;
      };

      if (!clientId) {
        return res.status(400).json({ error: 'clientId is required' });
      }
      if (!redirectUri) {
        return res.status(400).json({ error: 'redirectUri is required' });
      }
      if (!mode) {
        return res.status(400).json({ error: 'mode is required' });
      }

      const result = startConnectOnboarding({
        sellerUid,
        clientId,
        redirectUri,
        mode: mode as PayChanguConnectMode,
        scope,
        whUrl,
        whSecret,
        metadata,
      });

      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to start Connect onboarding'));
    }
  });

  router.post('/authorize-link', auth, async (req, res) => {
    try {
      const {
        sellerUid,
        clientId,
        redirectUri,
        mode,
        scope,
        whUrl,
        whSecret,
      } = req.body as PayChanguConnectAuthorizeLinkRequest & { sellerUid?: string };

      if (!sellerUid) {
        return res.status(400).json({ error: 'sellerUid is required' });
      }
      if (!clientId) {
        return res.status(400).json({ error: 'clientId is required' });
      }
      if (!redirectUri) {
        return res.status(400).json({ error: 'redirectUri is required' });
      }
      if (!mode) {
        return res.status(400).json({ error: 'mode is required' });
      }

      const result = startConnectOnboarding({
        sellerUid,
        clientId,
        redirectUri,
        mode: mode as PayChanguConnectMode,
        scope,
        whUrl,
        whSecret,
      });

      return res.status(200).json({
        sellerUid,
        ...result,
      });
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to build Connect authorization link'));
    }
  });

  router.post('/callback', auth, async (req, res) => {
    try {
      const payload = req.body as PayChanguConnectCallbackPayload;
      const account = await recordConnectCallback(payload);
      return res.status(200).json(account);
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to process Connect callback'));
    }
  });

  router.get('/status/:sellerUid', auth, (req, res) => {
    try {
      const account = getConnectAccount(req.params.sellerUid);
      if (!account) {
        return res.status(404).json({ error: 'Connect account not found' });
      }

      return res.status(200).json(account);
    } catch (error) {
      return res.status(500).json(jsonError(error, 'Failed to fetch Connect status'));
    }
  });

  router.post('/revoke/:sellerUid', auth, async (req, res) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
      const account = await revokeConnectAccessToken(req.params.sellerUid, reason);
      return res.status(200).json(account);
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to revoke Connect access token'));
    }
  });

  router.post('/disconnect/:sellerUid', auth, async (req, res) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
      const account = await disconnectConnectAccount(req.params.sellerUid, reason);
      return res.status(200).json(account);
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to disconnect Connect account'));
    }
  });

  return router;
}

export function mountConnectRoutes(app: express.Express, requireAuth?: RequestHandler): void {
  app.use('/api/connect', createConnectRouter(requireAuth));
}
