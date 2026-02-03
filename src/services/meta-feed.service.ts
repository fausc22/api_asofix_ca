import pool from '../config/database';
import logger from './logger';
import { filterConfig } from '../config/filters';
import {
  normalizeBodyStyle,
  normalizeStateOfVehicle,
  normalizeFuelType,
  normalizeTransmission,
  normalizeAvailability,
  normalizeMileage,
} from './meta-feed-normalizers';

/**
 * Servicio para generar feeds CSV compatibles con Meta Ads (Facebook Catalog) - Automotive Inventory Ads
 * 
 * Estructura basada en el CSV validado manualmente por Meta (catalogo_aprobado.csv)
 * Referencia: Guía técnica Meta Ads para feeds de vehículos (CSV)
 */
export class MetaFeedService {
  // URL del frontend (para links de páginas de vehículos)
  private static FRONTEND_URL = process.env.FRONTEND_URL || process.env.BASE_URL || 'https://caradvice.com.ar';
  // URL de la API (para imágenes y recursos)
  private static API_URL = process.env.API_BASE_URL || 'https://api-caradvice.duckdns.org';
  private static CACHE_TTL = 10 * 60 * 1000; // 10 minutos
  private static cache: { csv: string; timestamp: number } | null = null;

  /**
   * Dirección por defecto de Car Advice (usada en el CSV aprobado)
   * Esta configuración debe coincidir exactamente con el CSV validado por Meta
   */
  private static DEFAULT_ADDRESS = {
    addr1: process.env.META_FEED_ADDRESS_ADDR1 || 'Octavio Pinto 3024',
    city: process.env.META_FEED_ADDRESS_CITY || 'Cordoba',
    region: process.env.META_FEED_ADDRESS_REGION || 'Cordoba',
    postal_code: process.env.META_FEED_ADDRESS_POSTAL_CODE || '5000',
    country: process.env.META_FEED_ADDRESS_COUNTRY || 'AR',
    latitude: process.env.META_FEED_ADDRESS_LAT || '-31.4167',
    longitude: process.env.META_FEED_ADDRESS_LNG || '-64.1833',
  };

  /**
   * Construye la URL completa de una imagen
   * Usa API_URL para todas las imágenes (endpoints de API y recursos estáticos)
   */
  private static buildImageUrl(image: { file_path?: string | null; image_url?: string | null }): string | null {
    // Si hay file_path y es una ruta estática
    if (image.file_path) {
      if (image.file_path.startsWith('/IMG/static/')) {
        return `${this.API_URL}${image.file_path}`;
      }
      // Si es una ruta local, usar el endpoint de API
      return `${this.API_URL}/api/image?path=${encodeURIComponent(image.file_path)}`;
    }
    
    // Si hay image_url externa, usarla directamente
    if (image.image_url) {
      // Si ya es una URL completa, devolverla tal cual
      if (image.image_url.startsWith('http://') || image.image_url.startsWith('https://')) {
        return image.image_url;
      }
      // Si es relativa, construir URL completa usando API_URL
      if (image.image_url.startsWith('/IMG/static/')) {
        return `${this.API_URL}${image.image_url}`;
      }
      // Para otras rutas relativas, usar el endpoint de API
      return `${this.API_URL}/api/image?path=${encodeURIComponent(image.image_url)}`;
    }
    
    return null;
  }

  /**
   * Escapa un campo para CSV
   * - Si contiene comas, comillas dobles o saltos de línea, se envuelve en comillas dobles
   * - Las comillas dobles dentro del campo se duplican
   */
  private static escapeCsvField(field: string | null | undefined): string {
    if (field === null || field === undefined) return '';
    
    const str = String(field);
    
    // Si contiene comas, comillas dobles o saltos de línea, envolver en comillas
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      // Escapar comillas dobles duplicándolas
      return `"${str.replace(/"/g, '""')}"`;
    }
    
    return str;
  }

  /**
   * Sanitiza HTML de la descripción (remueve tags pero mantiene texto)
   * Meta recomienda hasta 500 caracteres
   */
  private static sanitizeDescription(html: string | null | undefined): string {
    if (!html) return '';
    // Remover tags HTML y limitar longitud
    const text = html.replace(/<[^>]*>/g, '').trim();
    // Limitar a 500 caracteres (recomendación de Meta)
    return text.substring(0, 500);
  }

  /**
   * Obtiene todos los vehículos publicados con sus imágenes y taxonomías
   * Reutiliza la misma lógica de filtrado que Google Feed para mantener consistencia
   */
  private static async getPublishedVehicles(): Promise<any[]> {
    // Construir condiciones WHERE con los mismos filtros que los endpoints públicos
    const whereConditions: string[] = [];
    const whereParams: any[] = [];

    // 1. Solo vehículos publicados
    whereConditions.push(`v.status = 'published'`);
    
    // 2. License plate NO NULL y NO vacío
    whereConditions.push(`v.license_plate IS NOT NULL`);
    whereConditions.push(`v.license_plate != ?`);
    whereParams.push('');
    
    // 3. Precio mayor al mínimo
    whereConditions.push(`(
      (v.price_usd IS NOT NULL AND v.price_usd > ?) OR
      (v.price_ars IS NOT NULL AND v.price_ars > ?)
    )`);
    whereParams.push(filterConfig.minPrice, filterConfig.minPrice);
    
    // 4. Excluir concesionarias bloqueadas (Dakota por defecto)
    // Se verifica en el JSON additional_data.stock_info[].branch_office_name o location_name
    if (filterConfig.blockedBranchOffices.length > 0) {
      const blockedConditions = filterConfig.blockedBranchOffices.map(() => {
        return `(v.additional_data IS NULL OR v.additional_data NOT LIKE ?)`;
      });
      whereConditions.push(`(${blockedConditions.join(' AND ')})`);
      for (const blocked of filterConfig.blockedBranchOffices) {
        whereParams.push(`%${blocked.toLowerCase()}%`);
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Query optimizada: obtener vehículos, imágenes y taxonomías en una sola consulta
    const query = `
      SELECT 
        v.id,
        v.asofix_id,
        v.title,
        v.content,
        v.year,
        v.kilometres,
        v.license_plate,
        v.price_usd,
        v.price_ars,
        v.additional_data,
        -- Imagen destacada
        vi_featured.id as featured_image_id,
        vi_featured.file_path as featured_file_path,
        vi_featured.image_url as featured_image_url,
        vi_featured.sort_order as featured_sort_order
      FROM vehicles v
      LEFT JOIN vehicle_images vi_featured ON v.featured_image_id = vi_featured.id
      WHERE ${whereClause}
      ORDER BY v.id ASC
    `;

    const [vehicles] = await pool.execute<any[]>(query, whereParams);

    // Obtener todas las imágenes para todos los vehículos en batch
    const vehicleIds = vehicles.map(v => v.id);
    if (vehicleIds.length === 0) {
      return [];
    }

    const placeholders = vehicleIds.map(() => '?').join(',');
    const [allImages] = await pool.execute<any[]>(
      `SELECT 
        vehicle_id,
        id,
        file_path,
        image_url,
        is_featured,
        sort_order
      FROM vehicle_images
      WHERE vehicle_id IN (${placeholders})
      ORDER BY vehicle_id, is_featured DESC, sort_order ASC, id ASC`,
      vehicleIds
    );

    // Obtener todas las taxonomías para todos los vehículos en batch
    const [allTaxonomies] = await pool.execute<any[]>(
      `SELECT 
        vt.vehicle_id,
        tt.taxonomy,
        tt.name
      FROM vehicle_taxonomies vt
      JOIN taxonomy_terms tt ON vt.term_id = tt.id
      WHERE vt.vehicle_id IN (${placeholders})
      ORDER BY vt.vehicle_id, tt.taxonomy, tt.name`,
      vehicleIds
    );

    // Organizar imágenes y taxonomías por vehículo
    const imagesByVehicle: Record<number, any[]> = {};
    for (const img of allImages) {
      if (!imagesByVehicle[img.vehicle_id]) {
        imagesByVehicle[img.vehicle_id] = [];
      }
      imagesByVehicle[img.vehicle_id].push(img);
    }

    const taxonomiesByVehicle: Record<number, Record<string, string[]>> = {};
    for (const tax of allTaxonomies) {
      if (!taxonomiesByVehicle[tax.vehicle_id]) {
        taxonomiesByVehicle[tax.vehicle_id] = {};
      }
      if (!taxonomiesByVehicle[tax.vehicle_id][tax.taxonomy]) {
        taxonomiesByVehicle[tax.vehicle_id][tax.taxonomy] = [];
      }
      taxonomiesByVehicle[tax.vehicle_id][tax.taxonomy].push(tax.name);
    }

    // Combinar datos
    return vehicles.map(vehicle => ({
      ...vehicle,
      images: imagesByVehicle[vehicle.id] || [],
      taxonomies: taxonomiesByVehicle[vehicle.id] || {}
    }));
  }

  /**
   * Valida que los nombres de columnas sean exactamente iguales al CSV aprobado
   * Esta validación asegura que Meta acepte el feed
   */
  private static validateColumnNames(columns: string[]): boolean {
    // Columnas EXACTAS del CSV aprobado (catalogo_aprobado.csv)
    // IMPORTANTE: Orden y nombres deben ser idénticos, sin espacios ni caracteres invisibles
    const expectedColumns = [
      'vehicle_id',
      'title',
      'description',
      'availability',
      'state_of_vehicle',
      'condition',
      'price',
      'url',
      'image[0].url',
      'image[1].url',
      'make',
      'model',
      'year',
      'mileage.value',
      'mileage.unit',
      'fuel_type',
      'transmission',
      'body_style',
      'address.addr1',
      'address.city',
      'address.region',
      'address.postal_code',
      'address.country',
      'latitude',
      'longitude',
    ];

    if (columns.length !== expectedColumns.length) {
      logger.error(`[MetaFeed] ERROR: Número de columnas incorrecto. Esperado: ${expectedColumns.length}, Obtenido: ${columns.length}`);
      return false;
    }

    for (let i = 0; i < columns.length; i++) {
      if (columns[i] !== expectedColumns[i]) {
        logger.error(`[MetaFeed] ERROR: Columna ${i + 1} incorrecta. Esperado: "${expectedColumns[i]}", Obtenido: "${columns[i]}"`);
        return false;
      }
    }

    logger.info(`[MetaFeed] Validación de columnas: OK (${columns.length} columnas correctas)`);
    return true;
  }

  /**
   * Genera el CSV del feed
   * Estructura EXACTA basada en el CSV aprobado por Meta (catalogo_aprobado.csv)
   * IMPORTANTE: Los nombres de columnas deben ser idénticos al ejemplo proporcionado
   */
  private static async generateCSV(): Promise<string> {
    const vehicles = await this.getPublishedVehicles();
    
    logger.info(`[MetaFeed] Generando feed CSV para ${vehicles.length} vehículos publicados`);

    // Columnas EXACTAS según el CSV aprobado por Meta (catalogo_aprobado.csv)
    // IMPORTANTE: Orden y nombres deben ser idénticos, sin espacios ni caracteres invisibles
    const columns = [
      'vehicle_id',
      'title',
      'description',
      'availability',
      'state_of_vehicle',
      'condition',
      'price',
      'url',
      'image[0].url',
      'image[1].url',
      'make',
      'model',
      'year',
      'mileage.value',
      'mileage.unit',
      'fuel_type',
      'transmission',
      'body_style',
      'address.addr1',
      'address.city',
      'address.region',
      'address.postal_code',
      'address.country',
      'latitude',
      'longitude',
    ];

    // Validar que las columnas sean exactamente iguales al CSV aprobado
    if (!this.validateColumnNames(columns)) {
      throw new Error('Los nombres de columnas no coinciden con el formato requerido por Meta');
    }

    const rows: string[][] = [];
    
    // Agregar header
    rows.push(columns);

    let includedCount = 0;
    let skippedCount = 0;

    for (const vehicle of vehicles) {
      try {
        // Determinar precio y moneda
        const hasUsdPrice = vehicle.price_usd && vehicle.price_usd > 1;
        const hasArsPrice = vehicle.price_ars && vehicle.price_ars > 1;
        
        if (!hasUsdPrice && !hasArsPrice) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: sin precio válido`);
          continue;
        }

        // Usar USD si existe, sino ARS
        const price = hasUsdPrice ? parseFloat(vehicle.price_usd) : parseFloat(vehicle.price_ars);
        const currency = hasUsdPrice ? 'USD' : 'ARS';
        // Formato Meta: "15000 USD" (número + espacio + código ISO, sin símbolos)
        const priceFormatted = `${Math.round(price)} ${currency}`;

        // Construir URL del vehículo (usar FRONTEND_URL para páginas)
        const vehicleUrl = `${this.FRONTEND_URL}/autos/${vehicle.id}`;

        // Obtener imágenes
        const images = vehicle.images || [];
        const imageUrls: string[] = [];
        
        for (const img of images) {
          const url = this.buildImageUrl(img);
          if (url) {
            imageUrls.push(url);
          }
        }

        // Remover duplicados
        const uniqueImageUrls = Array.from(new Set(imageUrls));

        if (uniqueImageUrls.length === 0) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: sin imágenes`);
          continue;
        }

        // Imagen principal (image[0].url) - sin comillas, URL simple
        const mainImage = uniqueImageUrls[0];
        // Imágenes adicionales (image[1].url) - separadas por coma, máximo 11 (total 12 imágenes)
        // IMPORTANTE: Este campo debe contener múltiples URLs separadas por coma
        // El escapeCsvField se encargará de agregar comillas si es necesario
        const additionalImages = uniqueImageUrls.slice(1, 12).join(',');

        // Obtener datos de taxonomías
        const taxonomies = vehicle.taxonomies || {};
        const brand = taxonomies.brand?.[0] || '';
        const model = taxonomies.model?.[0] || '';
        const rawCondition = taxonomies.condition?.[0];
        const rawFuelType = taxonomies.fuel_type?.[0];
        const rawTransmission = taxonomies.transmission?.[0];
        const rawBodyStyle = taxonomies.segment?.[0];

        // Validar campos requeridos básicos
        if (!brand || !model) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: falta brand o model (brand: ${brand}, model: ${model})`);
          continue;
        }

        // Normalizar y validar state_of_vehicle (OBLIGATORIO)
        const stateOfVehicle = normalizeStateOfVehicle(rawCondition);
        if (!stateOfVehicle) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: condition inválido o faltante (valor: ${rawCondition || 'null'})`);
          continue;
        }

        // Validar mileage (OBLIGATORIO)
        const mileageValue = normalizeMileage(vehicle.kilometres);
        if (!mileageValue) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: mileage inválido o faltante (valor: ${vehicle.kilometres})`);
          continue;
        }

        // Normalizar y validar transmission (OBLIGATORIO)
        const transmission = normalizeTransmission(rawTransmission);
        if (!transmission) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: transmission vacío o inválido (valor: ${rawTransmission || 'null'})`);
          continue;
        }

        // Normalizar fuel_type (OBLIGATORIO)
        const fuelType = normalizeFuelType(rawFuelType);
        if (!fuelType) {
          skippedCount++;
          logger.warn(`[MetaFeed] Vehículo ${vehicle.id} omitido: fuel_type no se puede normalizar (valor: ${rawFuelType || 'null'})`);
          continue;
        }

        // Normalizar body_style
        const bodyStyle = normalizeBodyStyle(rawBodyStyle);

        // Normalizar availability (todos los vehículos aquí son published)
        const availability = normalizeAvailability('published', true);

        // Construir descripción
        const description = this.sanitizeDescription(vehicle.content || vehicle.title);

        // Construir fila CSV con estructura EXACTA del CSV aprobado
        // IMPORTANTE: El orden debe coincidir exactamente con el array de columnas
        const row: string[] = [
          String(vehicle.id),                    // vehicle_id
          vehicle.title,                         // title
          description,                           // description
          availability,                          // availability (AVAILABLE)
          stateOfVehicle,                        // state_of_vehicle (NEW/USED/CPO)
          'OTHER',                               // condition (valor fijo como en CSV aprobado)
          priceFormatted,                        // price (50000 USD o 24000000 ARS)
          vehicleUrl,                            // url
          mainImage,                             // image[0].url
          additionalImages,                      // image[1].url (múltiples URLs separadas por coma)
          brand,                                 // make
          model,                                 // model
          vehicle.year ? String(vehicle.year) : '', // year
          mileageValue,                          // mileage.value
          'KM',                                  // mileage.unit (siempre KM)
          fuelType,                              // fuel_type (GASOLINE, DIESEL, etc.)
          transmission,                          // transmission (AUTOMATIC, MANUAL, OTHER)
          bodyStyle,                             // body_style (SEDAN, SUV, etc.)
          this.DEFAULT_ADDRESS.addr1,            // address.addr1
          this.DEFAULT_ADDRESS.city,             // address.city
          this.DEFAULT_ADDRESS.region,           // address.region
          this.DEFAULT_ADDRESS.postal_code,      // address.postal_code
          this.DEFAULT_ADDRESS.country,          // address.country
          this.DEFAULT_ADDRESS.latitude,         // latitude
          this.DEFAULT_ADDRESS.longitude,        // longitude
        ];

        // Validar que la fila tenga exactamente el mismo número de columnas que el header
        if (row.length !== columns.length) {
          skippedCount++;
          logger.error(`[MetaFeed] Vehículo ${vehicle.id} omitido: número de columnas incorrecto (${row.length} vs ${columns.length})`);
          continue;
        }

        // Escapar todos los campos
        const escapedRow = row.map(field => this.escapeCsvField(field));
        rows.push(escapedRow);
        includedCount++;

      } catch (error: any) {
        skippedCount++;
        logger.error(`[MetaFeed] Error procesando vehículo ${vehicle.id}: ${error.message}`);
        // Continuar con el siguiente vehículo
      }
    }

    // Unir filas con saltos de línea
    // IMPORTANTE: No agregar BOM aquí, el controlador lo hace
    const csvContent = rows.map(row => row.join(',')).join('\n');

    // Log del header generado para debugging
    logger.info(`[MetaFeed] Header generado: ${columns.join(',')}`);
    logger.info(`[MetaFeed] Feed generado: ${includedCount} vehículos incluidos, ${skippedCount} omitidos`);

    return csvContent;
  }

  /**
   * Obtiene el feed CSV (con cache)
   */
  static async getFeedCSV(): Promise<string> {
    const now = Date.now();
    
    // Verificar cache
    if (this.cache && (now - this.cache.timestamp) < this.CACHE_TTL) {
      logger.debug('[MetaFeed] Sirviendo feed desde cache');
      return this.cache.csv;
    }

    // Generar nuevo feed
    try {
      const csv = await this.generateCSV();
      this.cache = {
        csv,
        timestamp: now
      };
      return csv;
    } catch (error: any) {
      logger.error(`[MetaFeed] Error generando feed: ${error.message}`);
      
      // Si hay error pero tenemos cache viejo, devolverlo como fallback
      if (this.cache) {
        logger.warn('[MetaFeed] Devolviendo cache viejo debido a error');
        return this.cache.csv;
      }
      
      throw error;
    }
  }

  /**
   * Invalida el cache del feed
   */
  static invalidateCache(): void {
    this.cache = null;
    logger.info('[MetaFeed] Cache invalidado');
  }
}
