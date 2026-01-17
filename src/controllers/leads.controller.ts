import { Request, Response } from 'express';
import logger from '../services/logger';
import { validateAndSanitize, sendLeadEmail } from '../services/email.service';

/**
 * Controlador para endpoints de leads (formularios de contacto)
 */
export class LeadsController {
  /**
   * POST /api/leads
   * Recibe datos de formularios y envía emails
   * Soporta 3 fuentes: vehicle, contact, vestri
   */
  static async createLead(req: Request, res: Response) {
    try {
      // Log de request recibido para debugging
      logger.info('Request recibido en /api/leads', {
        body: req.body,
        headers: {
          'content-type': req.headers['content-type'],
          'origin': req.headers.origin,
        },
      });

      // Validar y sanitizar
      const validation = validateAndSanitize(req.body);
      if (!validation.valid) {
        logger.warn('Validación fallida en /api/leads', {
          errors: validation.errors,
          receivedData: req.body,
        });
        return res.status(400).json({
          error: 'Datos inválidos',
          details: validation.errors,
        });
      }

      const data = validation.data!;

      // Enviar email
      await sendLeadEmail(data);

      return res.status(200).json({
        success: true,
        message: 'Consulta enviada correctamente',
      });
    } catch (error: any) {
      // Log completo del error para debugging
      logger.error('Error al enviar email:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        responseCode: error.responseCode,
        response: error.response,
      });

      // Determinar el tipo de error
      let errorMessage = 'Error al enviar la consulta. Por favor, intenta nuevamente más tarde.';
      let statusCode = 500;

      if (error.message?.includes('Configuración SMTP incompleta') || error.message?.includes('Variables de entorno faltantes')) {
        errorMessage = 'Error de configuración del servidor. Por favor, contacta al administrador.';
        statusCode = 500;
      } else if (error.code === 'EAUTH' || error.responseCode === 535) {
        errorMessage = 'Error de autenticación. Verifica las credenciales SMTP.';
        statusCode = 500;
      } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
        errorMessage = 'Error de conexión con el servidor de email. Por favor, intenta más tarde.';
        statusCode = 503;
      }

      // En desarrollo, mostrar más detalles
      const details = process.env.NODE_ENV === 'development' 
        ? error.message 
        : undefined;

      return res.status(statusCode).json({
        error: 'Error al enviar consulta',
        message: errorMessage,
        details,
      });
    }
  }
}

