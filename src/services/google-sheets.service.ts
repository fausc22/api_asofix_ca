/**
 * Servicio para interactuar con Google Sheets
 * Maneja autenticación OAuth2 con refresh automático de tokens
 */
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { getGoogleConfig } from '../config/google.config';
import logger from './logger';

interface TokenData {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
  refresh_token_expires_in?: number;
}

interface CredentialsData {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  client_id?: string;
  client_secret?: string;
  redirect_uris?: string[];
  redirect_uri?: string;
}

interface ReceiptData {
  nro: string;
  fecha: string;
  cliente: string;
  localidad?: string;
  doc?: string;
  direccion?: string;
  concepto?: string;
  totalARS?: number | string;
  totalUSD?: number | string;
  formasPago?: Array<{
    medio: string;
    moneda: string;
    monto: string | number;
    detalles?: string;
  }>;
  medio?: string;
  detalles?: string;
  vendedor?: string;
  vehiculo?: string;
  ts?: string;
}

interface WriteReceiptResult {
  success: boolean;
  updatedRange?: string;
  updatedRows?: number;
}

class GoogleSheetsService {
  private auth: any = null;
  private sheets: any = null;
  private tokenPath: string;
  private credentialsPath: string;
  private config: ReturnType<typeof getGoogleConfig>;

  constructor() {
    this.config = getGoogleConfig();
    this.tokenPath = this.config.TOKEN_PATH;
    this.credentialsPath = this.config.CREDENTIALS_PATH;
    
    logger.info(`📁 Configuración de Google Sheets inicializada:`);
    logger.info(`   - Credenciales: ${this.credentialsPath}`);
    logger.info(`   - Token: ${this.tokenPath}`);
  }

  /**
   * Verificar si el token está expirado o próximo a expirar
   * Consideramos expirado si falta menos de 5 minutos
   */
  private isTokenExpired(token: TokenData): boolean {
    if (!token || !token.expiry_date) {
      return true;
    }
    
    // Agregar margen de 5 minutos (300000 ms) antes de la expiración
    const expiryTime = token.expiry_date - 300000;
    const now = Date.now();
    
    return now >= expiryTime;
  }

  /**
   * Guardar token en archivo
   */
  private async saveToken(token: TokenData): Promise<void> {
    try {
      await fs.writeFile(
        this.tokenPath,
        JSON.stringify(token, null, 2),
        { encoding: 'utf-8' }
      );
      logger.info('✅ Token guardado exitosamente');
    } catch (error: any) {
      logger.error('❌ Error guardando token:', error);
      throw error;
    }
  }

  /**
   * Renovar token automáticamente usando refresh_token
   */
  private async refreshTokenIfNeeded(oAuth2Client: any): Promise<any> {
    try {
      // Obtener credenciales actuales
      const token = oAuth2Client.credentials as TokenData;
      
      // Si no hay refresh_token, no podemos renovar
      if (!token.refresh_token) {
        throw new Error('No hay refresh_token disponible. Necesitas reautenticarte.');
      }

      // Verificar si necesita renovación
      if (!this.isTokenExpired(token)) {
        return oAuth2Client; // Token todavía válido
      }

      logger.info('🔄 Token expirado o próximo a expirar. Renovando automáticamente...');

      // Renovar el token usando refresh_token
      const { credentials: newCredentials } = await oAuth2Client.refreshAccessToken();
      
      // Combinar con el refresh_token original para mantenerlo
      const updatedToken: TokenData = {
        ...newCredentials,
        refresh_token: token.refresh_token // Mantener el refresh_token original
      };

      // Actualizar credenciales del cliente
      oAuth2Client.setCredentials(updatedToken);

      // Guardar token actualizado
      await this.saveToken(updatedToken);

      logger.info('✅ Token renovado y guardado automáticamente');
      
      return oAuth2Client;
    } catch (error: any) {
      logger.error('❌ Error renovando token:', error);
      
      // Si el refresh_token está inválido o expirado
      if (error.message && (
        error.message.includes('invalid_grant') ||
        error.message.includes('Token has been expired or revoked')
      )) {
        throw new Error(
          'El refresh_token ha expirado o fue revocado. ' +
          'Necesitas eliminar token.json y volver a autenticarte manualmente una vez.'
        );
      }
      
      throw error;
    }
  }

  /**
   * Obtener credenciales del archivo
   */
  private async getCredentials(): Promise<CredentialsData> {
    try {
      logger.info(`🔍 Buscando credenciales en: ${this.credentialsPath}`);
      
      // Verificar si el archivo existe antes de leerlo
      const fsSync = require('fs');
      if (!fsSync.existsSync(this.credentialsPath)) {
        logger.error(`❌ Archivo de credenciales no encontrado en: ${this.credentialsPath}`);
        throw new Error(`Archivo de credenciales no encontrado en: ${this.credentialsPath}`);
      }
      
      // Usar fs.promises.readFile correctamente
      const credentialsContent = await fs.readFile(this.credentialsPath, { encoding: 'utf-8' });
      logger.info('✅ Credenciales leídas correctamente');
      return JSON.parse(credentialsContent);
    } catch (error: any) {
      logger.error(`❌ Error leyendo credenciales desde ${this.credentialsPath}:`, error.message);
      throw new Error(`No se pudieron leer las credenciales: ${error.message}`);
    }
  }

  /**
   * Obtener token del archivo
   */
  private async getToken(): Promise<TokenData> {
    try {
      const tokenContent = await fs.readFile(this.tokenPath, { encoding: 'utf-8' });
      return JSON.parse(tokenContent);
    } catch (error: any) {
      logger.error(`❌ Error leyendo token desde ${this.tokenPath}:`, error.message);
      throw new Error('No se pudo leer el token. Necesitas autenticarte primero.');
    }
  }

  /**
   * Autenticación con Google OAuth2 con refresh automático
   */
  async authenticate(): Promise<boolean> {
    try {
      // Leer credenciales
      const credentials = await this.getCredentials();
      
      let client_secret: string;
      let client_id: string;
      let redirect_uris: string[];
      
      if (credentials.installed) {
        ({ client_secret, client_id, redirect_uris } = credentials.installed);
      } else if (credentials.web) {
        ({ client_secret, client_id, redirect_uris } = credentials.web);
      } else {
        client_secret = credentials.client_secret!;
        client_id = credentials.client_id!;
        redirect_uris = credentials.redirect_uris || (credentials.redirect_uri ? [credentials.redirect_uri] : []);
      }

      // Crear cliente OAuth2
      const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );

      // Leer token
      const token = await this.getToken();
      oAuth2Client.setCredentials(token);

      // Configurar listener para guardar tokens renovados automáticamente
      oAuth2Client.on('tokens', async (tokens: any) => {
        try {
          const currentCredentials = oAuth2Client.credentials as TokenData;
          
          // Combinar tokens nuevos con el refresh_token existente
          const updatedToken: TokenData = {
            ...currentCredentials,
            ...tokens,
            // Mantener el refresh_token original si existe
            refresh_token: currentCredentials.refresh_token || tokens.refresh_token || token.refresh_token
          };

          await this.saveToken(updatedToken);
          logger.info('🔄 Token renovado automáticamente por listener y guardado');
        } catch (error: any) {
          logger.error('⚠️ Error guardando token desde listener:', error);
        }
      });

      // Renovar token si es necesario antes de usarlo
      await this.refreshTokenIfNeeded(oAuth2Client);

      this.auth = oAuth2Client;
      this.sheets = google.sheets({ version: 'v4', auth: oAuth2Client });

      return true;
    } catch (error: any) {
      logger.error('❌ Error en autenticación:', error);
      throw new Error(`No se pudo autenticar con Google Sheets: ${error.message}`);
    }
  }

  /**
   * Ejecutar operación con reintento automático si falla por token
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 1
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Asegurar que estamos autenticados y con token válido
        if (!this.sheets || !this.auth) {
          await this.authenticate();
        } else {
          // Verificar y renovar token si es necesario
          await this.refreshTokenIfNeeded(this.auth);
          // Actualizar sheets con el nuevo auth si cambió
          this.sheets = google.sheets({ version: 'v4', auth: this.auth });
        }

        // Ejecutar la operación
        return await operation();
      } catch (error: any) {
        lastError = error;
        const errorMessage = error.message || '';
        
        // Si es error de token y aún tenemos intentos, reintentar
        if (
          (errorMessage.includes('invalid_grant') ||
           errorMessage.includes('Token has been expired') ||
           errorMessage.includes('Request had invalid authentication credentials')) &&
          attempt < maxRetries
        ) {
          logger.info(`🔄 Error de autenticación detectado. Reintentando (intento ${attempt + 1}/${maxRetries + 1})...`);
          
          // Limpiar autenticación actual para forzar renovación
          this.auth = null;
          this.sheets = null;
          
          // Esperar un poco antes de reintentar
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        // Si no es error de token o ya no hay intentos, lanzar error
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * Obtener el último número de recibo
   */
  async getLastReceiptNumber(): Promise<number> {
    return await this.executeWithRetry(async () => {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.SPREADSHEET_ID,
        range: `${this.config.SHEET_NAME}!A:A`,
      });

      const rows = response.data.values;
      
      if (!rows || rows.length <= 1) {
        return 0;
      }

      // Filtrar y encontrar el último número válido
      const numbers = rows
        .slice(1) // Saltar encabezado
        .map((row: any[]) => {
          const val = row[0];
          const num = parseInt(String(val).replace(/\D/g, ''), 10);
          return isNaN(num) ? 0 : num;
        })
        .filter((n: number) => n > 0);

      if (numbers.length === 0) return 0;

      return Math.max(...numbers);
    });
  }

  /**
   * Obtener el próximo número de recibo (formateado)
   */
  async getNextReceiptNumber(): Promise<string> {
    const lastNumber = await this.getLastReceiptNumber();
    const nextNumber = lastNumber + 1;
    return String(nextNumber).padStart(6, '0'); // Formato: 000001
  }

  /**
   * Formatear fecha ISO a DD/MM/YYYY
   */
  formatDate(isoDate: string): string {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  }

  /**
   * Formatear timestamp ISO a formato argentino: "DD/MM/YYYY - HH:MM:SS"
   */
  formatArgentinaDateTime(isoTimestamp: string): string {
    if (!isoTimestamp) return '';
    
    try {
      const date = new Date(isoTimestamp);
      const argentinaOffset = -3 * 60; // -3 horas en minutos
      const localTime = new Date(date.getTime() + argentinaOffset * 60 * 1000);
      
      const day = String(localTime.getUTCDate()).padStart(2, '0');
      const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
      const year = localTime.getUTCFullYear();
      
      const hours = String(localTime.getUTCHours()).padStart(2, '0');
      const minutes = String(localTime.getUTCMinutes()).padStart(2, '0');
      const seconds = String(localTime.getUTCSeconds()).padStart(2, '0');
      
      return `${day}/${month}/${year} - ${hours}:${minutes}:${seconds}`;
    } catch (error: any) {
      logger.error('Error formateando fecha:', error);
      return isoTimestamp;
    }
  }

  /**
   * Formatear formas de pago para guardar en Excel
   */
  formatearFormasPago(formasPago: Array<{medio: string; moneda: string; monto: string | number; detalles?: string}>): {medio: string; detalles: string} {
    if (!formasPago || !Array.isArray(formasPago) || formasPago.length === 0) {
      return { medio: '', detalles: '' };
    }

    const formasValidas = formasPago.filter(fp => parseFloat(String(fp.monto)) > 0);
    
    if (formasValidas.length === 0) {
      return { medio: '', detalles: '' };
    }

    if (formasValidas.length === 1) {
      const fp = formasValidas[0];
      return {
        medio: `${fp.medio} ${fp.moneda}`,
        detalles: fp.detalles || ''
      };
    }

    const medios = formasValidas.map(fp => {
      const montoFormateado = fp.moneda === 'USD' 
        ? `US$${parseFloat(String(fp.monto)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `$${parseFloat(String(fp.monto)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return `${fp.medio} ${fp.moneda} (${montoFormateado})`;
    }).join(' | ');

    const detalles = formasValidas.map(fp => {
      if (fp.detalles) {
        return `${fp.medio}: ${fp.detalles}`;
      }
      return `${fp.medio}: -`;
    }).join(' | ');

    return { medio: medios, detalles: detalles };
  }

  /**
   * Escribir un nuevo recibo en el Sheet
   */
  async writeReceipt(data: ReceiptData): Promise<WriteReceiptResult> {
    return await this.executeWithRetry(async () => {
      let medio = '';
      let detalles = '';
      
      if (data.formasPago && Array.isArray(data.formasPago) && data.formasPago.length > 0) {
        const formasFormateadas = this.formatearFormasPago(data.formasPago);
        medio = formasFormateadas.medio;
        detalles = formasFormateadas.detalles;
      } else {
        medio = data.medio || '';
        detalles = data.detalles || '';
      }

      const totalARS = parseFloat(String(data.totalARS)) || 0;
      const totalUSD = parseFloat(String(data.totalUSD)) || 0;
      
      const row = [
        data.nro,
        this.formatDate(data.fecha),
        data.cliente,
        data.localidad || '',
        data.doc || '',
        data.direccion || '',
        data.concepto || '',
        totalARS,
        totalUSD,
        medio,
        detalles,
        data.vendedor || '',
        data.vehiculo || '',
        this.formatArgentinaDateTime(data.ts || new Date().toISOString())
      ];

      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.config.SPREADSHEET_ID,
        range: `${this.config.SHEET_NAME}!A:N`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [row]
        }
      });

      return {
        success: true,
        updatedRange: response.data.updates.updatedRange,
        updatedRows: response.data.updates.updatedRows
      };
    });
  }

  /**
   * Verificar conexión y permisos
   */
  async testConnection(): Promise<{success: boolean; title?: string; sheets?: string[]; error?: string}> {
    try {
      const response = await this.executeWithRetry(async () => {
        return await this.sheets.spreadsheets.get({
          spreadsheetId: this.config.SPREADSHEET_ID
        });
      });

      return {
        success: true,
        title: response.data.properties.title,
        sheets: response.data.sheets.map((s: any) => s.properties.title)
      };
    } catch (error: any) {
      logger.error('❌ Error en conexión:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Exportar instancia única (Singleton)
export default new GoogleSheetsService();
