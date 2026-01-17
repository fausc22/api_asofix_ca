import { Router, Request, Response, NextFunction } from 'express';
import { AsofixController } from '../controllers/asofix.controller';

const router = Router();

/**
 * GET /asofix/vehicle/:license_plate
 * Busca un vehículo por license_plate directamente en la API de Asofix
 * No interactúa con la base de datos
 */
router.get('/vehicle/:license_plate', AsofixController.getVehicleByLicensePlate);

/**
 * GET /asofix/vehicle/origin/:origin
 * Busca un vehículo por origin directamente en la API de Asofix
 * No interactúa con la base de datos
 */
router.get('/vehicle/origin/:origin', AsofixController.getVehicleByOrigin);

export default router;

