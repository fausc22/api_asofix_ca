import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interfaz para representar un vehículo normalizado
 */
interface NormalizedVehicle {
  licensePlate?: string;
  brand: string;
  model: string;
  year?: number;
  version?: string;
  title?: string;
  // Clave de comparación normalizada
  comparisonKey: string;
  // Datos originales para referencia
  originalData: any;
}

/**
 * Normaliza una patente/license plate
 */
function normalizeLicensePlate(plate: string | undefined | null): string | undefined {
  if (!plate) return undefined;
  
  // Convertir a string, trim, uppercase, remover espacios y guiones
  const normalized = String(plate)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/[^A-Z0-9]/g, '');
  
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Normaliza un string (marca, modelo, versión)
 */
function normalizeString(str: string | undefined | null): string {
  if (!str) return '';
  
  return String(str)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s{2,}/g, ' ');
}

/**
 * Normaliza un año
 */
function normalizeYear(year: any): number | undefined {
  if (!year) return undefined;
  
  // Intentar convertir a número
  const num = typeof year === 'number' ? year : parseInt(String(year).replace(/[^\d]/g, ''), 10);
  
  if (isNaN(num) || num < 1900 || num > 2100) return undefined;
  
  return num;
}

/**
 * Crea una clave de comparación para un vehículo
 */
function createComparisonKey(vehicle: {
  licensePlate?: string;
  brand: string;
  model: string;
  year?: number;
  version?: string;
}): string {
  const plate = normalizeLicensePlate(vehicle.licensePlate);
  const brand = normalizeString(vehicle.brand);
  const model = normalizeString(vehicle.model);
  const year = vehicle.year ? String(vehicle.year) : '';
  const version = normalizeString(vehicle.version || '');
  
  // Prioridad 1: Si hay patente, usarla como clave principal
  if (plate) {
    return `PLATE:${plate}`;
  }
  
  // Prioridad 2: Combinación de marca + modelo + año + versión
  const parts = [brand, model, year, version].filter(p => p.length > 0);
  return `COMBO:${parts.join('|')}`;
}

/**
 * Lee vehículos del archivo CSV del servidor
 */
function readServerCSV(filePath: string): NormalizedVehicle[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length === 0) {
    throw new Error('El archivo CSV está vacío');
  }
  
  // Parsear header
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const licensePlateIdx = headers.indexOf('license_plate');
  const brandIdx = headers.indexOf('brand');
  const modelIdx = headers.indexOf('model');
  const titleIdx = headers.indexOf('title');
  const yearIdx = headers.indexOf('year');
  
  if (brandIdx === -1 || modelIdx === -1) {
    throw new Error('El CSV no tiene las columnas requeridas (brand, model)');
  }
  
  const vehicles: NormalizedVehicle[] = [];
  
  // Parsear cada línea
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parsear CSV (manejar comas dentro de campos entre comillas)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    
    const licensePlate = licensePlateIdx >= 0 ? values[licensePlateIdx] : undefined;
    const brand = values[brandIdx] || '';
    const model = values[modelIdx] || '';
    const title = titleIdx >= 0 ? values[titleIdx] : undefined;
    
    // Intentar extraer año del título si no hay columna de año
    let year: number | undefined = undefined;
    if (yearIdx >= 0 && values[yearIdx]) {
      year = normalizeYear(values[yearIdx]);
    } else if (title) {
      // Buscar año en el título (formato común: "L18", "L20", "2020", etc.)
      const yearMatch = title.match(/\b(20\d{2})\b/) || title.match(/L(\d{2})/);
      if (yearMatch) {
        year = yearMatch[1] ? parseInt(yearMatch[1], 10) : (2000 + parseInt(yearMatch[2] || '0', 10));
      }
    }
    
    // Extraer versión del título si está disponible
    const version = title ? normalizeString(title) : undefined;
    
    if (brand && model) {
      const normalized: NormalizedVehicle = {
        licensePlate: normalizeLicensePlate(licensePlate),
        brand: normalizeString(brand),
        model: normalizeString(model),
        year,
        version,
        title,
        comparisonKey: '',
        originalData: {
          licensePlate,
          brand,
          model,
          title,
          year
        }
      };
      
      normalized.comparisonKey = createComparisonKey(normalized);
      vehicles.push(normalized);
    }
  }
  
  return vehicles;
}

/**
 * Lee vehículos del archivo Excel oficial
 */
function readOfficialExcel(filePath: string): NormalizedVehicle[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convertir a JSON
  const data = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false
  }) as any[][];
  
  if (data.length === 0) {
    throw new Error('El archivo Excel está vacío');
  }
  
  // Buscar header (puede estar en diferentes filas)
  let headerRow = -1;
  let headerMap: { [key: string]: number } = {};
  
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    const lowerRow = row.map((cell: any) => String(cell).toLowerCase().trim());
    
    // Buscar columnas comunes
    const marcaIdx = lowerRow.findIndex((cell: string) => 
      cell.includes('marca') || cell.includes('brand')
    );
    const modeloIdx = lowerRow.findIndex((cell: string) => 
      cell.includes('modelo') || cell.includes('model')
    );
    const patenteIdx = lowerRow.findIndex((cell: string) => 
      cell.includes('patente') || cell.includes('dominio') || cell.includes('license') || cell.includes('plate')
    );
    const añoIdx = lowerRow.findIndex((cell: string) => 
      cell.includes('año') || cell.includes('year') || cell.includes('ano')
    );
    const tituloIdx = lowerRow.findIndex((cell: string) => 
      cell.includes('titulo') || cell.includes('title') || cell.includes('versión') || cell.includes('version')
    );
    
    if (marcaIdx >= 0 && modeloIdx >= 0) {
      headerRow = i;
      headerMap = {
        marca: marcaIdx,
        modelo: modeloIdx,
        patente: patenteIdx,
        año: añoIdx,
        titulo: tituloIdx
      };
      break;
    }
  }
  
  if (headerRow === -1) {
    // Si no encontramos header, intentar detectar estructura automáticamente
    console.warn('⚠️  No se encontró header claro en el Excel. Intentando detectar estructura...');
    
    // Verificar si parece ser datos agregados (tiene columnas CANT, números grandes, etc.)
    const firstDataRow = data.find((row: any[], idx: number) => 
      idx > 0 && row.some((cell: any) => {
        const str = String(cell).toLowerCase();
        return str.includes('cant') || str.includes('total') || str.includes('suma');
      })
    );
    
    if (firstDataRow) {
      console.error('\n❌ ERROR: El Excel parece contener datos AGREGADOS, no una lista de vehículos individuales.');
      console.error('   El archivo Excel debe tener una lista de vehículos con columnas como:');
      console.error('   - Patente/Dominio (opcional pero recomendado)');
      console.error('   - Marca');
      console.error('   - Modelo');
      console.error('   - Año');
      console.error('   - Versión/Título (opcional)');
      console.error('\n   Por favor, exporta o crea un Excel con la lista completa de vehículos individuales.');
      throw new Error('El Excel contiene datos agregados, no una lista de vehículos individuales');
    }
    
    // Si llegamos aquí, intentar usar la primera fila como header
    headerRow = 0;
    const firstRow = data[0] || [];
    headerMap = {
      marca: firstRow.findIndex((cell: any) => 
        String(cell).toLowerCase().includes('marca') || String(cell).toLowerCase().includes('brand')
      ),
      modelo: firstRow.findIndex((cell: any) => 
        String(cell).toLowerCase().includes('modelo') || String(cell).toLowerCase().includes('model')
      ),
      patente: firstRow.findIndex((cell: any) => 
        String(cell).toLowerCase().includes('patente') || 
        String(cell).toLowerCase().includes('dominio') || 
        String(cell).toLowerCase().includes('license') || 
        String(cell).toLowerCase().includes('plate')
      ),
      año: firstRow.findIndex((cell: any) => 
        String(cell).toLowerCase().includes('año') || 
        String(cell).toLowerCase().includes('year') || 
        String(cell).toLowerCase().includes('ano')
      ),
      titulo: firstRow.findIndex((cell: any) => 
        String(cell).toLowerCase().includes('titulo') || 
        String(cell).toLowerCase().includes('title') || 
        String(cell).toLowerCase().includes('versión') || 
        String(cell).toLowerCase().includes('version')
      )
    };
    
    if (headerMap.marca === -1 || headerMap.modelo === -1) {
      throw new Error('No se pudo detectar la estructura del Excel. Se requieren columnas de Marca y Modelo.');
    }
  }
  
  const vehicles: NormalizedVehicle[] = [];
  
  // Procesar filas después del header
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    
    // Saltar filas vacías
    if (!row || row.every((cell: any) => !cell || String(cell).trim().length === 0)) {
      continue;
    }
    
    const marca = headerMap.marca >= 0 ? String(row[headerMap.marca] || '').trim() : '';
    const modelo = headerMap.modelo >= 0 ? String(row[headerMap.modelo] || '').trim() : '';
    const patente = headerMap.patente >= 0 ? row[headerMap.patente] : undefined;
    const año = headerMap.año >= 0 ? row[headerMap.año] : undefined;
    const titulo = headerMap.titulo >= 0 ? row[headerMap.titulo] : undefined;
    
    // Filtrar filas que parecen ser totales o resúmenes
    const marcaLower = marca.toLowerCase();
    const modeloLower = modelo.toLowerCase();
    
    if (
      marcaLower.includes('total') || 
      marcaLower.includes('suma') || 
      marcaLower.includes('cantidad') ||
      modeloLower.includes('total') || 
      modeloLower.includes('suma') ||
      marcaLower === '' ||
      modeloLower === ''
    ) {
      continue;
    }
    
    // Verificar si la fila parece ser un resumen (tiene números grandes en columnas que no son año)
    // Esto es una heurística: si hay muchos números grandes, probablemente es un resumen
    const hasLargeNumbers = row.some((cell: any, idx: number) => {
      if (idx === headerMap.marca || idx === headerMap.modelo || idx === headerMap.patente || idx === headerMap.titulo) {
        return false;
      }
      const num = parseFloat(String(cell).replace(/[^\d.-]/g, ''));
      return !isNaN(num) && num > 100; // Números mayores a 100 probablemente son cantidades
    });
    
    // Si tiene números grandes y no tiene patente, probablemente es un resumen
    if (hasLargeNumbers && !patente) {
      // Pero permitir si tiene marca y modelo válidos (podría ser un vehículo sin patente)
      // Solo saltar si claramente parece un resumen
      const rowStr = row.join(' ').toLowerCase();
      if (rowStr.includes('cant') || rowStr.includes('total')) {
        continue;
      }
    }
    
    if (marca && modelo && marca.length > 0 && modelo.length > 0) {
      const normalized: NormalizedVehicle = {
        licensePlate: normalizeLicensePlate(patente),
        brand: normalizeString(marca),
        model: normalizeString(modelo),
        year: normalizeYear(año),
        version: titulo ? normalizeString(titulo) : undefined,
        title: titulo,
        comparisonKey: '',
        originalData: {
          patente,
          marca,
          modelo,
          año,
          titulo
        }
      };
      
      normalized.comparisonKey = createComparisonKey(normalized);
      vehicles.push(normalized);
    }
  }
  
  return vehicles;
}

/**
 * Compara dos listas de vehículos y encuentra los faltantes
 */
function findMissingVehicles(
  officialVehicles: NormalizedVehicle[],
  serverVehicles: NormalizedVehicle[]
): NormalizedVehicle[] {
  // Crear un Set de claves de comparación del servidor para búsqueda rápida
  const serverKeys = new Set(serverVehicles.map(v => v.comparisonKey));
  
  // También crear un mapa por patente si existe
  const serverByPlate = new Map<string, NormalizedVehicle>();
  serverVehicles.forEach(v => {
    if (v.licensePlate) {
      serverByPlate.set(v.licensePlate, v);
    }
  });
  
  const missing: NormalizedVehicle[] = [];
  
  for (const official of officialVehicles) {
    let found = false;
    
    // Prioridad 1: Buscar por patente si existe
    if (official.licensePlate) {
      if (serverByPlate.has(official.licensePlate)) {
        found = true;
      }
    }
    
    // Prioridad 2: Buscar por clave de comparación
    if (!found && serverKeys.has(official.comparisonKey)) {
      found = true;
    }
    
    // Prioridad 3: Búsqueda flexible por marca + modelo + año
    if (!found) {
      const brandModelYear = `${official.brand}|${official.model}|${official.year || ''}`;
      found = serverVehicles.some(server => {
        const serverBrandModelYear = `${server.brand}|${server.model}|${server.year || ''}`;
        return serverBrandModelYear === brandModelYear && brandModelYear.length > 2;
      });
    }
    
    if (!found) {
      missing.push(official);
    }
  }
  
  return missing;
}

/**
 * Función principal
 */
function main() {
  const dataDir = __dirname;
  const excelPath = path.join(dataDir, 'stock-oficial.xlsx');
  const csvPath = path.join(dataDir, 'stock-server.csv');
  
  console.log('🔍 Comparando archivos de stock...\n');
  console.log(`📄 Excel oficial: ${excelPath}`);
  console.log(`📄 CSV servidor: ${csvPath}\n`);
  
  try {
    // Leer archivos
    console.log('📖 Leyendo archivo Excel oficial...');
    const officialVehicles = readOfficialExcel(excelPath);
    console.log(`   ✅ Encontrados ${officialVehicles.length} vehículos en el Excel oficial\n`);
    
    if (officialVehicles.length === 0) {
      console.error('❌ No se pudieron leer vehículos del Excel oficial.');
      console.error('   El Excel parece tener datos agregados en lugar de una lista de vehículos individuales.');
      console.error('   Por favor, asegúrate de que el Excel tenga columnas como: Marca, Modelo, Patente, Año, etc.');
      process.exit(1);
    }
    
    console.log('📖 Leyendo archivo CSV del servidor...');
    const serverVehicles = readServerCSV(csvPath);
    console.log(`   ✅ Encontrados ${serverVehicles.length} vehículos en el CSV del servidor\n`);
    
    // Comparar
    console.log('🔍 Comparando vehículos...');
    const missingVehicles = findMissingVehicles(officialVehicles, serverVehicles);
    
    // Mostrar resultados
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESULTADOS DE LA COMPARACIÓN');
    console.log('='.repeat(80));
    console.log(`\n📋 Total vehículos en Excel oficial: ${officialVehicles.length}`);
    console.log(`📋 Total vehículos en CSV servidor: ${serverVehicles.length}`);
    console.log(`\n❌ Vehículos faltantes en el servidor: ${missingVehicles.length}\n`);
    
    if (missingVehicles.length > 0) {
      console.log('🚗 DETALLE DE VEHÍCULOS FALTANTES:\n');
      missingVehicles.forEach((vehicle, index) => {
        console.log(`${index + 1}. ${'─'.repeat(78)}`);
        console.log(`   Patente:     ${vehicle.licensePlate || 'N/A'}`);
        console.log(`   Marca:       ${vehicle.brand}`);
        console.log(`   Modelo:      ${vehicle.model}`);
        console.log(`   Año:         ${vehicle.year || 'N/A'}`);
        console.log(`   Versión:     ${vehicle.version || vehicle.title || 'N/A'}`);
        console.log(`   Clave:       ${vehicle.comparisonKey}`);
        console.log(`   Datos orig:  ${JSON.stringify(vehicle.originalData)}`);
        console.log('');
      });
      
      // Exportar a JSON
      const outputPath = path.join(dataDir, 'vehiculos-faltantes.json');
      fs.writeFileSync(outputPath, JSON.stringify(missingVehicles, null, 2), 'utf-8');
      console.log(`\n💾 Resultados exportados a: ${outputPath}\n`);
    } else {
      console.log('✅ ¡Todos los vehículos del Excel oficial están en el servidor!\n');
    }
    
    console.log('='.repeat(80));
    
  } catch (error: any) {
    console.error('\n❌ Error durante la comparación:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Ejecutar
if (require.main === module) {
  main();
}

export { main, readOfficialExcel, readServerCSV, findMissingVehicles, normalizeLicensePlate, normalizeString, normalizeYear, createComparisonKey };

