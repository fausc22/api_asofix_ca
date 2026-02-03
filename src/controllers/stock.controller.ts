/**
 * Controlador para endpoints de stock
 */
import { Request, Response } from 'express';
import bigQueryService from '../services/big-query.service';
import { getGoogleConfig } from '../config/google.config';
import path from 'path';
import logger from '../services/logger';
import { google } from 'googleapis';
import fs from 'fs/promises';

export class StockController {
  /**
   * GET /api/stock/data
   * Obtener datos de stock desde BigQuery (JSON)
   */
  static async getStockData(req: Request, res: Response): Promise<void> {
    try {
      const data = await bigQueryService.getStockData();

      res.json({
        success: true,
        recordCount: data.length,
        data: data
      });
    } catch (error: any) {
      logger.error('Error en getStockData:', error);
      res.status(500).json({
        success: false,
        error: 'No se pudieron obtener los datos de stock',
        details: error.message
      });
    }
  }

  /**
   * GET /api/stock/excel
   * Generar archivo Excel local con los datos de stock
   */
  static async generateStockExcel(req: Request, res: Response): Promise<void> {
    try {
      const outputPath = path.join(__dirname, '../../Stock_Asofix.xlsx');
      const result = await bigQueryService.generateStockExcel(outputPath);

      res.json({
        success: true,
        message: 'Excel generado correctamente',
        filePath: result.filePath,
        recordCount: result.recordCount
      });
    } catch (error: any) {
      logger.error('Error en generateStockExcel:', error);
      res.status(500).json({
        success: false,
        error: 'No se pudo generar el archivo Excel',
        details: error.message
      });
    }
  }

  /**
   * POST /api/stock/upload
   * Generar Excel y subir/actualizar en Google Sheets
   */
  static async generateAndUploadStock(req: Request, res: Response): Promise<void> {
    try {
      const config = getGoogleConfig();
      const specificFileId = req.body.fileId || config.STOCK_FILE_ID;
      const sheetName = req.body.sheetName || config.STOCK_SHEET_NAME;

      logger.info('📊 Iniciando proceso completo...');

      // 1. Obtener datos de BigQuery
      const rows = await bigQueryService.getStockData();
      const mappedRows = rows.map(row => bigQueryService.mapColumnNames(row));

      // 2. Generar Excel local
      const outputPath = path.join(__dirname, '../../Stock_Asofix.xlsx');
      const excelResult = await bigQueryService.generateStockExcel(outputPath);

      // 3. Subir/Actualizar en Google Sheets
      const uploadResult = await bigQueryService.uploadOrUpdateGoogleSheets(
        outputPath,
        sheetName,
        mappedRows,
        specificFileId
      );

      res.json({
        success: true,
        message: 'Proceso completado exitosamente',
        excel: {
          filePath: excelResult.filePath,
          recordCount: excelResult.recordCount
        },
        googleSheets: {
          url: uploadResult.mainUrl,
          results: uploadResult.results
        }
      });

    } catch (error: any) {
      logger.error('Error en generateAndUploadStock:', error);
      res.status(500).json({
        success: false,
        error: 'No se pudo completar el proceso',
        details: error.message
      });
    }
  }

  /**
   * GET /api/stock/test
   * Test de conexión con BigQuery
   */
  static async testBigQueryConnection(req: Request, res: Response): Promise<void> {
    try {
      await bigQueryService.initialize();

      res.json({
        success: true,
        message: 'Conexión exitosa con BigQuery',
        projectId: 'asofix-produccion',
        datasetId: 'Car_Advice_reports'
      });
    } catch (error: any) {
      logger.error('Error en testBigQueryConnection:', error);
      res.status(500).json({
        success: false,
        error: 'No se pudo conectar con BigQuery',
        details: error.message
      });
    }
  }

  /**
   * GET /api/stock/auth-url
   * Obtener URL de autorización para generar token inicial
   */
  static async getAuthUrl(req: Request, res: Response): Promise<void> {
    try {
      const config = getGoogleConfig();
      const credentialsPath = config.CREDENTIALS_PATH;

      // Verificar que existe credentials.json
      try {
        await fs.access(credentialsPath);
      } catch {
        return res.status(404).json({
          success: false,
          error: `No se encontró el archivo de credenciales en: ${credentialsPath}`
        });
      }

      // Leer credenciales
      const credentialsContent = await fs.readFile(credentialsPath, { encoding: 'utf-8' });
      const credentials = JSON.parse(credentialsContent);

      let client_secret: string;
      let client_id: string;
      let redirect_uris: string[];

      if (credentials.installed) {
        ({ client_secret, client_id, redirect_uris } = credentials.installed);
      } else if (credentials.web) {
        ({ client_secret, client_id, redirect_uris } = credentials.web);
      } else {
        client_secret = credentials.client_secret;
        client_id = credentials.client_id;
        redirect_uris = credentials.redirect_uris || (credentials.redirect_uri ? [credentials.redirect_uri] : ['http://localhost']);
      }

      if (!client_id || !client_secret) {
        return res.status(400).json({
          success: false,
          error: 'client_id o client_secret no encontrados en credentials.json'
        });
      }

      const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );

      const SCOPES = [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/spreadsheets'
      ];

      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent' // Forzar consentimiento para obtener refresh_token
      });

      res.json({
        success: true,
        authUrl: authUrl,
        instructions: [
          '1. Abre la URL de autorización en tu navegador',
          '2. Autoriza la aplicación',
          '3. Copia el código de autorización de la URL de respuesta (el parámetro "code")',
          '4. Envía el código a POST /api/stock/auth-token con { "code": "tu_codigo" }'
        ]
      });
    } catch (error: any) {
      logger.error('Error en getAuthUrl:', error);
      res.status(500).json({
        success: false,
        error: 'No se pudo generar la URL de autorización',
        details: error.message
      });
    }
  }

  /**
   * POST /api/stock/auth-token
   * Intercambiar código de autorización por token
   */
  static async exchangeCodeForToken(req: Request, res: Response): Promise<void> {
    try {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'El código de autorización es requerido. Envía { "code": "tu_codigo" }'
        });
      }

      const config = getGoogleConfig();
      const credentialsPath = config.CREDENTIALS_PATH;
      const tokenPath = config.TOKEN_PATH;

      // Leer credenciales
      const credentialsContent = await fs.readFile(credentialsPath, { encoding: 'utf-8' });
      const credentials = JSON.parse(credentialsContent);

      let client_secret: string;
      let client_id: string;
      let redirect_uris: string[];

      if (credentials.installed) {
        ({ client_secret, client_id, redirect_uris } = credentials.installed);
      } else if (credentials.web) {
        ({ client_secret, client_id, redirect_uris } = credentials.web);
      } else {
        client_secret = credentials.client_secret;
        client_id = credentials.client_id;
        redirect_uris = credentials.redirect_uris || (credentials.redirect_uri ? [credentials.redirect_uri] : ['http://localhost']);
      }

      const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );

      // Intercambiar código por token
      const { tokens } = await oAuth2Client.getToken(code.trim());
      oAuth2Client.setCredentials(tokens);

      // Guardar token en archivo
      await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), { encoding: 'utf-8' });

      logger.info('✅ Token guardado exitosamente en:', tokenPath);

      res.json({
        success: true,
        message: 'Token generado y guardado exitosamente',
        tokenPath: tokenPath,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
      });
    } catch (error: any) {
      logger.error('Error en exchangeCodeForToken:', error);
      res.status(500).json({
        success: false,
        error: 'No se pudo intercambiar el código por token',
        details: error.message
      });
    }
  }
}
