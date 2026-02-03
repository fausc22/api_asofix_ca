/**
 * Controlador para endpoints de recibos
 */
import { Request, Response } from 'express';
import googleSheetsService from '../services/google-sheets.service';
import pdfService from '../services/pdf.service';
import logger from '../services/logger';

export class RecibosController {
  /**
   * GET /api/recibos/next-number
   * Obtener el próximo número de recibo
   */
  static async getNextNumber(req: Request, res: Response): Promise<void> {
    try {
      const nextNumber = await googleSheetsService.getNextReceiptNumber();
      
      res.json({
        success: true,
        nextNumber: nextNumber
      });
    } catch (error: any) {
      logger.error('Error en getNextNumber:', error);
      res.status(500).json({
        success: false,
        error: 'No se pudo obtener el próximo número de recibo',
        details: error.message
      });
    }
  }

  /**
   * POST /api/recibos
   * Crear un nuevo recibo (escribir en Sheets)
   */
  static async createReceipt(req: Request, res: Response): Promise<void> {
    try {
      // Validar campos obligatorios
      const requiredFields = ['nro', 'fecha', 'cliente'];
      const missingFields = requiredFields.filter(field => !req.body[field]);
      
      // Validar que tenga al menos un monto
      const tieneMontoAntiguo = req.body.monto !== undefined && req.body.monto !== null;
      const tieneMontosNuevos = (req.body.totalARS !== undefined && req.body.totalARS !== null) || 
                                 (req.body.totalUSD !== undefined && req.body.totalUSD !== null);
      
      if (missingFields.length > 0) {
        res.status(400).json({
          success: false,
          error: 'Faltan campos obligatorios',
          missingFields: missingFields
        });
        return;
      }
      
      if (!tieneMontoAntiguo && !tieneMontosNuevos) {
        res.status(400).json({
          success: false,
          error: 'Faltan campos obligatorios',
          missingFields: ['monto o totalARS/totalUSD']
        });
        return;
      }

      // Extraer datos del body
      let formasPago: Array<{medio: string; moneda: string; monto: string | number; detalles?: string}> = [];
      
      if (req.body.formasPago && Array.isArray(req.body.formasPago) && req.body.formasPago.length > 0) {
        formasPago = req.body.formasPago;
      } else {
        // Formato antiguo: convertir a array
        formasPago = [{
          medio: req.body.medio || 'Efectivo',
          moneda: req.body.moneda || 'ARS',
          monto: req.body.monto || '0',
          detalles: req.body.detalles || ''
        }];
      }

      // Calcular totales separados si no vienen del frontend
      let totalARS = req.body.totalARS;
      let totalUSD = req.body.totalUSD;
      
      if (totalARS === undefined || totalUSD === undefined) {
        const totales = formasPago.reduce((acc, fp) => {
          const monto = parseFloat(String(fp.monto)) || 0;
          if (fp.moneda === 'USD') {
            acc.usd += monto;
          } else {
            acc.ars += monto;
          }
          return acc;
        }, { ars: 0, usd: 0 });
        
        totalARS = totalARS !== undefined ? totalARS : totales.ars;
        totalUSD = totalUSD !== undefined ? totalUSD : totales.usd;
      }

      const receiptData = {
        nro: req.body.nro,
        fecha: req.body.fecha,
        cliente: req.body.cliente,
        localidad: req.body.localidad || '',
        doc: req.body.doc || '',
        direccion: req.body.direccion || '',
        concepto: req.body.concepto || '',
        totalARS: totalARS || 0,
        totalUSD: totalUSD || 0,
        formasPago: formasPago,
        vendedor: req.body.vendedor || '',
        vehiculo: req.body.vehiculo || '',
        ts: req.body.ts || new Date().toISOString()
      };

      // Escribir en Google Sheets
      const result = await googleSheetsService.writeReceipt(receiptData);

      res.json({
        success: true,
        message: 'Recibo guardado correctamente',
        data: result
      });
    } catch (error: any) {
      logger.error('Error en createReceipt:', error);
      res.status(500).json({
        success: false,
        error: 'No se pudo guardar el recibo',
        details: error.message
      });
    }
  }

  /**
   * POST /api/recibos/generate-pdf
   * Generar PDF del recibo
   */
  static async generatePDF(req: Request, res: Response): Promise<void> {
    try {
      logger.info('📄 Solicitud de generación de PDF recibida');
      
      // Validar campos obligatorios
      const requiredFields = ['nro', 'fecha', 'cliente'];
      const missingFields = requiredFields.filter(field => !req.body[field]);
      
      const tieneMontoAntiguo = req.body.monto !== undefined && req.body.monto !== null;
      const tieneMontosNuevos = (req.body.totalARS !== undefined && req.body.totalARS !== null) || 
                                 (req.body.totalUSD !== undefined && req.body.totalUSD !== null);
      
      if (missingFields.length > 0) {
        res.status(400).json({
          success: false,
          error: 'Faltan campos obligatorios',
          missingFields: missingFields
        });
        return;
      }
      
      if (!tieneMontoAntiguo && !tieneMontosNuevos) {
        res.status(400).json({
          success: false,
          error: 'Faltan campos obligatorios',
          missingFields: ['monto o totalARS/totalUSD']
        });
        return;
      }

      // Extraer datos del body
      let formasPago: Array<{medio: string; moneda: string; monto: string | number; detalles?: string}> = [];
      
      if (req.body.formasPago && Array.isArray(req.body.formasPago) && req.body.formasPago.length > 0) {
        formasPago = req.body.formasPago;
      } else {
        formasPago = [{
          medio: req.body.medio || 'Efectivo',
          moneda: req.body.moneda || 'ARS',
          monto: req.body.monto || '0',
          detalles: req.body.detalles || ''
        }];
      }

      // Calcular totales separados si no vienen del frontend
      let totalARS = req.body.totalARS;
      let totalUSD = req.body.totalUSD;
      
      if (totalARS === undefined || totalUSD === undefined) {
        const totales = formasPago.reduce((acc, fp) => {
          const monto = parseFloat(String(fp.monto)) || 0;
          if (fp.moneda === 'USD') {
            acc.usd += monto;
          } else {
            acc.ars += monto;
          }
          return acc;
        }, { ars: 0, usd: 0 });
        
        totalARS = totalARS !== undefined ? totalARS : totales.ars;
        totalUSD = totalUSD !== undefined ? totalUSD : totales.usd;
      }

      const receiptData = {
        nro: req.body.nro,
        fecha: req.body.fecha,
        cliente: req.body.cliente,
        localidad: req.body.localidad || '',
        doc: req.body.doc || '',
        direccion: req.body.direccion || '',
        concepto: req.body.concepto || '',
        totalARS: totalARS || 0,
        totalUSD: totalUSD || 0,
        formasPago: formasPago,
        vendedor: req.body.vendedor || '',
        vehiculo: req.body.vehiculo || ''
      };

      logger.info('🎨 Generando PDF para cliente:', receiptData.cliente);

      // Generar PDF
      const pdfBuffer = await pdfService.generarRecibo(receiptData);

      // Configurar headers para descarga
      const receiptNumber = (receiptData.nro || '000001').replace(/[^\d]/g, '').padStart(6, '0');
      const filename = `RECIBO ${receiptNumber} - CAR ADVICE.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      logger.info(`✅ PDF generado y enviado: ${filename} (${pdfBuffer.length} bytes)`);
      res.end(pdfBuffer);

    } catch (error: any) {
      logger.error('❌ Error en generatePDF:', error);
      res.status(500).json({
        success: false,
        error: 'No se pudo generar el PDF',
        details: error.message
      });
    }
  }

  /**
   * GET /api/recibos/test
   * Test de conexión con Google Sheets
   */
  static async testConnection(req: Request, res: Response): Promise<void> {
    try {
      const result = await googleSheetsService.testConnection();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}
