import pool from '../config/database';
import logger from './logger';
import { filterConfig } from '../config/filters';

/**
 * Servicio para generar feeds XML compatibles con Google Merchant Center - Vehicle Listings
 * 
 * Referencia: https://developers.google.com/vehicle-listings/reference/feed-specification
 */
export class GoogleFeedService {
  // URL del frontend (para links de páginas de vehículos)
  private static FRONTEND_URL = process.env.FRONTEND_URL || process.env.BASE_URL || 'https://caradvice.com.ar';
  // URL de la API (para imágenes y recursos)
  private static API_URL = process.env.API_BASE_URL || 'https://api-caradvice.duckdns.org';
  private static CACHE_TTL = 10 * 60 * 1000; // 10 minutos
  private static cache: { xml: string; timestamp: number } | null = null;

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
   * Escapa texto para XML
   */
  private static escapeXml(text: string | null | undefined): string {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Sanitiza HTML de la descripción (remueve tags pero mantiene texto)
   */
  private static sanitizeDescription(html: string | null | undefined): string {
    if (!html) return '';
    // Remover tags HTML y limitar longitud
    const text = html.replace(/<[^>]*>/g, '').trim();
    // Limitar a 5000 caracteres (límite recomendado de Google)
    return text.substring(0, 5000);
  }

  /**
   * Mapea condición al formato de Google (new / used / refurbished)
   */
  private static mapCondition(condition: string | null | undefined): string {
    if (!condition) return 'used'; // Por defecto usado
    
    const condLower = condition.toLowerCase();
    if (condLower.includes('nuevo') || condLower === 'new') return 'new';
    if (condLower.includes('usado') || condLower === 'used') return 'used';
    if (condLower.includes('refabricado') || condLower === 'refurbished') return 'refurbished';
    
    return 'used'; // Default
  }

  /**
   * Obtiene todos los vehículos publicados con sus imágenes y taxonomías
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
   * Genera el XML del feed
   */
  private static async generateXML(): Promise<string> {
    const vehicles = await this.getPublishedVehicles();
    
    logger.info(`[GoogleFeed] Generando feed XML para ${vehicles.length} vehículos publicados`);

    const xmlParts: string[] = [];
    
    // Encabezado XML
    xmlParts.push('<?xml version="1.0" encoding="UTF-8"?>');
    xmlParts.push('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    xmlParts.push('  <channel>');
    xmlParts.push(`    <title>${this.escapeXml('CAR ADVICE - Catálogo de Vehículos')}</title>`);
    xmlParts.push(`    <link>${this.FRONTEND_URL}</link>`);
    xmlParts.push(`    <description>${this.escapeXml('Catálogo de vehículos disponibles en CAR ADVICE Córdoba')}</description>`);
    xmlParts.push('    <language>es-AR</language>');

    let includedCount = 0;
    let skippedCount = 0;

    for (const vehicle of vehicles) {
      try {
        // Determinar precio y moneda
        const hasUsdPrice = vehicle.price_usd && vehicle.price_usd > 1;
        const hasArsPrice = vehicle.price_ars && vehicle.price_ars > 1;
        
        if (!hasUsdPrice && !hasArsPrice) {
          skippedCount++;
          logger.warn(`[GoogleFeed] Vehículo ${vehicle.id} omitido: sin precio válido`);
          continue;
        }

        // Usar USD si existe, sino ARS
        const price = hasUsdPrice ? parseFloat(vehicle.price_usd) : parseFloat(vehicle.price_ars);
        const currency = hasUsdPrice ? 'USD' : 'ARS';

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
          logger.warn(`[GoogleFeed] Vehículo ${vehicle.id} omitido: sin imágenes`);
          continue;
        }

        const imageLink = uniqueImageUrls[0];
        const additionalImageLinks = uniqueImageUrls.slice(1, 11); // Máximo 10 imágenes adicionales

        // Obtener datos de taxonomías
        const taxonomies = vehicle.taxonomies || {};
        const brand = taxonomies.brand?.[0] || '';
        const model = taxonomies.model?.[0] || '';
        const condition = this.mapCondition(taxonomies.condition?.[0]);
        const fuelType = taxonomies.fuel_type?.[0] || '';
        const transmission = taxonomies.transmission?.[0] || '';
        const color = taxonomies.color?.[0] || '';
        const vehicleBodyStyle = taxonomies.segment?.[0] || '';

        // Validar campos requeridos
        if (!brand || !model) {
          skippedCount++;
          logger.warn(`[GoogleFeed] Vehículo ${vehicle.id} omitido: falta brand o model (brand: ${brand}, model: ${model})`);
          continue;
        }

        // Construir descripción
        const description = this.sanitizeDescription(vehicle.content || vehicle.title);

        // Inicio del item
        xmlParts.push('    <item>');
        
        // Campos requeridos
        xmlParts.push(`      <g:id>${vehicle.id}</g:id>`);
        xmlParts.push(`      <title>${this.escapeXml(vehicle.title)}</title>`);
        xmlParts.push(`      <description>${this.escapeXml(description)}</description>`);
        xmlParts.push(`      <link>${this.escapeXml(vehicleUrl)}</link>`);
        xmlParts.push(`      <g:image_link>${this.escapeXml(imageLink)}</g:image_link>`);
        xmlParts.push(`      <g:price>${price.toFixed(2)} ${currency}</g:price>`);
        xmlParts.push(`      <g:availability>in stock</g:availability>`);
        xmlParts.push(`      <g:condition>${condition}</g:condition>`);
        
        // Campos específicos de vehículos
        xmlParts.push(`      <g:brand>${this.escapeXml(brand)}</g:brand>`);
        xmlParts.push(`      <g:model>${this.escapeXml(model)}</g:model>`);
        
        if (vehicle.year) {
          xmlParts.push(`      <g:year>${vehicle.year}</g:year>`);
        }
        
        if (vehicle.kilometres !== null && vehicle.kilometres !== undefined) {
          xmlParts.push(`      <g:mileage>${vehicle.kilometres}</g:mileage>`);
        }
        
        if (fuelType) {
          xmlParts.push(`      <g:fuel_type>${this.escapeXml(fuelType)}</g:fuel_type>`);
        }
        
        if (transmission) {
          xmlParts.push(`      <g:transmission>${this.escapeXml(transmission)}</g:transmission>`);
        }
        
        if (vehicleBodyStyle) {
          xmlParts.push(`      <g:vehicle_body_style>${this.escapeXml(vehicleBodyStyle)}</g:vehicle_body_style>`);
        }
        
        if (color) {
          xmlParts.push(`      <g:color>${this.escapeXml(color)}</g:color>`);
        }
        
        if (vehicle.license_plate) {
          xmlParts.push(`      <g:license_plate>${this.escapeXml(vehicle.license_plate)}</g:license_plate>`);
        }
        
        // Imágenes adicionales
        for (const additionalImage of additionalImageLinks) {
          xmlParts.push(`      <g:additional_image_link>${this.escapeXml(additionalImage)}</g:additional_image_link>`);
        }

        xmlParts.push('    </item>');
        includedCount++;

      } catch (error: any) {
        skippedCount++;
        logger.error(`[GoogleFeed] Error procesando vehículo ${vehicle.id}: ${error.message}`);
        // Continuar con el siguiente vehículo
      }
    }

    xmlParts.push('  </channel>');
    xmlParts.push('</rss>');

    logger.info(`[GoogleFeed] Feed generado: ${includedCount} vehículos incluidos, ${skippedCount} omitidos`);

    return xmlParts.join('\n');
  }

  /**
   * Obtiene el feed XML (con cache)
   */
  static async getFeedXML(): Promise<string> {
    const now = Date.now();
    
    // Verificar cache
    if (this.cache && (now - this.cache.timestamp) < this.CACHE_TTL) {
      logger.debug('[GoogleFeed] Sirviendo feed desde cache');
      return this.cache.xml;
    }

    // Generar nuevo feed
    try {
      const xml = await this.generateXML();
      this.cache = {
        xml,
        timestamp: now
      };
      return xml;
    } catch (error: any) {
      logger.error(`[GoogleFeed] Error generando feed: ${error.message}`);
      
      // Si hay error pero tenemos cache viejo, devolverlo como fallback
      if (this.cache) {
        logger.warn('[GoogleFeed] Devolviendo cache viejo debido a error');
        return this.cache.xml;
      }
      
      throw error;
    }
  }

  /**
   * Invalida el cache del feed
   */
  static invalidateCache(): void {
    this.cache = null;
    logger.info('[GoogleFeed] Cache invalidado');
  }
}
