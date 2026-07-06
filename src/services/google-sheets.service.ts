/**
 * Servicio para interactuar con Google Sheets (Recibos)
 * Usa Service Account para autenticación (sin token ni renovación manual)
 */
import { google } from 'googleapis';
import { getGoogleConfig } from '../config/google.config';
import logger from './logger';

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
  private serviceAccountPath: string;
  private config: ReturnType<typeof getGoogleConfig>;

  constructor() {
    this.config = getGoogleConfig();
    this.serviceAccountPath = this.config.SERVICE_ACCOUNT_PATH;
    
    logger.info(`📁 Configuración de Google Sheets (Service Account): ${this.serviceAccountPath}`);
  }

  /**
   * Autenticación con Google usando Service Account
   * No requiere token ni renovación manual
   */
  private async ensureAuth(): Promise<void> {
    if (this.sheets && this.auth) {
      return;
    }
    const fsSync = require('fs');
    if (!fsSync.existsSync(this.serviceAccountPath)) {
      throw new Error(
        `No se encontró el archivo de Service Account en: ${this.serviceAccountPath}. ` +
        'Agrega service-account.json en config/ y comparte el Sheet de Recibos con el email del Service Account como Editor.'
      );
    }
    const authClient = new google.auth.GoogleAuth({
      keyFile: this.serviceAccountPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    this.auth = await authClient.getClient();
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  /**
   * Ejecutar operación asegurando autenticación
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    _maxRetries: number = 1
  ): Promise<T> {
    await this.ensureAuth();
    return await operation();
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
