/**
 * Servicio para interactuar con BigQuery y Google Sheets/Drive
 * Maneja consultas de stock y generación de Excel
 */
import { BigQuery } from '@google-cloud/bigquery';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
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

interface StockRow {
  [key: string]: any;
}

interface ColumnMapping {
  header: string;
  key: string;
  width: number;
  hidden?: boolean;
}

class BigQueryService {
  private bigquery: BigQuery | null = null;
  private datasetId = 'Car_Advice_reports';
  private tokenPath: string;
  private credentialsPath: string;
  private bigQueryCredentialsPath: string;
  private config: ReturnType<typeof getGoogleConfig>;

  constructor() {
    this.config = getGoogleConfig();
    this.tokenPath = this.config.TOKEN_PATH;
    this.credentialsPath = this.config.CREDENTIALS_PATH;
    
    // Obtener directorio base usando la misma lógica que google.config
    const fs = require('fs');
    const currentDir = __dirname;
    
    const possibleRoots = [
      path.join(currentDir, '../..'),
      path.join(process.cwd(), 'backend'),
      process.cwd(),
      path.dirname(require.main?.filename || __dirname),
    ];
    
    let projectRoot = path.join(currentDir, '../..');
    for (const root of possibleRoots) {
      const configPath = path.join(root, 'config');
      if (fs.existsSync(configPath)) {
        projectRoot = root;
        break;
      }
    }
    
    this.bigQueryCredentialsPath = path.join(projectRoot, 'config', 'asofix-produccion-caradvice.json');
  }

  /**
   * Verificar si el token está expirado o próximo a expirar
   */
  private isTokenExpired(token: TokenData): boolean {
    if (!token || !token.expiry_date) {
      return true;
    }
    
    const expiryTime = token.expiry_date - 300000; // 5 minutos antes
    const now = Date.now();
    
    return now >= expiryTime;
  }

  /**
   * Guardar token en archivo
   */
  private async saveToken(token: TokenData, tokenPath: string): Promise<void> {
    try {
      await fs.writeFile(tokenPath, JSON.stringify(token, null, 2), { encoding: 'utf-8' });
      logger.info('✅ Token guardado exitosamente');
    } catch (error: any) {
      logger.error('❌ Error guardando token:', error);
      throw error;
    }
  }

  /**
   * Renovar token automáticamente usando refresh_token
   * SIEMPRE renueva el token cada vez que se usa para mantenerlo fresco
   * Esto evita que el refresh_token expire y mantiene el token siempre actualizado
   */
  private async refreshTokenAlways(oAuth2Client: any, tokenPath: string): Promise<any> {
    try {
      const token = oAuth2Client.credentials as TokenData;
      
      if (!token.refresh_token) {
        throw new Error('No hay refresh_token disponible. Necesitas reautenticarte.');
      }

      logger.info('🔄 Renovando token automáticamente (renovación en cada uso)...');

      const { credentials: newCredentials } = await oAuth2Client.refreshAccessToken();
      
      // Guardar el nuevo refresh_token si Google lo devuelve (puede actualizarse)
      const updatedToken: TokenData = {
        ...newCredentials,
        // Si Google devuelve un nuevo refresh_token, usarlo; sino mantener el actual
        refresh_token: newCredentials.refresh_token || token.refresh_token
      };

      oAuth2Client.setCredentials(updatedToken);
      await this.saveToken(updatedToken, tokenPath);

      logger.info('✅ Token renovado y guardado exitosamente');
      
      return oAuth2Client;
    } catch (error: any) {
      logger.error('❌ Error renovando token:', error);
      
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
   * Ejecutar operación con reintento automático si falla por token
   * Nota: El token ya fue renovado en authenticateGoogle(), pero este método
   * actúa como respaldo en caso de errores durante la operación
   */
  private async executeWithRetry<T>(
    operation: (oAuth2Client: any) => Promise<T>,
    oAuth2Client: any,
    tokenPath: string,
    maxRetries: number = 1
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // El token ya fue renovado en authenticateGoogle(), pero por seguridad
        // intentamos renovarlo nuevamente si hay un error de autenticación
        if (attempt > 0) {
          await this.refreshTokenAlways(oAuth2Client, tokenPath);
        }
        return await operation(oAuth2Client);
      } catch (error: any) {
        lastError = error;
        const errorMessage = error.message || '';
        
        if (
          (errorMessage.includes('invalid_grant') ||
           errorMessage.includes('Token has been expired') ||
           errorMessage.includes('Request had invalid authentication credentials')) &&
          attempt < maxRetries
        ) {
          logger.info(`🔄 Error de autenticación detectado. Reintentando (intento ${attempt + 1}/${maxRetries + 1})...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * Inicializar cliente de BigQuery con credenciales
   */
  async initialize(): Promise<boolean> {
    try {
      const credentialsContent = await fs.readFile(this.bigQueryCredentialsPath, { encoding: 'utf-8' });
      const credentials = JSON.parse(credentialsContent);

      this.bigquery = new BigQuery({
        projectId: 'asofix-produccion',
        credentials: credentials
      });

      return true;
    } catch (error: any) {
      logger.error('Error inicializando BigQuery:', error);
      throw new Error('No se pudo inicializar BigQuery');
    }
  }

  /**
   * Obtener datos de stock desde BigQuery
   */
  async getStockData(): Promise<StockRow[]> {
    try {
      if (!this.bigquery) await this.initialize();

      logger.info('📊 Obteniendo datos de stock desde BigQuery...');

      const query = `
        SELECT *
        FROM \`asofix-produccion.Car_Advice_reports.stock_used\`
        ORDER BY Marca, Modelo, A__o DESC
      `;

      const [rows] = await this.bigquery!.query({ query });

      logger.info(`📋 ${rows.length} registros obtenidos de BigQuery`);

      return rows as StockRow[];
    } catch (error: any) {
      logger.error('Error obteniendo datos de BigQuery:', error);
      throw new Error('No se pudieron obtener los datos de stock');
    }
  }

  /**
   * Mapear nombres de columnas de BigQuery a formato Excel
   */
  mapColumnNames(row: StockRow): { [key: string]: string } {
    return {
      'Matrícula': row.Matr__cula || '',
      'Concesionario': row.Concesionario || '',
      'Sucursal': row.Sucursal || '',
      'Concesionario dueño': row.Concesionario_due__o || '',
      'Marca': row.Marca || '',
      'Modelo': row.Modelo || '',
      'Versión': row.Versi__n || '',
      'Segmento': row.Segmento || '',
      'Código': row.C__digo || '',
      'Kilómetros': row.Kil__metros || '',
      'Año': row.A__o || '',
      'Color': row.Color || '',
      'Tipo Combustible': row.Tipo_Combustible || '',
      'Transmisión': row.Transmisi__n || '',
      'Tipo de Venta': row.Tipo_de_Venta || '',
      'Precio de Referencia': row.Precio_de_Referencia || '',
      'Fecha de actualización PR': this.cleanDateTimeString(row.Fecha_de_actualizaci__n_PR),
      'Moneda de carga': row.Moneda_de_carga || '',
      'Tipo de cambio': row.Tipo_de_cambio || '',
      'Precio de Lista': row.Precio_de_Lista || '',
      'Accesorio 1': row.Accesorio_1 || '',
      'Accesorio 2': row.Accesorio_2 || '',
      'Precio de Venta': row.Precio_de_Venta || '',
      'Boni por Concesionario': row.Boni_por_Concesionario || '',
      'Descuento específico': row.Descuento_espec__fico || '',
      'Descuento valor U %': row.Descuento_valor_U__ || '',
      'Precio de Compra': row.Precio_de_Compra || '',
      'Pre Reacond.': row.Pre_Reacond_ || '',
      'Margen en Pesos': row.Margen__ || '',
      'Margen %': row.Margen___29 || '',
      'Margen actualizado %': row.Margen_actualizado__ || '',
      'Multimedia producto': row.Multimedia_producto || '',
      'Ficha Técnica': row.Ficha_T__cnica || '',
      'Fecha de Recepción': this.formatDate(row.Fecha_de_Recepci__n),
      'Antigüedad': row.Antig__edad || '',
      'Ubicación': row.Ubicaci__n || '',
      'Número de llave': row.N__mero_de_llave || '',
      'VIN': row.VIN || '',
      'País de Origen': row.Pa__s_de_Origen || '',
      'Estado': row.Estado || '',
      'Estado Mercado Libre': row.Estado_Mercado_Libre || '',
      'Observación': row.Observaci__n || '',
      'Número de Oferta': row.N__mero_de_Oferta || '',
      'Fecha de Oferta': this.formatDate(row.Fecha_de_Oferta),
      'Número de Factura': row.N__mero_de_Factura || '',
      'Fecha de Factura': this.formatDate(row.Fecha_de_Factura),
      'Importe de Factura': row.Importe_de_Factura || '',
      'Multimedia Stock': row.Multimedia_Stock || '',
      'Ficha Técnica Stock': row.Ficha_T__cnica_48 || '',
      'Información Avanzada del Vh %': row.Informaci__n_Avanzada_del_Vh____ || '',
      'Precio Mercado Libre': row.Precio_Mercado_Libre || '',
      'ID MMV Producto': row.ID_MMV_Producto || ''
    };
  }

  /**
   * Limpiar strings de fecha/hora
   */
  cleanDateTimeString(dateTimeString: any): string {
    if (!dateTimeString) return '';

    const str = String(dateTimeString);

    if (str.includes(' - ')) {
      return str.split(' - ')[0].trim();
    }

    if (str.includes(' ')) {
      return str.split(' ')[0].trim();
    }

    if (str.includes('T')) {
      return str.split('T')[0].trim();
    }

    return str;
  }

  /**
   * Formatear fechas
   */
  formatDate(dateValue: any): string {
    if (!dateValue) return '';

    try {
      if (typeof dateValue === 'object' && dateValue.value) {
        dateValue = dateValue.value;
      }

      if (typeof dateValue === 'string' && dateValue.startsWith('{')) {
        const parsed = JSON.parse(dateValue);
        dateValue = parsed.value;
      }

      if (typeof dateValue === 'string' && dateValue.includes(' - ')) {
        dateValue = dateValue.split(' - ')[0];
      }

      if (typeof dateValue === 'string' && dateValue.includes(' ')) {
        const datePart = dateValue.split(' ')[0];
        if (datePart.includes('-') && datePart.split('-').length === 3) {
          dateValue = datePart;
        }
      }

      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return String(dateValue);

      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();

      return `${day}/${month}/${year}`;

    } catch (error: any) {
      return String(dateValue);
    }
  }

  /**
   * Generar archivo Excel con los datos de stock
   */
  async generateStockExcel(outputPath: string): Promise<{success: boolean; filePath: string; recordCount: number}> {
    try {
      logger.info('📊 Generando Excel de Stock Asofix...');

      const rows = await this.getStockData();

      if (rows.length === 0) {
        throw new Error('No hay datos disponibles');
      }

      const mappedRows = rows.map(row => this.mapColumnNames(row));
      const workbook = new ExcelJS.Workbook();

      workbook.creator = 'Car Advice';
      workbook.lastModifiedBy = 'Sistema';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Stock Asofix');
      const columnMapping = this.getColumnMapping();

      worksheet.columns = columnMapping.map(col => ({
        header: col.header,
        key: col.key,
        width: col.width,
        hidden: col.hidden || false
      }));

      this.formatHeaders(worksheet, columnMapping.length);
      this.addDataToWorksheet(worksheet, mappedRows, columnMapping);

      worksheet.autoFilter = {
        from: 'A1',
        to: worksheet.lastColumn!.letter + '1'
      };

      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      await workbook.xlsx.writeFile(outputPath);

      logger.info(`✅ Excel generado: ${outputPath}`);
      logger.info(`📊 Registros exportados: ${rows.length}`);

      return {
        success: true,
        filePath: outputPath,
        recordCount: rows.length
      };

    } catch (error: any) {
      logger.error('❌ Error generando Excel:', error);
      throw error;
    }
  }

  /**
   * Autenticar con Google
   * Configura el listener ANTES de establecer credenciales para capturar todas las renovaciones
   * SIEMPRE renueva el token al autenticar para mantenerlo fresco
   */
  async authenticateGoogle(): Promise<any> {
    const tokenPath = this.tokenPath;
    
    const credentialsContent = await fs.readFile(this.credentialsPath, { encoding: 'utf-8' });
    const credentials = JSON.parse(credentialsContent) as CredentialsData;

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

    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    try {
      const tokenContent = await fs.readFile(tokenPath, { encoding: 'utf-8' });
      const token = JSON.parse(tokenContent) as TokenData;

      // Configurar listener ANTES de establecer credenciales para capturar todas las renovaciones
      oAuth2Client.on('tokens', async (tokens: any) => {
        try {
          const currentCredentials = oAuth2Client.credentials as TokenData;
          
          const updatedToken: TokenData = {
            ...currentCredentials,
            ...tokens,
            // Preservar refresh_token: usar el nuevo si viene, sino mantener el actual
            refresh_token: tokens.refresh_token || currentCredentials.refresh_token || token.refresh_token
          };

          await this.saveToken(updatedToken, tokenPath);
          logger.info('🔄 Token renovado automáticamente por listener y guardado');
        } catch (error: any) {
          logger.error('⚠️ Error guardando token desde listener:', error);
        }
      });

      // Establecer credenciales iniciales
      oAuth2Client.setCredentials(token);

      // SIEMPRE renovar el token al autenticar (renovación diaria)
      // Esto mantiene el token fresco y evita que el refresh_token expire
      await this.refreshTokenAlways(oAuth2Client, tokenPath);

      return oAuth2Client;
    } catch (error: any) {
      throw new Error(`No se pudo autenticar con Google - ${error.message}`);
    }
  }

  /**
   * Subir o actualizar archivo en Google Sheets
   */
  async uploadOrUpdateGoogleSheets(
    excelFilePath: string,
    sheetName: string,
    data: { [key: string]: string }[],
    specificFileId: string
  ): Promise<{results: any[]; mainUrl?: string}> {
    try {
      logger.info('📤 Actualizando archivo en Google Drive...');

      const tokenPath = this.tokenPath;
      let auth = await this.authenticateGoogle();
      
      // El token ya fue renovado en authenticateGoogle(), pero por seguridad
      // ejecutamos con retry por si hay algún problema durante la operación
      return await this.executeWithRetry(async (oAuth2Client) => {
        auth = oAuth2Client;
        const drive = google.drive({ version: 'v3', auth });
        const sheets = google.sheets({ version: 'v4', auth });

        const results: any[] = [];

        try {
          logger.info(`🔍 Verificando acceso al archivo...`);
          const fileInfo = await drive.files.get({
            fileId: specificFileId,
            fields: 'id, name, permissions'
          });

          logger.info(`✅ Acceso confirmado: "${fileInfo.data.name}"`);

          logger.info(`🔄 Actualizando contenido...`);
          const updatedUrl = await this.updateSpecificSheet(sheets, specificFileId, data, sheetName);

          results.push({
            destination: 'archivo específico',
            fileId: specificFileId,
            url: updatedUrl,
            action: 'actualizado'
          });

          logger.info('\n✅ Proceso completado!');
          results.forEach(result => {
            logger.info(`📊 ${result.destination}: ${result.action} - ${result.url}`);
          });

          return {
            results: results,
            mainUrl: results[0]?.url
          };

        } catch (accessError: any) {
          const errorMessage = accessError.message || '';
          const isInvalidGrant = errorMessage.includes('invalid_grant') || 
                                errorMessage.includes('Token has been expired or revoked');
          
          if (isInvalidGrant) {
            throw accessError;
          } else {
            logger.info(`❌ No se puede acceder al archivo específico: ${errorMessage}`);
            logger.info(`📝 Creando archivo en tu Drive como respaldo...`);

            const newFile = await this.createNewSheet(drive, sheetName, excelFilePath, null);
            results.push({
              destination: 'tu Drive (respaldo)',
              fileId: newFile.fileId,
              url: newFile.url,
              action: 'creado como respaldo'
            });

            logger.info('\n✅ Proceso completado!');
            results.forEach(result => {
              logger.info(`📊 ${result.destination}: ${result.action} - ${result.url}`);
            });

            return {
              results: results,
              mainUrl: results[0]?.url
            };
          }
        }
      }, auth, tokenPath);

    } catch (error: any) {
      logger.error('❌ Error actualizando Google Sheets:', error);
      throw error;
    }
  }

  /**
   * Actualizar archivo específico en Google Sheets
   */
  private async updateSpecificSheet(
    sheets: any,
    fileId: string,
    data: { [key: string]: string }[],
    sheetName: string
  ): Promise<string> {
    try {
      logger.info('🔄 Actualizando contenido...');

      let sheetExists = false;
      try {
        const spreadsheet = await sheets.spreadsheets.get({
          spreadsheetId: fileId
        });

        sheetExists = spreadsheet.data.sheets.some(
          (sheet: any) => sheet.properties.title === sheetName
        );

        logger.info(`   📋 Hoja "${sheetName}" ${sheetExists ? 'encontrada' : 'no encontrada'}`);

      } catch (error: any) {
        logger.info(`   ⚠️  Error verificando hojas: ${error.message}`);
      }

      if (!sheetExists) {
        logger.info(`   ➕ Creando hoja "${sheetName}"...`);
        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: fileId,
            resource: {
              requests: [{
                addSheet: {
                  properties: {
                    title: sheetName
                  }
                }
              }]
            }
          });
          logger.info(`   ✅ Hoja "${sheetName}" creada`);
        } catch (createError: any) {
          logger.info(`   ⚠️  Error creando hoja: ${createError.message}`);
        }
      }

      const clearRange = `${sheetName}!A:ZZ`;
      try {
        await sheets.spreadsheets.values.clear({
          spreadsheetId: fileId,
          range: clearRange
        });
        logger.info(`   🧹 Contenido anterior limpiado`);
      } catch (clearError: any) {
        logger.info(`   ⚠️  Error limpiando: ${clearError.message}`);
      }

      const columnMapping = this.getColumnMapping();
      const headers = columnMapping.map(col => col.header);

      const dataRows = data.map(row => {
        return columnMapping.map(col => row[col.key] || '');
      });

      const allValues = [headers, ...dataRows];

      const updateRange = `${sheetName}!A1`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: fileId,
        range: updateRange,
        valueInputOption: 'RAW',
        resource: {
          values: allValues
        }
      });

      logger.info(`   ✅ Contenido actualizado - ${data.length} filas`);

      try {
        await this.formatHeadersInSheet(sheets, fileId, sheetName, columnMapping.length);
      } catch (formatError: any) {
        logger.info(`   ⚠️  Error aplicando formato: ${formatError.message}`);
      }

      return `https://docs.google.com/spreadsheets/d/${fileId}`;

    } catch (error: any) {
      logger.error(`   ❌ Error actualizando: ${error.message}`);
      throw error;
    }
  }

  /**
   * Aplicar formato a headers en Google Sheets
   */
  private async formatHeadersInSheet(sheets: any, fileId: string, sheetName: string, columnCount: number): Promise<void> {
    try {
      logger.info('   🎨 Aplicando formato...');

      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: fileId
      });

      const sheet = spreadsheet.data.sheets.find(
        (s: any) => s.properties.title === sheetName
      );

      if (!sheet) {
        logger.info('   ⚠️  No se encontró la hoja');
        return;
      }

      const sheetId = sheet.properties.sheetId;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: fileId,
        resource: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: columnCount
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: {
                      bold: true
                    },
                    backgroundColor: {
                      red: 0.85,
                      green: 0.85,
                      blue: 0.85
                    },
                    horizontalAlignment: 'CENTER'
                  }
                },
                fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)'
              }
            },
            {
              updateSheetProperties: {
                properties: {
                  sheetId: sheetId,
                  gridProperties: {
                    frozenRowCount: 1
                  }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            }
          ]
        }
      });

      logger.info('   ✅ Formato aplicado');

    } catch (error: any) {
      logger.info('   ⚠️  Error en formato:', error.message);
    }
  }

  /**
   * Crear nuevo archivo en Drive
   */
  private async createNewSheet(drive: any, sheetName: string, excelFilePath: string, parentFolderId: string | null): Promise<{fileId: string; url: string}> {
    try {
      const metadata: any = {
        name: sheetName,
        mimeType: 'application/vnd.google-apps.spreadsheet'
      };

      if (parentFolderId) {
        metadata.parents = [parentFolderId];
      }

      const media = {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: require('fs').createReadStream(excelFilePath)
      };

      const uploadResponse = await drive.files.create({
        resource: metadata,
        media: media
      });

      const sheetsUrl = `https://docs.google.com/spreadsheets/d/${uploadResponse.data.id}`;

      logger.info(`   ✅ Archivo creado`);

      return {
        fileId: uploadResponse.data.id,
        url: sheetsUrl
      };

    } catch (error: any) {
      logger.error('   ❌ Error creando archivo:', error.message);
      throw error;
    }
  }

  /**
   * Mapeo de columnas
   */
  private getColumnMapping(): ColumnMapping[] {
    return [
      { header: 'Matrícula', key: 'Matrícula', width: 9.25 },
      { header: 'Concesionario', key: 'Concesionario', width: 11.88 },
      { header: 'Sucursal', key: 'Sucursal', width: 28.88 },
      { header: 'Concesionario dueño', key: 'Concesionario dueño', width: 5.75 },
      { header: 'Marca', key: 'Marca', width: 6.75 },
      { header: 'Modelo', key: 'Modelo', width: 7.13 },
      { header: 'Versión', key: 'Versión', width: 8 },
      { header: 'Segmento', key: 'Segmento', width: 12 },
      { header: 'Código', key: 'Código', width: 7.75 },
      { header: 'Kilómetros', key: 'Kilómetros', width: 7.38 },
      { header: 'Año', key: 'Año', width: 7.38 },
      { header: 'Color', key: 'Color', width: 12 },
      { header: 'Tipo Combustible', key: 'Tipo Combustible', width: 8 },
      { header: 'Transmisión', key: 'Transmisión', width: 11 },
      { header: 'Tipo de Venta', key: 'Tipo de Venta', width: 12.63 },
      { header: 'Precio de Referencia', key: 'Precio de Referencia', width: 12.63 },
      { header: 'Fecha de actualización PR', key: 'Fecha de actualización PR', width: 12.63 },
      { header: 'Moneda de carga', key: 'Moneda de carga', width: 12.63 },
      { header: 'Tipo de cambio', key: 'Tipo de cambio', width: 12.63 },
      { header: 'Precio de Lista', key: 'Precio de Lista', width: 12.63 },
      { header: 'Accesorio 1', key: 'Accesorio 1', width: 12.63 },
      { header: 'Accesorio 2', key: 'Accesorio 2', width: 12.63 },
      { header: 'Precio de Venta', key: 'Precio de Venta', width: 12.63 },
      { header: 'Boni. por Concesionario', key: 'Boni por Concesionario', width: 12.63 },
      { header: 'Descuento específico', key: 'Descuento específico', width: 12.63 },
      { header: 'Descuento valor U %', key: 'Descuento valor U %', width: 12.63 },
      { header: 'Precio de Compra', key: 'Precio de Compra', width: 12.63 },
      { header: 'Pre. Reacond.', key: 'Pre Reacond.', width: 12.63 },
      { header: 'Margen $', key: 'Margen en Pesos', width: 12.63 },
      { header: 'Margen %', key: 'Margen %', width: 12.63 },
      { header: 'Margen actualizado %', key: 'Margen actualizado %', width: 12.63 },
      { header: 'Multimedia producto', key: 'Multimedia producto', width: 12.63 },
      { header: 'Ficha Técnica', key: 'Ficha Técnica', width: 12.63 },
      { header: 'Fecha de Recepción', key: 'Fecha de Recepción', width: 12.63 },
      { header: 'Antigüedad', key: 'Antigüedad', width: 12.63 },
      { header: 'Ubicación', key: 'Ubicación', width: 12.63 },
      { header: 'Número de llave', key: 'Número de llave', width: 12.63 },
      { header: 'VIN', key: 'VIN', width: 12.63 },
      { header: 'País de Origen', key: 'País de Origen', width: 12.63 },
      { header: 'Estado', key: 'Estado', width: 12.63 },
      { header: 'Estado Mercado Libre', key: 'Estado Mercado Libre', width: 12.63 },
      { header: 'Observación', key: 'Observación', width: 12.63 },
      { header: 'Número de Oferta', key: 'Número de Oferta', width: 12.63 },
      { header: 'Fecha de Oferta', key: 'Fecha de Oferta', width: 12.63 },
      { header: 'Número de Factura', key: 'Número de Factura', width: 12.63 },
      { header: 'Fecha de Factura', key: 'Fecha de Factura', width: 12.63 },
      { header: 'Importe de Factura', key: 'Importe de Factura', width: 12.63 },
      { header: 'Multimedia Stock', key: 'Multimedia Stock', width: 12.63 },
      { header: 'Ficha Técnica Stock', key: 'Ficha Técnica Stock', width: 12.63 },
      { header: 'Información Avanzada del Vh. %', key: 'Información Avanzada del Vh %', width: 12.63 },
      { header: 'Precio Mercado Libre', key: 'Precio Mercado Libre', width: 12.63 },
      { header: 'ID MMV Producto', key: 'ID MMV Producto', width: 12.63 }
    ];
  }

  /**
   * Formatear headers del Excel
   */
  private formatHeaders(worksheet: ExcelJS.Worksheet, columnCount: number): void {
    const headerRow = worksheet.getRow(1);

    headerRow.eachCell((cell, colNumber) => {
      cell.font = {
        name: 'Calibri',
        size: 11,
        bold: true,
        color: { argb: '000000' }
      };

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'D9D9D9' }
      };

      cell.border = {
        top: { style: 'thin', color: { argb: '000000' } },
        left: { style: 'thin', color: { argb: '000000' } },
        bottom: { style: 'thin', color: { argb: '000000' } },
        right: { style: 'thin', color: { argb: '000000' } }
      };

      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center'
      };
    });

    headerRow.height = 15;
  }

  /**
   * Agregar datos al worksheet
   */
  private addDataToWorksheet(worksheet: ExcelJS.Worksheet, rows: { [key: string]: string }[], columnMapping: ColumnMapping[]): void {
    logger.info('📋 Agregando datos...');

    rows.forEach((row, index) => {
      const excelRow = worksheet.addRow(row);

      excelRow.eachCell((cell, colNumber) => {
        const column = columnMapping[colNumber - 1];
        if (!column) return;

        cell.font = { name: 'Calibri', size: 11 };

        cell.border = {
          top: { style: 'hair', color: { argb: 'C0C0C0' } },
          left: { style: 'hair', color: { argb: 'C0C0C0' } },
          bottom: { style: 'hair', color: { argb: 'C0C0C0' } },
          right: { style: 'hair', color: { argb: 'C0C0C0' } }
        };
      });

      if (index % 2 === 1) {
        excelRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FAFAFA' }
          };
        });
      }
    });
  }
}

export default new BigQueryService();
