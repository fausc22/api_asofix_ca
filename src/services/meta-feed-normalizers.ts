/**
 * Normalizadores centralizados para el feed de Meta (Facebook Automotive Catalog)
 * 
 * Todas las transformaciones de datos deben cumplir estrictamente con los valores aceptados por Meta.
 */

/**
 * Normaliza body_style a valores aceptados por Meta
 * - Convierte a MAYÚSCULAS
 * - Quita acentos y espacios
 * - Elimina variantes (PLUS, LIVIANA, etc.)
 * - Mapea solo a valores aceptados por Meta
 */
export function normalizeBodyStyle(input: string | null | undefined): string {
  if (!input) return 'OTHER';

  // Normalizar: quitar acentos, convertir a mayúsculas, quitar espacios extra
  let normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' '); // Normalizar espacios

  // Eliminar variantes comunes
  normalized = normalized
    .replace(/\s+PLUS\s*/gi, ' ')
    .replace(/\s+LIVIANA\s*/gi, ' ')
    .replace(/\s+PLUS$/gi, '')
    .replace(/\s+LIVIANA$/gi, '')
    .trim();

  // Mapeo exacto según tabla de especificación
  const mapping: Record<string, string> = {
    'SEDAN': 'SEDAN',
    'SEDÁN': 'SEDAN',
    'SUV': 'SUV',
    'HATCHBACK': 'HATCHBACK',
    'HATCH': 'HATCHBACK',
    'PICKUP': 'PICKUP',
    'PICK UP': 'PICKUP',
    'PICK-UP': 'PICKUP',
    'DEPORTIVO': 'SPORTSCAR',
    'SPORTSCAR': 'SPORTSCAR',
    'SPORTS CAR': 'SPORTSCAR',
    'FAMILIAR': 'WAGON',
    'WAGON': 'WAGON',
    'UTILITARIO': 'VAN',
    'VAN': 'VAN',
    'COUPE': 'SPORTSCAR',
    'CONVERTIBLE': 'SPORTSCAR',
  };

  // Buscar coincidencia exacta o parcial
  const normalizedKey = normalized.toUpperCase();
  
  // Primero intentar coincidencia exacta
  if (mapping[normalizedKey]) {
    return mapping[normalizedKey];
  }

  // Buscar coincidencia parcial (para casos como "Sedán Plus" que ya se limpió)
  for (const [key, value] of Object.entries(mapping)) {
    if (normalizedKey.includes(key) || key.includes(normalizedKey)) {
      return value;
    }
  }

  // Si no matchea → usar OTHER
  return 'OTHER';
}

/**
 * Normaliza condition a state_of_vehicle (valores aceptados por Meta)
 * Valores aceptados: NEW, USED, CPO
 * 
 * @returns Valor normalizado o null si es inválido (debe excluirse el vehículo)
 */
export function normalizeStateOfVehicle(condition: string | null | undefined): string | null {
  if (!condition) return null;

  const normalized = condition
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
    .toUpperCase()
    .trim();

  // Mapeo de valores aceptados
  if (normalized.includes('NEW') || normalized.includes('NUEVO') || normalized === '0KM' || normalized === '0 KM') {
    return 'NEW';
  }

  if (normalized.includes('CPO') || normalized.includes('CERTIFIED')) {
    return 'CPO';
  }

  if (normalized.includes('USED') || normalized.includes('USADO')) {
    return 'USED';
  }

  // Si no coincide con ningún valor válido, retornar null (debe excluirse)
  return null;
}

/**
 * Normaliza fuel_type a valores aceptados por Meta
 * Valores aceptados: GASOLINE, DIESEL, HYBRID, ELECTRIC, CNG
 */
export function normalizeFuelType(input: string | null | undefined): string | null {
  if (!input) return null;

  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
    .toUpperCase()
    .trim();

  // Mapeo exacto
  const mapping: Record<string, string> = {
    'NAFTA': 'GASOLINE',
    'GASOLINE': 'GASOLINE',
    'GASOLINA': 'GASOLINE',
    'BENZINA': 'GASOLINE',
    'DIESEL': 'DIESEL',
    'GASOIL': 'DIESEL',
    'GAS OIL': 'DIESEL',
    'HIBRIDO': 'HYBRID',
    'HYBRID': 'HYBRID',
    'HIBRID': 'HYBRID',
    'ELECTRICO': 'ELECTRIC',
    'ELECTRIC': 'ELECTRIC',
    'ELECTRICA': 'ELECTRIC',
    'GNC': 'CNG',
    'CNG': 'CNG',
    'GAS NATURAL': 'CNG',
    'GAS NATURAL COMPRIMIDO': 'CNG',
  };

  // Buscar coincidencia exacta
  if (mapping[normalized]) {
    return mapping[normalized];
  }

  // Buscar coincidencia parcial
  for (const [key, value] of Object.entries(mapping)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }

  // Si no coincide → retornar null (debe excluirse o usar fallback si Meta lo acepta)
  // Por ahora retornamos null para que se excluya el vehículo
  return null;
}

/**
 * Normaliza transmission a valores aceptados por Meta
 * Valores aceptados: AUTOMATIC, MANUAL, OTHER
 * 
 * @returns Valor normalizado o null si está vacío (debe excluirse el vehículo)
 */
export function normalizeTransmission(input: string | null | undefined): string | null {
  if (!input) return null;

  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
    .toUpperCase()
    .trim();

  // Mapeo exacto
  const mapping: Record<string, string> = {
    'AUTOMATICO': 'AUTOMATIC',
    'AUTOMATIC': 'AUTOMATIC',
    'AUTOMATICA': 'AUTOMATIC',
    'AUTO': 'AUTOMATIC',
    'CVT': 'AUTOMATIC',
    'MANUAL': 'MANUAL',
    'MECANICA': 'MANUAL',
    'MECANICO': 'MANUAL',
  };

  // Buscar coincidencia exacta
  if (mapping[normalized]) {
    return mapping[normalized];
  }

  // Buscar coincidencia parcial
  for (const [key, value] of Object.entries(mapping)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }

  // Si no coincide → usar OTHER
  return 'OTHER';
}

/**
 * Normaliza availability a valores exactos aceptados por Meta
 * Valores aceptados: AVAILABLE, NOT_AVAILABLE, PENDING, UNKNOWN
 */
export function normalizeAvailability(
  status: string | null | undefined,
  isPublished: boolean = true
): string {
  if (!status && !isPublished) {
    return 'NOT_AVAILABLE';
  }

  if (!status) {
    return 'UNKNOWN';
  }

  const normalized = status
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '_'); // Reemplazar espacios con guiones bajos

  // Mapeo estricto
  const mapping: Record<string, string> = {
    'AVAILABLE': 'AVAILABLE',
    'IN_STOCK': 'AVAILABLE',
    'IN STOCK': 'AVAILABLE',
    'INSTOCK': 'AVAILABLE',
    'PUBLISHED': 'AVAILABLE',
    'NOT_AVAILABLE': 'NOT_AVAILABLE',
    'NOT AVAILABLE': 'NOT_AVAILABLE',
    'NOTAVAILABLE': 'NOT_AVAILABLE',
    'OUT_OF_STOCK': 'NOT_AVAILABLE',
    'OUT OF STOCK': 'NOT_AVAILABLE',
    'OUTOFSTOCK': 'NOT_AVAILABLE',
    'ARCHIVED': 'NOT_AVAILABLE',
    'PENDING': 'PENDING',
    'UNKNOWN': 'UNKNOWN',
  };

  // Buscar coincidencia exacta
  if (mapping[normalized]) {
    return mapping[normalized];
  }

  // Buscar coincidencia parcial
  for (const [key, value] of Object.entries(mapping)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }

  // Fallback a UNKNOWN
  return 'UNKNOWN';
}

/**
 * Valida y normaliza mileage
 * - Debe ser numérico
 * - No puede ser null o vacío
 * 
 * @returns Número como string o null si es inválido
 */
export function normalizeMileage(mileage: number | string | null | undefined): string | null {
  if (mileage === null || mileage === undefined || mileage === '') {
    return null;
  }

  // Convertir a número
  const numValue = typeof mileage === 'string' ? parseFloat(mileage) : Number(mileage);

  // Validar que sea numérico y positivo
  if (isNaN(numValue) || numValue < 0) {
    return null;
  }

  // Retornar como string (sin decimales)
  return String(Math.round(numValue));
}

/**
 * Obtiene la dirección (address) para el vehículo
 * - Campo obligatorio para Meta
 * - Formato: "Ciudad, Provincia, País"
 * 
 * @param additionalData Datos adicionales del vehículo (JSON)
 * @param defaultAddress Dirección por defecto si no se encuentra
 * @returns Dirección formateada
 */
export function getVehicleAddress(
  additionalData: any,
  defaultAddress: string = 'Córdoba, Córdoba, Argentina'
): string {
  // Intentar obtener desde additional_data
  if (additionalData) {
    try {
      const data = typeof additionalData === 'string' ? JSON.parse(additionalData) : additionalData;
      
      // Buscar en diferentes campos posibles
      const location = data.location || data.ubicacion || data.address || data.direccion;
      const city = data.city || data.ciudad;
      const province = data.province || data.provincia || data.state || data.estado;
      const country = data.country || data.pais || 'Argentina';

      // Si hay location completa, usarla
      if (location && typeof location === 'string') {
        return location;
      }

      // Construir desde componentes
      if (city || province) {
        const parts = [city, province, country].filter(Boolean);
        if (parts.length >= 2) {
          return parts.join(', ');
        }
      }

      // Buscar en stock_info
      if (data.stock_info && Array.isArray(data.stock_info) && data.stock_info.length > 0) {
        const stock = data.stock_info[0];
        const stockLocation = stock.location || stock.ubicacion || stock.address || stock.direccion;
        const stockCity = stock.city || stock.ciudad;
        const stockProvince = stock.province || stock.provincia || stock.state || stock.estado;

        if (stockLocation) {
          return stockLocation;
        }

        if (stockCity || stockProvince) {
          const parts = [stockCity, stockProvince, 'Argentina'].filter(Boolean);
          if (parts.length >= 2) {
            return parts.join(', ');
          }
        }
      }
    } catch (error) {
      // Si hay error parseando JSON, continuar con default
    }
  }

  // Usar dirección por defecto
  return defaultAddress;
}

