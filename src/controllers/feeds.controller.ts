import { Request, Response } from 'express';
import { GoogleFeedService } from '../services/google-feed.service';
import { MetaFeedService } from '../services/meta-feed.service';
import logger from '../services/logger';

/**
 * Controlador para endpoints de feeds (Google Merchant Center, Meta Ads, etc.)
 */
export class FeedsController {
  /**
   * GET /feeds/google/vehicles.xml
   * Genera el feed XML para Google Merchant Center - Vehicle Listings
   */
  static async getGoogleVehiclesFeed(req: Request, res: Response) {
    try {
      const xml = await GoogleFeedService.getFeedXML();

      // Headers para XML (setear ANTES de enviar respuesta)
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=600'); // 10 minutos de cache HTTP
      
      // Un único envío de respuesta
      return res.status(200).send(xml);
    } catch (error: any) {
      logger.error(`[FeedsController] Error generando feed de Google: ${error.message}`);
      
      // Solo responder si no se enviaron headers aún
      if (!res.headersSent) {
        res.status(500).setHeader('Content-Type', 'application/xml; charset=utf-8').send(
          '<?xml version="1.0" encoding="UTF-8"?>\n<error>Error generando feed</error>'
        );
      }
    }
  }

  /**
   * POST /feeds/google/invalidate-cache (opcional, para desarrollo/admin)
   * Invalida el cache del feed de Google
   */
  static async invalidateGoogleFeedCache(req: Request, res: Response) {
    try {
      GoogleFeedService.invalidateCache();
      res.json({
        success: true,
        message: 'Cache del feed de Google invalidado correctamente'
      });
    } catch (error: any) {
      logger.error(`[FeedsController] Error invalidando cache: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Error invalidando cache'
      });
    }
  }

  /**
   * GET /feeds/meta/vehicles.csv
   * Genera el feed CSV para Meta Ads (Facebook Catalog) - Automotive Inventory Ads
   */
  static async getMetaVehiclesFeed(req: Request, res: Response) {
    try {
      const csv = await MetaFeedService.getFeedCSV();

      // Headers para CSV (setear ANTES de enviar respuesta)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline; filename="vehicles.csv"');
      res.setHeader('Cache-Control', 'public, max-age=600'); // 10 minutos de cache HTTP
      
      // Agregar BOM UTF-8 para Excel y otros programas que lo requieren
      // Concatenar BOM directamente con el CSV para evitar doble envío
      const csvWithBom = '\ufeff' + csv;
      
      // Un único envío de respuesta
      return res.status(200).send(csvWithBom);
    } catch (error: any) {
      logger.error(`[FeedsController] Error generando feed de Meta: ${error.message}`);
      
      // Solo responder si no se enviaron headers aún
      if (!res.headersSent) {
        res.status(500).setHeader('Content-Type', 'text/csv; charset=utf-8').send(
          'Error generando feed'
        );
      }
    }
  }

  /**
   * POST /feeds/meta/invalidate-cache (opcional, para desarrollo/admin)
   * Invalida el cache del feed de Meta
   */
  static async invalidateMetaFeedCache(req: Request, res: Response) {
    try {
      MetaFeedService.invalidateCache();
      res.json({
        success: true,
        message: 'Cache del feed de Meta invalidado correctamente'
      });
    } catch (error: any) {
      logger.error(`[FeedsController] Error invalidando cache de Meta: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Error invalidando cache'
      });
    }
  }
}
