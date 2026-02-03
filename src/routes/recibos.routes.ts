/**
 * Rutas para endpoints de recibos
 */
import { Router } from 'express';
import { RecibosController } from '../controllers/recibos.controller';

const router = Router();

/**
 * GET /api/recibos/next-number
 * Obtener próximo número de recibo
 */
router.get('/next-number', RecibosController.getNextNumber);

/**
 * POST /api/recibos
 * Crear nuevo recibo
 */
router.post('/', RecibosController.createReceipt);

/**
 * POST /api/recibos/generate-pdf
 * Generar PDF del recibo
 */
router.post('/generate-pdf', RecibosController.generatePDF);

/**
 * GET /api/recibos/test
 * Test de conexión (opcional)
 */
router.get('/test', RecibosController.testConnection);

export default router;
