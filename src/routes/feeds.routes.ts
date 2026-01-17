import { Router } from 'express';
import { FeedsController } from '../controllers/feeds.controller';

const router = Router();

/**
 * GET /feeds/google/vehicles.xml
 * Feed XML para Google Merchant Center - Vehicle Listings
 * Endpoint público, sin autenticación (Google necesita acceso público)
 */
router.get('/google/vehicles.xml', FeedsController.getGoogleVehiclesFeed);

/**
 * POST /feeds/google/invalidate-cache
 * Invalida el cache del feed (útil para desarrollo/admin)
 * Opcional: puedes agregar autenticación aquí si lo deseas
 */
router.post('/google/invalidate-cache', FeedsController.invalidateGoogleFeedCache);

/**
 * GET /feeds/meta/vehicles.csv
 * Feed CSV para Meta Ads (Facebook Catalog) - Automotive Inventory Ads
 * Endpoint público, sin autenticación (Meta necesita acceso público)
 */
router.get('/meta/vehicles.csv', FeedsController.getMetaVehiclesFeed);

/**
 * POST /feeds/meta/invalidate-cache
 * Invalida el cache del feed de Meta (útil para desarrollo/admin)
 * Opcional: puedes agregar autenticación aquí si lo deseas
 */
router.post('/meta/invalidate-cache', FeedsController.invalidateMetaFeedCache);

export default router;
