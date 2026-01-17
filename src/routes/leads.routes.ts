import { Router } from 'express';
import { LeadsController } from '../controllers/leads.controller';

const router = Router();

/**
 * POST /api/leads
 * Endpoint para recibir datos de formularios y enviar emails
 * 
 * Body esperado:
 * {
 *   source: "vehicle" | "contact" | "vestri",
 *   name: string,
 *   email: string (requerido para vehicle y contact, opcional para vestri),
 *   phone: string,
 *   message: string,
 *   vehicle?: { id: string, title: string, url: string } (solo para source: "vehicle")
 * }
 */
router.post('/', LeadsController.createLead);

export default router;

