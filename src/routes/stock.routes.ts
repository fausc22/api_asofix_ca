/**
 * Rutas para endpoints de stock
 */
import { Router } from 'express';
import { StockController } from '../controllers/stock.controller';

const router = Router();

/**
 * GET /api/stock/data
 * Obtener datos de stock en formato JSON
 */
router.get('/data', StockController.getStockData);

/**
 * GET /api/stock/excel
 * Generar archivo Excel local
 */
router.get('/excel', StockController.generateStockExcel);

/**
 * POST /api/stock/upload
 * Generar Excel y subir/actualizar en Google Sheets
 */
router.post('/upload', StockController.generateAndUploadStock);

/**
 * GET /api/stock/test
 * Test de conexión con BigQuery
 */
router.get('/test', StockController.testBigQueryConnection);

/**
 * GET /api/stock/auth-url
 * Obtener URL de autorización para generar token
 */
router.get('/auth-url', StockController.getAuthUrl);

/**
 * POST /api/stock/auth-token
 * Intercambiar código de autorización por token
 */
router.post('/auth-token', StockController.exchangeCodeForToken);

export default router;
