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
}

export default new AsofixApi();

