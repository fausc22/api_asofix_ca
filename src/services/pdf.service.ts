/**
 * Servicio para generar PDFs de recibos
 * Replica exactamente el formato del servicio original con fuentes y logos correctos
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
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
}

class PdfService {
  private templatesPath: string;
  private resourcesPath: string;
  private fontsPath: string;
  private templatePath: string;

  constructor() {
    // Obtener directorio base del proyecto
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
    
    this.templatesPath = path.join(projectRoot, 'templates');
    this.resourcesPath = path.join(projectRoot, 'resources');
    this.fontsPath = path.join(projectRoot, 'fonts');
    this.templatePath = path.join(this.templatesPath, 'recibo.html');
  }

  /**
   * Formatear fecha de ISO a DD/MM/YYYY
   */
  private formatearFecha(isoDate: string): string {
    if (!isoDate) return '';
    try {
      const [y, m, d] = isoDate.split('-');
      return `${d}/${m}/${y}`;
    } catch (error: any) {
      logger.error('Error formateando fecha:', error);
      return '';
    }
  }

  /**
   * Formatear moneda
   */
  private formatearMoneda(monto: number | string, moneda: string = 'ARS'): string {
    const num = parseFloat(String(monto)) || 0;
    
    if (moneda === 'USD') {
      return `US$ ${num.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      })}`;
    }
    
    return `$ ${num.toLocaleString('es-AR', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    })}`;
  }

  /**
   * Convertir imagen a base64
   */
  private obtenerImagenBase64(nombreArchivo: string): string {
    try {
      const imagePath = path.join(this.resourcesPath, 'images', nombreArchivo);
      
      if (existsSync(imagePath)) {
        const imageBuffer = require('fs').readFileSync(imagePath);
        const extension = path.extname(nombreArchivo).toLowerCase();
        let mimeType = 'image/png';
        
        if (extension === '.jpg' || extension === '.jpeg') {
          mimeType = 'image/jpeg';
        } else if (extension === '.svg') {
          mimeType = 'image/svg+xml';
        }
        
        const base64Image = imageBuffer.toString('base64');
        logger.info(`✅ Imagen cargada: ${nombreArchivo}`);
        return `data:${mimeType};base64,${base64Image}`;
      } else {
        logger.warn(`⚠️  Imagen no encontrada: ${nombreArchivo}`);
        return '';
      }
    } catch (error: any) {
      logger.error(`❌ Error cargando imagen ${nombreArchivo}:`, error);
      return '';
    }
  }

  /**
   * Convertir fuente a base64
   */
  private obtenerFuenteBase64(nombreArchivo: string): string {
    try {
      const fontPath = path.join(this.fontsPath, nombreArchivo);
      
      if (existsSync(fontPath)) {
        const fontBuffer = require('fs').readFileSync(fontPath);
        const base64Font = fontBuffer.toString('base64');
        logger.info(`✅ Fuente cargada: ${nombreArchivo}`);
        return `data:font/opentype;base64,${base64Font}`;
      } else {
        logger.warn(`⚠️  Fuente no encontrada: ${nombreArchivo}`);
        return '';
      }
    } catch (error: any) {
      logger.error(`❌ Error cargando fuente ${nombreArchivo}:`, error);
      return '';
    }
  }

  /**
   * Obtener opciones de Puppeteer según el entorno
   */
  private getOptions(customOptions: any = {}): any {
    const isProduction = process.env.NODE_ENV === 'production';
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';
    
    const baseOptions = {
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm'
      },
      timeout: 30000
    };

    // ✅ CONFIGURACIÓN ESPECÍFICA PARA MACOS
    if (isMac) {
      const possibleChromePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        process.env.CHROME_PATH
      ].filter(Boolean);

      let executablePath: string | null = null;
      
      for (const chromePath of possibleChromePaths) {
        if (existsSync(chromePath as string)) {
          executablePath = chromePath as string;
          logger.info(`✅ Chrome encontrado en: ${chromePath}`);
          break;
        }
      }

      if (!executablePath) {
        logger.warn('⚠️  No se encontró Chrome en rutas comunes de macOS');
        logger.warn('   Instala Chrome desde: https://www.google.com/chrome/');
      }

      return {
        ...baseOptions,
        executablePath,
        args: [
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ],
        ...customOptions
      };
    }

    // ✅ CONFIGURACIÓN PARA LINUX/VPS
    if (isLinux && isProduction) {
      return {
        ...baseOptions,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-web-security'
        ],
        ...customOptions
      };
    }

    // ✅ CONFIGURACIÓN POR DEFECTO
    return {
      ...baseOptions,
      args: [
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--no-sandbox'
      ],
      ...customOptions
    };
  }

  /**
   * Generar PDF desde HTML
   */
  private async generatePdfFromHtml(htmlContent: string, options: any = {}): Promise<Buffer> {
    let browser: any = null;
    try {
      const environment = process.env.NODE_ENV === 'production' ? 'PRODUCCIÓN' : 'DESARROLLO';
      logger.info(`🔧 Generando PDF con Puppeteer (${environment})...`);
      
      const pdfOptions = this.getOptions(options);
      
      const launchOptions: any = {
        headless: 'new',
        args: pdfOptions.args || [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      };

      // Usar Chrome del sistema si está disponible (macOS)
      if (pdfOptions.executablePath && existsSync(pdfOptions.executablePath)) {
        launchOptions.executablePath = pdfOptions.executablePath;
        logger.info(`✅ Usando Chrome del sistema: ${pdfOptions.executablePath}`);
      }
      
      // Lanzar navegador
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      
      // Configurar contenido HTML
      await page.setContent(htmlContent, {
        waitUntil: 'networkidle0',
        timeout: pdfOptions.timeout || 30000
      });
      
      // Generar PDF
      const pdfBuffer = await page.pdf({
        format: pdfOptions.format || 'A4',
        printBackground: pdfOptions.printBackground !== false,
        margin: pdfOptions.margin || {
          top: '15mm',
          right: '15mm',
          bottom: '15mm',
          left: '15mm'
        }
      });
      
      await browser.close();
      browser = null;
      
      logger.info(`✅ PDF generado exitosamente - Tamaño: ${pdfBuffer.length} bytes`);
      return pdfBuffer;
      
    } catch (error: any) {
      logger.error('❌ Error generando PDF:', error);
      
      // Cerrar navegador si quedó abierto
      if (browser) {
        try {
          await browser.close();
        } catch (e: any) {
          logger.error('Error cerrando navegador:', e);
        }
      }
      
      throw error;
    }
  }

  /**
   * Generar recibo en PDF
   */
  async generarRecibo(datosRecibo: ReceiptData): Promise<Buffer> {
    try {
      logger.info('📋 Generando recibo PDF para:', datosRecibo.cliente);
      
      if (!existsSync(this.templatePath)) {
        throw new Error('Plantilla recibo.html no encontrada');
      }

      let htmlTemplate = await fs.readFile(this.templatePath, { encoding: 'utf-8' });

      // Obtener imágenes en base64
      const logoBase64 = this.obtenerImagenBase64('logo_recibo.png');
      const footerLogoBase64 = this.obtenerImagenBase64('iso_negro.png');

      // Obtener fuentes en base64
      const antennaLightBase64 = this.obtenerFuenteBase64('Antenna-Light.otf');
      const antennaMediumBase64 = this.obtenerFuenteBase64('ford-antenna-medium-58955836e60d2.otf');
      const antennaBoldBase64 = this.obtenerFuenteBase64('ford-antenna-bold-italic-cnd-58894aad940e0.otf');

      // Formatear datos
      const fechaFormateada = this.formatearFecha(datosRecibo.fecha);
      
      // Formatear totales separados
      const totalARS = parseFloat(String(datosRecibo.totalARS)) || 0;
      const totalUSD = parseFloat(String(datosRecibo.totalUSD)) || 0;
      const montoFormateadoARS = this.formatearMoneda(totalARS, 'ARS');
      const montoFormateadoUSD = this.formatearMoneda(totalUSD, 'USD');
      
      // Generar HTML para los totales
      let totalesHtml = '';
      if (totalARS > 0 && totalUSD > 0) {
        // Ambos totales
        totalesHtml = `
                    <div class="amount-box" style="margin-bottom: 6px;">
                        <div class="amount-label">IMPORTE TOTAL ARS</div>
                        <div class="amount-value">${montoFormateadoARS}</div>
                    </div>
                    <div class="amount-box">
                        <div class="amount-label">IMPORTE TOTAL USD</div>
                        <div class="amount-value">${montoFormateadoUSD}</div>
                    </div>
                `;
      } else if (totalARS > 0) {
        // Solo ARS
        totalesHtml = `
                    <div class="amount-box">
                        <div class="amount-label">IMPORTE TOTAL ARS</div>
                        <div class="amount-value">${montoFormateadoARS}</div>
                    </div>
                `;
      } else if (totalUSD > 0) {
        // Solo USD
        totalesHtml = `
                    <div class="amount-box">
                        <div class="amount-label">IMPORTE TOTAL USD</div>
                        <div class="amount-value">${montoFormateadoUSD}</div>
                    </div>
                `;
      }

      // Procesar formas de pago
      let formasPagoHtml = '';
      let mostrarDetallesAntiguos = true; // Por defecto mostrar sección antigua
      
      if (datosRecibo.formasPago && Array.isArray(datosRecibo.formasPago) && datosRecibo.formasPago.length > 0) {
        // Filtrar formas con monto > 0 y ordenar
        const formasValidas = datosRecibo.formasPago
          .filter(fp => parseFloat(String(fp.monto)) > 0)
          .sort((a, b) => {
            // Ordenar por moneda primero (ARS primero), luego por monto descendente
            if (a.moneda !== b.moneda) {
              return a.moneda === 'ARS' ? -1 : 1;
            }
            return parseFloat(String(b.monto)) - parseFloat(String(a.monto));
          });

        if (formasValidas.length > 0) {
          // Si hay múltiples formas de pago, ocultar la sección antigua
          mostrarDetallesAntiguos = formasValidas.length === 1;
          
          formasPagoHtml = '<div class="payment-breakdown">';
          formasPagoHtml += '<div class="detail-label">Desglose de formas de pago:</div>';
          formasPagoHtml += '<div>';
          
          formasValidas.forEach((fp) => {
            const montoFormateadoFP = this.formatearMoneda(fp.monto, fp.moneda);
            const detallesFP = fp.detalles ? ` — ${fp.detalles}` : '';
            
            formasPagoHtml += `
                            <div class="payment-breakdown-item">
                                <span style="color: #000000;">
                                    ${fp.medio} ${fp.moneda === 'USD' ? '(USD)' : '(ARS)'}${detallesFP}
                                </span>
                                <span style="color: #000000; font-weight: 500;">
                                    ${montoFormateadoFP}
                                </span>
                            </div>
                        `;
          });
          
          formasPagoHtml += '</div></div>';
        }
      }

      // Compatibilidad con formato antiguo
      const medioAntiguo = datosRecibo.medio || '-';
      const detallesAntiguos = datosRecibo.detalles || '-';
      const mostrarDetallesAntiguosHtml = mostrarDetallesAntiguos ? '' : 'display: none;';

      // Reemplazar variables en el template
      htmlTemplate = htmlTemplate
        .replace(/{{logo_base64}}/g, logoBase64)
        .replace(/{{footer_logo_base64}}/g, footerLogoBase64)
        .replace(/{{antenna_light_base64}}/g, antennaLightBase64)
        .replace(/{{antenna_medium_base64}}/g, antennaMediumBase64)
        .replace(/{{antenna_bold_base64}}/g, antennaBoldBase64)
        .replace(/{{nro}}/g, datosRecibo.nro || '000001')
        .replace(/{{fecha}}/g, fechaFormateada)
        .replace(/{{cliente}}/g, datosRecibo.cliente || '__________')
        .replace(/{{localidad}}/g, datosRecibo.localidad || '__________')
        .replace(/{{direccion}}/g, datosRecibo.direccion || '__________')
        .replace(/{{doc}}/g, datosRecibo.doc || '__________')
        .replace(/{{concepto}}/g, datosRecibo.concepto || '__________')
        .replace(/{{totales_html}}/g, totalesHtml)
        .replace(/{{medio}}/g, medioAntiguo)
        .replace(/{{detalles}}/g, detallesAntiguos)
        .replace(/{{formas_pago_html}}/g, formasPagoHtml)
        .replace(/{{mostrar_detalles_antiguos}}/g, mostrarDetallesAntiguosHtml)
        .replace(/{{vendedor}}/g, datosRecibo.vendedor || '-')
        .replace(/{{vehiculo}}/g, datosRecibo.vehiculo || '-');

      logger.info('📄 Generando PDF del recibo...');
      const pdfBuffer = await this.generatePdfFromHtml(htmlTemplate);
      
      logger.info('✅ Recibo generado exitosamente');
      return pdfBuffer;

    } catch (error: any) {
      logger.error('❌ Error generando recibo:', error);
      throw new Error(`No se pudo generar el PDF: ${error.message}`);
    }
  }
}

export default new PdfService();
