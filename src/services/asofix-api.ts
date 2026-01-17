import axios, { AxiosInstance } from 'axios';
import logger from './logger';

export interface AsofixVehicle {
  id: string;
  brand_name?: string;
  model_name?: string;
  version?: string;
  description?: string;
  year?: number;
  kilometres?: number;
  license_plate?: string;
  origin?: string;
  car_condition?: 'new' | 'used';
  car_transmission?: string;
  car_fuel_type?: string;
  car_segment?: string;
  price?: {
    list_price?: number;
    currency_name?: string;
  };
  colors?: Array<{ name?: string }>;
  stocks?: Array<{
    status?: string;
    branch_office_name?: string;
    location_name?: string;
  }>;
  images?: Array<{ url?: string }>;
}

export interface AsofixApiResponse {
  data?: AsofixVehicle[];
  meta?: {
    current_page?: number;
    total_pages?: number;
    total_count?: number;
  };
  message?: string;
}

class AsofixApi {
  private apiKey: string;
  private endpoint: string;
  private client: AxiosInstance;

  constructor() {
    this.apiKey = (process.env.ASOFIX_API_KEY || '').trim();
    this.endpoint = process.env.ASOFIX_API_ENDPOINT || 'https://app.asofix.com/api/catalogs/web';

    if (!this.apiKey) {
      logger.warn('ASOFIX_API_KEY no está configurada en las variables de entorno');
    } else {
      const maskedKey = this.apiKey.length > 10 
        ? `${this.apiKey.substring(0, 5)}...${this.apiKey.substring(this.apiKey.length - 5)}`
        : '***';
      logger.info(`API Key configurada: ${maskedKey} (longitud: ${this.apiKey.length})`);
    }

    this.client = axios.create({
      baseURL: this.endpoint,
      timeout: 60000, // 60 segundos
    });
  }

  /**
   * Obtiene una página de vehículos de la API
   * @param page Número de página
   * @param perPage Cantidad de vehículos por página
   * @returns Datos de la API
   */
  async getVehiclesPage(page: number = 1, perPage: number = 10): Promise<AsofixApiResponse> {
    if (!this.apiKey) {
      throw new Error('La API Key no está configurada. Verifica tu archivo .env');
    }

    try {
      const url = this.endpoint;
      const params = {
        page,
        per_page: perPage,
        include_stock_info: 'true',
        include_images: 'true'
      };

      logger.info(`Solicitando página ${page} a: ${url}`);
      
      const cleanApiKey = this.apiKey.trim();

      const response = await this.client.get('', {
        params,
        headers: {
          'x-api-key': cleanApiKey,
        },
        transformRequest: [(data, headers) => {
          return data;
        }]
      });

      const httpCode = response.status;
      if (httpCode >= 400) {
        const message = response.data?.message || 'Error desconocido en la API.';
        const errorDetails = response.data || {};
        logger.error(`Error HTTP ${httpCode}: ${message}`, { details: errorDetails });
        throw new Error(`Error en la API de Asofix (Código: ${httpCode}). Mensaje: ${message}`);
      }

      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const responseData = error.response?.data;
        
        if (status === 401) {
          logger.error(`Error API externa ASOFIX - Status: 401, Mensaje: No autorizado (API Key inválida)`);
          throw new Error('Error 401: API Key inválida o no autorizada. Verifica tu API Key en el archivo .env');
        }
        
        // Log estructurado para errores HTTP
        logger.error(`Error API externa ASOFIX - Status: ${status}, Endpoint: ${error.config?.url || 'unknown'}, Mensaje: ${error.message}`);
        throw new Error(`Error en la API de Asofix: ${error.message} (Status: ${status})`);
      }
      throw error;
    }
  }

  /**
   * Obtiene todos los vehículos activos de la API
   * @returns Array de vehículos activos
   */
  async fetchAllActiveVehicles(): Promise<AsofixVehicle[]> {
    const vehicles: AsofixVehicle[] = [];
    let currentPage = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const response = await this.getVehiclesPage(currentPage);
        const pageVehicles = response.data || [];

        // Filtrar solo vehículos activos
        const activeVehicles = pageVehicles.filter(vehicle => {
          if (!vehicle.stocks || vehicle.stocks.length === 0) return false;
          return vehicle.stocks.some(stock => 
            stock.status && stock.status.toUpperCase() === 'ACTIVO'
          );
        });

        vehicles.push(...activeVehicles);

        // Verificar si hay más páginas
        const meta = response.meta;
        if (meta && meta.current_page && meta.total_pages) {
          hasMore = meta.current_page < meta.total_pages;
          currentPage++;
        } else {
          hasMore = pageVehicles.length > 0;
          currentPage++;
        }

        // Pausa para no sobrecargar la API
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        logger.error(`Error al obtener página ${currentPage}: ${error.message}`);
        hasMore = false;
      }
    }

    return vehicles;
  }

  /**
   * Busca un vehículo por license_plate en la API de Asofix
   * @param licensePlate Número de patente a buscar
   * @returns Vehículo encontrado o null si no existe
   */
  async getVehicleByLicensePlate(licensePlate: string): Promise<AsofixVehicle | null> {
    if (!this.apiKey) {
      throw new Error('La API Key no está configurada. Verifica tu archivo .env');
    }

    if (!licensePlate || licensePlate.trim().length === 0) {
      throw new Error('El license_plate es requerido');
    }

    const normalizedLicensePlate = licensePlate.trim().toUpperCase();

    try {
      // Intentar primero con un parámetro de búsqueda si la API lo soporta
      // Si no funciona, buscar página por página
      let currentPage = 1;
      let hasMore = true;
      const maxPages = parseInt(process.env.ASOFIX_SEARCH_MAX_PAGES || '500', 10); // Límite configurable, default 500
      let pagesSearched = 0;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3; // Detener solo si hay 3 errores consecutivos

      while (hasMore && pagesSearched < maxPages) {
        try {
          const response = await this.getVehiclesPage(currentPage, 100); // Buscar más vehículos por página para ser más eficiente
          const pageVehicles = response.data || [];
          
          // Resetear contador de errores si la página fue exitosa
          consecutiveErrors = 0;

          // Buscar el vehículo con el license_plate coincidente
          const foundVehicle = pageVehicles.find(vehicle => {
            if (!vehicle.license_plate) return false;
            return vehicle.license_plate.trim().toUpperCase() === normalizedLicensePlate;
          });

          if (foundVehicle) {
            logger.info(`Vehículo encontrado por license_plate: ${normalizedLicensePlate} en la página ${currentPage}`);
            return foundVehicle;
          }

          // Verificar si hay más páginas
          const meta = response.meta;
          if (meta && meta.current_page && meta.total_pages) {
            hasMore = meta.current_page < meta.total_pages;
            currentPage++;
            logger.debug(`Buscando en página ${currentPage}/${meta.total_pages}...`);
          } else {
            // Si no hay metadata, continuar mientras haya vehículos
            hasMore = pageVehicles.length > 0;
            currentPage++;
          }

          pagesSearched++;

          // Pausa para no sobrecargar la API
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error: any) {
          consecutiveErrors++;
          logger.warn(`Error al buscar en página ${currentPage} (error ${consecutiveErrors}/${maxConsecutiveErrors}): ${error.message}`);
          
          // Solo detener si hay demasiados errores consecutivos
          if (consecutiveErrors >= maxConsecutiveErrors) {
            logger.error(`Demasiados errores consecutivos (${consecutiveErrors}). Deteniendo búsqueda después de ${pagesSearched} páginas.`);
            hasMore = false;
          } else {
            // Continuar con la siguiente página después de un breve delay
            currentPage++;
            pagesSearched++;
            await new Promise(resolve => setTimeout(resolve, 500)); // Delay más largo después de error
          }
        }
      }

      logger.info(`Vehículo no encontrado con license_plate: ${normalizedLicensePlate} (buscado en ${pagesSearched} páginas, máximo: ${maxPages})`);
      return null;
    } catch (error: any) {
      logger.error(`Error al buscar vehículo por license_plate: ${error.message}`);
      throw error;
    }
  }

  /**
   * Busca un vehículo por origin en la API de Asofix
   * @param origin Origen del vehículo a buscar
   * @returns Vehículo encontrado o null si no existe
   */
  async getVehicleByOrigin(origin: string): Promise<AsofixVehicle | null> {
    if (!this.apiKey) {
      throw new Error('La API Key no está configurada. Verifica tu archivo .env');
    }

    if (!origin || origin.trim().length === 0) {
      throw new Error('El origin es requerido');
    }

    const normalizedOrigin = origin.trim().toUpperCase();

    try {
      // Intentar primero con un parámetro de búsqueda si la API lo soporta
      // Si no funciona, buscar página por página
      let currentPage = 1;
      let hasMore = true;
      const maxPages = parseInt(process.env.ASOFIX_SEARCH_MAX_PAGES || '500', 10); // Límite configurable, default 500
      let pagesSearched = 0;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3; // Detener solo si hay 3 errores consecutivos

      while (hasMore && pagesSearched < maxPages) {
        try {
          const response = await this.getVehiclesPage(currentPage, 100); // Buscar más vehículos por página para ser más eficiente
          const pageVehicles = response.data || [];
          
          // Resetear contador de errores si la página fue exitosa
          consecutiveErrors = 0;

          // Buscar el vehículo con el origin coincidente
          const foundVehicle = pageVehicles.find(vehicle => {
            if (!vehicle.origin) return false;
            return vehicle.origin.trim().toUpperCase() === normalizedOrigin;
          });

          if (foundVehicle) {
            logger.info(`Vehículo encontrado por origin: ${normalizedOrigin} en la página ${currentPage}`);
            return foundVehicle;
          }

          // Verificar si hay más páginas
          const meta = response.meta;
          if (meta && meta.current_page && meta.total_pages) {
            hasMore = meta.current_page < meta.total_pages;
            currentPage++;
            logger.debug(`Buscando en página ${currentPage}/${meta.total_pages}...`);
          } else {
            // Si no hay metadata, continuar mientras haya vehículos
            hasMore = pageVehicles.length > 0;
            currentPage++;
          }

          pagesSearched++;

          // Pausa para no sobrecargar la API
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error: any) {
          consecutiveErrors++;
          logger.warn(`Error al buscar en página ${currentPage} (error ${consecutiveErrors}/${maxConsecutiveErrors}): ${error.message}`);
          
          // Solo detener si hay demasiados errores consecutivos
          if (consecutiveErrors >= maxConsecutiveErrors) {
            logger.error(`Demasiados errores consecutivos (${consecutiveErrors}). Deteniendo búsqueda después de ${pagesSearched} páginas.`);
            hasMore = false;
          } else {
            // Continuar con la siguiente página después de un breve delay
            currentPage++;
            pagesSearched++;
            await new Promise(resolve => setTimeout(resolve, 500)); // Delay más largo después de error
          }
        }
      }

      logger.info(`Vehículo no encontrado con origin: ${normalizedOrigin} (buscado en ${pagesSearched} páginas, máximo: ${maxPages})`);
      return null;
    } catch (error: any) {
      logger.error(`Error al buscar vehículo por origin: ${error.message}`);
      throw error;
    }
  }
}

export default new AsofixApi();

