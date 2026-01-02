# 🔍 Auditoría Técnica - Backend
## Filtrado de Datos, Observabilidad y Robustez Operativa

**Fecha**: 2025-01-XX  
**Objetivo**: Análisis técnico y propuestas de mejora para reglas de negocio, filtrado, observabilidad y robustez operativa.

---

## 📋 Resumen Ejecutivo

Esta auditoría analiza tres áreas críticas del backend:

1. **Filtrado de vehículos por concesionaria "Dakota"** - Estrategia óptima para excluir vehículos
2. **Observabilidad y logs en producción** - Sistema de monitoreo y logging estructurado
3. **Robustez operativa** - Detección de fallos y validación de operaciones críticas

**Estado actual**: Sistema funcional con oportunidades de mejora en filtrado JSON, logging estructurado y monitoreo proactivo.

---

## 1️⃣ FILTRADO DE VEHÍCULOS POR CONCESIONARIA

### 🔴 Situación Actual

**Problema identificado**: Los vehículos de "Dakota" NO deben mostrarse en la API pública, pero la información está almacenada en `additional_data.stock_info[].location_name` (campo JSON).

**Estado del código**:
- El filtro actual usa `branch_office_name` del objeto `stock` durante la sincronización
- En las queries públicas se usa `LIKE` sobre el JSON `additional_data`, pero también busca en `branch_office_name`
- Los datos se guardan en `additional_data.stock_info[]` con ambos campos: `branch_office_name` y `location_name`

**Constraint crítico**: NO se pueden agregar columnas nuevas ni modificar el modelo de datos. Debe usarse exclusivamente el JSON existente.

---

### 🧠 Análisis de Estrategias

#### Opción A: Filtrar Durante Sincronización (Sync-time)

**Descripción**: Filtrar vehículos antes de guardarlos en la base de datos.

**Implementación conceptual**:
- En `VehicleFilters.shouldOmitVehicle()`, leer `stock.location_name` en lugar de (o además de) `branch_office_name`
- Si `location_name` contiene "Dakota", omitir el vehículo
- Archivar vehículos existentes si ahora cumplen el criterio de filtrado

**Ventajas**:
- ✅ **Performance óptimo**: Las queries públicas no necesitan filtros complejos sobre JSON
- ✅ **Base de datos limpia**: Solo se almacenan vehículos válidos
- ✅ **Consistencia garantizada**: Imposible que aparezcan vehículos filtrados por error
- ✅ **Queries simples**: `SELECT * FROM vehicles WHERE status = 'published'` es suficiente
- ✅ **Índices eficientes**: Se puede indexar `status` sin problemas con JSON

**Desventajas**:
- ⚠️ **Pérdida de datos históricos**: Vehículos filtrados no quedan en BD (a menos que se marquen como `archived`)
- ⚠️ **Re-filtrado necesario**: Si cambia la regla, hay que re-sincronizar para recuperar vehículos
- ⚠️ **Debugging limitado**: No se puede consultar fácilmente qué vehículos fueron filtrados en el pasado

**Impacto en performance**:
- **Sincronización**: +5-10ms por vehículo (negligible)
- **Queries públicas**: ~0ms overhead (sin filtros JSON)
- **Escalabilidad**: Excelente (BD más pequeña, queries más rápidas)

**Impacto en consistencia**:
- **Alta**: Los datos en BD son la fuente de verdad filtrada
- **Inmutable**: Una vez filtrado, no aparece en ninguna query

**Mantenimiento a largo plazo**:
- **Alto**: Si cambia la regla de filtrado, requiere re-sincronización
- **Dependencia**: Reglas de negocio hardcodeadas en código de sync

---

#### Opción B: Filtrar en Runtime (Query-time)

**Descripción**: Filtrar vehículos en cada query pública usando funciones JSON de MySQL.

**Implementación conceptual**:
- Usar `JSON_SEARCH()` o `JSON_EXTRACT()` de MySQL para buscar "Dakota" en `additional_data.stock_info[*].location_name`
- Agregar condición WHERE en todas las queries públicas
- Mantener todos los vehículos en BD (incluso los filtrados)

**Ventajas**:
- ✅ **Flexibilidad máxima**: Cambiar reglas sin re-sincronizar
- ✅ **Datos completos**: Todos los vehículos quedan en BD para auditoría
- ✅ **Reversibilidad**: Fácil activar/desactivar filtros
- ✅ **Múltiples reglas**: Fácil agregar más filtros dinámicos
- ✅ **Testing**: Fácil probar diferentes configuraciones

**Desventajas**:
- ❌ **Performance degradada**: Filtros JSON son costosos en MySQL
- ❌ **Índices limitados**: No se pueden indexar fácilmente campos dentro de JSON
- ❌ **Queries complejas**: Código SQL más difícil de mantener
- ❌ **Escalabilidad**: A medida que crece la BD, las queries JSON se vuelven más lentas
- ❌ **Overhead constante**: Cada query pública paga el costo del filtro

**Impacto en performance**:
- **Sincronización**: 0ms overhead (no filtra en sync)
- **Queries públicas**: +50-200ms por query (depende del tamaño de JSON y cantidad de registros)
- **Escalabilidad**: Problemática (performance se degrada con más vehículos)

**Impacto en consistencia**:
- **Media**: Depende de que todas las queries incluyan el filtro
- **Riesgo**: Si se olvida el filtro en una query nueva, aparecen vehículos filtrados

**Mantenimiento a largo plazo**:
- **Bajo**: Fácil cambiar reglas sin tocar datos
- **Riesgo**: Fácil olvidar aplicar filtros en nuevas queries

---

#### Opción C: Enfoque Híbrido (Recomendado)

**Descripción**: Filtrar en sync-time pero mantener metadata adicional para flexibilidad futura.

**Implementación conceptual**:
1. **Durante sync**: Filtrar por `location_name === "Dakota"` y marcar como `status = 'archived'`
2. **En queries**: Filtrar `WHERE status = 'published'` (ya está filtrado)
3. **Metadata opcional**: Guardar razón de filtrado en `additional_data.filter_reason` para debugging
4. **Flexibilidad**: Mantener flag `ENABLE_DYNAMIC_FILTERING` para casos especiales

**Ventajas**:
- ✅ **Performance óptima**: Filtrado en sync, queries simples
- ✅ **Flexibilidad**: Se puede agregar filtrado runtime como fallback
- ✅ **Auditoría**: Metadata de por qué fue filtrado
- ✅ **Reversibilidad**: Vehículos archivados se pueden recuperar
- ✅ **Consistencia**: Doble capa de seguridad (sync + queries)

**Desventajas**:
- ⚠️ **Complejidad inicial**: Implementación más compleja que opciones puras
- ⚠️ **Espacio en BD**: Vehículos archivados ocupan espacio (pero útil para auditoría)

**Impacto en performance**:
- **Sincronización**: +5-10ms por vehículo (similar a Opción A)
- **Queries públicas**: ~0ms overhead (similar a Opción A)
- **Escalabilidad**: Excelente

**Impacto en consistencia**:
- **Muy alta**: Doble capa de filtrado (sync + queries)
- **Robusta**: Si falla una capa, la otra protege

**Mantenimiento a largo plazo**:
- **Alto**: Mejor de ambos mundos (performance + flexibilidad)

---

### 📊 Comparación de Estrategias

| Aspecto | Sync-time | Runtime | Híbrido |
|---------|-----------|---------|---------|
| **Performance queries** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Flexibilidad** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Consistencia** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Mantenimiento** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Escalabilidad** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Complejidad** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

---

### 🎯 Recomendación Final

**Estrategia recomendada: Híbrida (Opción C)**

**Justificación**:
1. **Performance crítica**: Las queries públicas son el punto más caliente del sistema
2. **Doble seguridad**: Filtrar en sync + validación en queries previene errores
3. **Auditoría**: Mantener vehículos archivados permite debugging y análisis
4. **Flexibilidad futura**: Estructura permite agregar filtrado dinámico si es necesario
5. **Trade-off óptimo**: Balance entre performance, flexibilidad y mantenibilidad

**Implementación sugerida**:
1. Modificar `VehicleFilters.shouldOmitVehicle()` para leer `location_name` de `stock`
2. Archivar vehículos filtrados (`status = 'archived'`) en lugar de no guardarlos
3. Mantener filtro en queries como validación adicional (`WHERE status = 'published'`)
4. Opcional: Guardar `filter_reason` en `additional_data` para auditoría
5. Documentar claramente la regla de negocio en código y configuración

**Consideraciones especiales**:
- Si un vehículo existente cambia y ahora debe filtrarse, el sistema debe archivarlo automáticamente
- Si un vehículo archivado cambia y ya no debe filtrarse, debe reactivarse (`status = 'published'`)
- Proceso de migración: Re-sincronizar para archivar vehículos existentes de Dakota

---

## 2️⃣ OBSERVABILIDAD Y LOGS EN PRODUCCIÓN

### 🔴 Situación Actual

**Stack de logging**:
- Winston configurado con transporte a archivos (`error.log`, `sync.log`)
- Consola solo en desarrollo (`NODE_ENV !== 'production'`)
- Sin transporte de consola en producción (no visible en `pm2 logs`)
- Sin Morgan para logs HTTP
- Logs en formato JSON pero sin estructura consistente

**Problemas identificados**:
1. Logs no visibles en `pm2 logs` en producción
2. Sin logs HTTP estructurados (requests/responses)
3. Sin niveles de log apropiados (todo es `info` o `error`)
4. Sin contexto estructurado en logs (difícil buscar/filtrar)
5. Tabla `sync_logs` existe en BD pero no se está usando

---

### 🧠 Estrategia de Logging Estructurado

#### Niveles de Log Recomendados

**Jerarquía estándar (de menor a mayor severidad)**:

1. **`debug`**: Información detallada para desarrollo
   - Variables intermedias
   - Flujos de ejecución detallados
   - Datos de requests/responses completos
   - **Uso**: Solo en desarrollo, deshabilitado en producción

2. **`info`**: Eventos normales del sistema
   - Inicio/fin de sincronizaciones
   - Sincronizaciones completadas exitosamente
   - Vehículos procesados (resumen, no detalle)
   - Startup del servidor
   - **Uso**: Producción, nivel por defecto

3. **`warn`**: Situaciones anormales pero no críticas
   - Sync que tarda más de lo esperado
   - Vehículos filtrados (para auditoría)
   - Intentos de acceso no autorizado
   - Configuraciones faltantes (con valores por defecto)
   - **Uso**: Producción, requiere atención pero no acción inmediata

4. **`error`**: Errores que requieren atención
   - Errores de API externa (ASOFIX)
   - Errores de base de datos
   - Syncs fallidas
   - Errores de procesamiento de imágenes
   - **Uso**: Producción, requiere acción inmediata

---

#### Eventos Críticos que DEBEN Loguearse

##### 1. Sincronizaciones Automáticas (Cron)

**Eventos a loguear**:
- **Inicio**: `info` - Timestamp, tipo (incremental/full), trigger (cron)
- **Progreso**: `info` (cada 100 vehículos o cada 10%) - Página actual, vehículos procesados
- **Finalización exitosa**: `info` - Resumen completo (procesados, creados, actualizados, filtrados, errores, duración)
- **Finalización con errores**: `warn` - Resumen + cantidad de errores
- **Fallo total**: `error` - Error específico, stack trace, página donde falló

**Contexto requerido**:
```json
{
  "event": "sync_cron_start|sync_cron_progress|sync_cron_complete|sync_cron_error",
  "sync_type": "incremental|full",
  "trigger": "cron",
  "timestamp": "ISO8601",
  "duration_seconds": 123,
  "stats": {
    "vehicles_processed": 1000,
    "vehicles_created": 50,
    "vehicles_updated": 200,
    "vehicles_filtered": 10,
    "errors_count": 2
  }
}
```

---

##### 2. Sincronizaciones Manuales

**Eventos a loguear**:
- **Inicio**: `info` - Timestamp, tipo, trigger (manual), IP origen (si disponible)
- **Progreso**: `info` (similar a cron)
- **Finalización**: `info` - Resumen completo
- **Autorización fallida**: `warn` - IP, token usado (masked)

**Contexto requerido**:
```json
{
  "event": "sync_manual_start|sync_manual_complete|sync_manual_auth_failed",
  "sync_type": "incremental|full",
  "trigger": "manual",
  "source_ip": "xxx.xxx.xxx.xxx",
  "timestamp": "ISO8601"
}
```

---

##### 3. Errores de API Externa (ASOFIX)

**Eventos a loguear**:
- **Error HTTP**: `error` - Status code, mensaje, endpoint, página
- **Timeout**: `error` - Timeout configurado, endpoint
- **Respuesta inválida**: `error` - Estructura esperada vs recibida
- **Rate limiting**: `warn` - Intentos, delay aplicado

**Contexto requerido**:
```json
{
  "event": "asofix_api_error",
  "error_type": "http_error|timeout|invalid_response|rate_limit",
  "status_code": 500,
  "endpoint": "/api/catalogs/web",
  "page": 5,
  "message": "Error message",
  "retry_count": 2
}
```

---

##### 4. Errores de Base de Datos

**Eventos a loguear**:
- **Error de conexión**: `error` - Mensaje, intentos de reconexión
- **Query fallida**: `error` - Query (sanitizada), parámetros (masked), error SQL
- **Timeout de query**: `error` - Query, duración, timeout configurado
- **Pool agotado**: `error` - Conexiones activas, límite

**Contexto requerido**:
```json
{
  "event": "database_error",
  "error_type": "connection|query|timeout|pool_exhausted",
  "query_type": "SELECT|INSERT|UPDATE|DELETE",
  "table": "vehicles",
  "message": "Error message",
  "sql_state": "HY000"
}
```

---

##### 5. Ciclo de Vida del Sistema

**Eventos a loguear**:

**Inicio**:
- `info` - Startup completo, versión, entorno, configuración cargada (masked)
- `info` - Conexión a BD exitosa
- `info` - Cron job iniciado (schedule)
- `warn` - Configuraciones faltantes (con defaults)

**Reinicio**:
- `warn` - Reinicio detectado, razón (si disponible)
- `info` - Recuperación post-reinicio

**Caída**:
- `error` - Error fatal antes de caída (si capturado)
- `error` - Uncaught exception (stack trace completo)

**Shutdown graceful**:
- `info` - Señal recibida (SIGTERM, SIGINT)
- `info` - Tareas pendientes completadas
- `info` - Conexiones cerradas

**Contexto requerido**:
```json
{
  "event": "system_startup|system_restart|system_shutdown|system_error",
  "version": "1.0.0",
  "node_version": "v18.x.x",
  "environment": "production",
  "uptime_seconds": 3600,
  "config_loaded": true
}
```

---

#### Estrategia de Transports Winston

**Transport 1: Consola (SIEMPRE en producción)**

**Configuración**:
- Formato legible para humanos (no JSON puro)
- Colores deshabilitados en producción (mejora legibilidad en `pm2 logs`)
- Nivel mínimo: `info` (configurable via env)
- Timestamp en formato legible

**Ejemplo output**:
```
[2025-01-15 10:30:45] INFO: Sincronización cron iniciada (tipo: incremental)
[2025-01-15 10:35:12] INFO: Sincronización completada - Procesados: 1000, Creados: 50, Errores: 2
[2025-01-15 10:35:13] ERROR: Error en API ASOFIX - Status: 500, Endpoint: /api/catalogs/web
```

**Ventajas**:
- ✅ Visible en `pm2 logs` inmediatamente
- ✅ Legible por humanos sin parsing
- ✅ Fácil debugging en tiempo real

---

**Transport 2: Archivo de Errores (solo `error.log`)**

**Configuración**:
- Solo nivel `error`
- Formato JSON estructurado
- Rotación diaria o por tamaño (usar `winston-daily-rotate-file`)
- Retención: 30 días

**Uso**: Análisis posterior, alertas automatizadas, métricas de errores

---

**Transport 3: Archivo de Sync (solo `sync.log`)**

**Configuración**:
- Niveles `info`, `warn`, `error` (solo eventos relacionados con sync)
- Formato JSON estructurado
- Rotación diaria
- Retención: 7 días (syncs son frecuentes)

**Uso**: Auditoría de sincronizaciones, análisis de performance, debugging

---

**Transport 4: Archivo General (opcional, `app.log`)**

**Configuración**:
- Todos los niveles excepto `debug`
- Formato JSON estructurado
- Rotación diaria
- Retención: 7 días

**Uso**: Logs completos para análisis profundo (puede ser pesado)

---

#### Integración de Morgan para Logs HTTP

**Configuración recomendada**:
- Formato: `combined` (más información) o custom
- Stream: Integrar con Winston (no `console.log`)
- Nivel: `info` para requests normales, `warn` para 4xx, `error` para 5xx
- Sanitización: No loguear passwords, tokens, datos sensibles

**Información a incluir**:
- Method, URL, Status code
- Response time (ms)
- IP origen
- User-Agent (sanitizado)
- Tamaño de request/response (si es relevante)

**Ejemplo log**:
```json
{
  "event": "http_request",
  "method": "GET",
  "url": "/autos?page=1&limit=20",
  "status_code": 200,
  "response_time_ms": 45,
  "ip": "192.168.1.1",
  "user_agent": "Mozilla/5.0..."
}
```

---

#### Uso de Tabla `sync_logs` en BD

**Propuesta**: Usar la tabla existente para persistir métricas de sincronizaciones.

**Ventajas**:
- ✅ Consultas SQL para análisis histórico
- ✅ Dashboard de métricas
- ✅ Alertas basadas en BD
- ✅ Integración con herramientas de BI

**Eventos a persistir**:
- Cada sincronización (cron, manual, inicial)
- Status: `running`, `completed`, `failed`
- Métricas: vehículos procesados, creados, actualizados, errores
- Timestamps: `started_at`, `completed_at`
- Metadata: tipo de sync, trigger, duración

**Consideraciones**:
- No reemplazar logs, complementarlos
- Persistir al finalizar sync (no durante)
- Limpiar registros antiguos (retention policy)

---

### 🎯 Recomendación Final: Stack de Observabilidad

**Configuración recomendada**:

1. **Winston con 3 transports**:
   - Consola (SIEMPRE): Formato legible, nivel `info`
   - `error.log`: JSON, solo errores, rotación diaria, 30 días
   - `sync.log`: JSON, eventos de sync, rotación diaria, 7 días

2. **Morgan integrado con Winston**:
   - Formato custom estructurado
   - Nivel dinámico según status code
   - Sanitización de datos sensibles

3. **Tabla `sync_logs`**:
   - Persistir métricas al finalizar cada sync
   - Usar para dashboard y alertas
   - No reemplazar logs de archivo

4. **Niveles por entorno**:
   - Desarrollo: `debug`
   - Producción: `info` (configurable via `LOG_LEVEL`)

5. **Estructura consistente**:
   - Siempre incluir `event`, `timestamp`, `level`
   - Contexto específico por tipo de evento
   - IDs de correlación para rastrear requests/syncs

---

## 3️⃣ ROBUSTEZ OPERATIVA

### 🧠 Detección de Fallos Silenciosos

#### Problema: Fallos que No se Detectan

**Escenarios críticos**:
1. **Cron job no ejecuta**: Si `node-cron` falla silenciosamente o el proceso se reinicia en el momento del cron
2. **Sync incompleta**: Sync se ejecuta pero falla a mitad de camino sin error fatal
3. **API externa degradada**: Respuestas lentas o parciales que no generan error
4. **BD desconectada**: Conexiones perdidas que no se detectan inmediatamente
5. **Memoria/CPU**: Degradación gradual que no genera errores

---

#### Estrategias de Detección

##### 1. Heartbeat / Health Checks

**Implementación conceptual**:
- Endpoint `/health` que verifica: BD conectada, API externa accesible, cron activo
- Verificar última ejecución de sync (no debe ser > X horas)
- Verificar estado del proceso (memoria, CPU)
- Monitoreo externo (cron job, servicio de monitoreo) que llama `/health` cada 5-10 minutos

**Métricas a exponer**:
- `status`: `healthy|degraded|unhealthy`
- `database`: `connected|disconnected`
- `last_sync`: Timestamp de última sync exitosa
- `cron_active`: Boolean
- `uptime_seconds`: Tiempo activo
- `memory_usage_mb`: Uso de memoria

---

##### 2. Validación de Syncs Horarios

**Problema**: ¿Cómo saber si el sync realmente se ejecutó?

**Solución A: Timestamp en BD**

**Implementación**:
- Guardar timestamp de última sync exitosa en tabla `sync_logs` o tabla de configuración
- En cada sync exitosa, actualizar `last_successful_sync_at`
- Health check verifica: `NOW() - last_successful_sync_at < SYNC_INTERVAL + TOLERANCE`
- Si excede, alertar

**Ventajas**:
- ✅ Simple de implementar
- ✅ Persistente (sobrevive reinicios)
- ✅ Consultable vía SQL

**Ejemplo lógica**:
```
SYNC_INTERVAL = 1 hora (3600 segundos)
TOLERANCE = 15 minutos (900 segundos)
MAX_ALLOWED = 4500 segundos (1h15m)

Si (NOW() - last_successful_sync_at) > MAX_ALLOWED:
  ALERT: "Sync no ejecutada en tiempo esperado"
```

---

**Solución B: Heartbeat durante Sync**

**Implementación**:
- Durante sync, actualizar timestamp cada N vehículos procesados (ej: cada 100)
- Campo `sync_heartbeat_at` en tabla de configuración
- Si sync está corriendo, `sync_heartbeat_at` se actualiza constantemente
- Si sync está "colgada", `sync_heartbeat_at` no se actualiza > X minutos

**Ventajas**:
- ✅ Detecta syncs colgadas (no solo syncs que no ejecutan)
- ✅ Permite monitorear progreso en tiempo real

**Desventajas**:
- ⚠️ Requiere actualización frecuente de BD
- ⚠️ Más complejo

---

**Recomendación**: Combinar ambas (Solución A + verificación de sync en ejecución)

---

##### 3. Validación de Syncs Completas

**Problema**: Sync ejecuta pero no procesa todos los vehículos esperados.

**Métricas a validar**:

1. **Cantidad de vehículos procesados**:
   - Comparar con histórico (últimas N syncs)
   - Si diferencia > 50%, alertar
   - Ejemplo: Si normalmente se procesan 1000 vehículos y ahora solo 100, algo está mal

2. **Tasa de errores**:
   - Si `errors_count / vehicles_processed > 0.10` (10%), alertar
   - Errores esperados: < 1%

3. **Duración anormal**:
   - Si sync tarda > 2x el promedio histórico, alertar
   - Puede indicar problema de red o BD

4. **Sync incompleta (por páginas)**:
   - Si sync termina antes de procesar todas las páginas esperadas, alertar
   - Comparar `pages_processed` vs `total_pages` de API

---

##### 4. Alertas ante Errores Repetidos

**Estrategia**: Circuit Breaker Pattern (simplificado)

**Implementación conceptual**:
- Contador de errores consecutivos por tipo
- Si errores consecutivos > THRESHOLD, alertar y posiblemente pausar syncs
- Reset contador después de N syncs exitosas

**Tipos de errores a rastrear**:
1. **API Externa (ASOFIX)**:
   - Threshold: 3 errores consecutivos
   - Acción: Alertar, posiblemente pausar syncs temporales
   - Reset: 1 sync exitosa

2. **Base de Datos**:
   - Threshold: 2 errores consecutivos
   - Acción: Alertar crítico, verificar conexión
   - Reset: 1 query exitosa

3. **Procesamiento de Imágenes**:
   - Threshold: 10 errores consecutivos
   - Acción: Alertar, continuar (no crítico)
   - Reset: 10 imágenes exitosas

**Persistencia**:
- Guardar en tabla `error_counts` o en memoria con persistencia opcional
- Reset automático después de tiempo (ej: 1 hora sin errores)

---

### 📊 Métricas Mínimas Recomendadas

#### 1. Métricas de Sincronización

| Métrica | Descripción | Nivel de Detalle | Por qué |
|---------|-------------|------------------|---------|
| `sync_count_total` | Total de syncs ejecutadas | Por día/semana | Tendencias, detectar syncs faltantes |
| `sync_duration_seconds` | Duración de cada sync | Por sync (promedio, p95, p99) | Detectar degradación de performance |
| `vehicles_processed` | Vehículos procesados por sync | Por sync (promedio, min, max) | Detectar syncs incompletas |
| `vehicles_created` | Vehículos nuevos creados | Por sync | Tendencias de crecimiento |
| `vehicles_updated` | Vehículos actualizados | Por sync | Actividad de la API externa |
| `vehicles_filtered` | Vehículos filtrados | Por sync, por razón | Auditoría de reglas de negocio |
| `sync_errors_count` | Errores durante sync | Por sync, por tipo | Detectar problemas sistemáticos |
| `sync_success_rate` | Tasa de éxito (completadas/total) | Por día/semana | Salud general del sistema |
| `last_successful_sync_at` | Timestamp última sync exitosa | Último valor | Detectar syncs faltantes |

---

#### 2. Métricas de API Externa (ASOFIX)

| Métrica | Descripción | Nivel de Detalle | Por qué |
|---------|-------------|------------------|---------|
| `asofix_api_requests_total` | Total de requests a ASOFIX | Por hora/día | Volumen de integración |
| `asofix_api_response_time_ms` | Tiempo de respuesta | Por request (promedio, p95, p99) | Detectar degradación |
| `asofix_api_errors_count` | Errores HTTP | Por status code, por hora | Detectar problemas de API externa |
| `asofix_api_timeouts_count` | Timeouts | Por hora | Problemas de red o API lenta |
| `asofix_api_rate_limit_hits` | Rate limits alcanzados | Por hora | Optimizar frecuencia de sync |

---

#### 3. Métricas de Base de Datos

| Métrica | Descripción | Nivel de Detalle | Por qué |
|---------|-------------|------------------|---------|
| `db_queries_total` | Total de queries ejecutadas | Por tipo (SELECT/INSERT/UPDATE), por hora | Volumen de operaciones |
| `db_query_duration_ms` | Duración de queries | Por tipo (promedio, p95, p99) | Detectar queries lentas |
| `db_errors_count` | Errores de BD | Por tipo, por hora | Problemas de conexión o datos |
| `db_connection_pool_size` | Tamaño del pool | Actual | Optimización de recursos |
| `db_connection_pool_active` | Conexiones activas | Actual | Detectar saturación |

---

#### 4. Métricas de Sistema

| Métrica | Descripción | Nivel de Detalle | Por qué |
|---------|-------------|------------------|---------|
| `system_uptime_seconds` | Tiempo activo del proceso | Actual | Detectar reinicios frecuentes |
| `system_memory_usage_mb` | Uso de memoria | Actual, promedio por hora | Detectar memory leaks |
| `system_cpu_usage_percent` | Uso de CPU | Promedio por hora | Detectar sobrecarga |
| `system_restarts_count` | Reinicios del proceso | Por día | Estabilidad del sistema |

---

#### 5. Métricas de Endpoints Públicos

| Métrica | Descripción | Nivel de Detalle | Por qué |
|---------|-------------|------------------|---------|
| `http_requests_total` | Total de requests HTTP | Por endpoint, método, status code, por hora | Volumen de tráfico |
| `http_response_time_ms` | Tiempo de respuesta | Por endpoint (promedio, p95, p99) | Performance de API pública |
| `http_errors_count` | Errores 4xx/5xx | Por endpoint, por hora | Problemas de API pública |

---

### 🎯 Estrategia de Monitoreo Recomendada

#### Nivel 1: Logs Estructurados (Ya cubierto en sección 2)

- Logs con contexto suficiente para extraer métricas
- Formato JSON para parsing automatizado
- Niveles apropiados para filtrar

---

#### Nivel 2: Tabla `sync_logs` (Persistencia)

- Persistir métricas clave de cada sync
- Consultable vía SQL
- Base para dashboard simple

**Estructura sugerida (usar tabla existente)**:
- Campos ya existen: `sync_type`, `status`, `vehicles_processed`, `vehicles_created`, `vehicles_updated`, `errors_count`, `started_at`, `completed_at`
- Agregar campos opcionales: `duration_seconds`, `pages_processed`, `metadata` (JSON para flexibilidad)

---

#### Nivel 3: Health Check Endpoint Mejorado

**Endpoint**: `GET /health`

**Respuesta sugerida**:
```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2025-01-15T10:30:00Z",
  "uptime_seconds": 3600,
  "services": {
    "database": {
      "status": "connected",
      "response_time_ms": 5
    },
    "asofix_api": {
      "status": "reachable",
      "last_check_ms": 120
    },
    "cron_job": {
      "status": "active",
      "next_run_at": "2025-01-15T11:00:00Z",
      "last_run_at": "2025-01-15T10:00:00Z"
    }
  },
  "sync": {
    "last_successful_at": "2025-01-15T10:00:00Z",
    "last_successful_duration_seconds": 300,
    "status": "on_schedule|overdue|running"
  },
  "system": {
    "memory_usage_mb": 150,
    "cpu_usage_percent": 25
  }
}
```

---

#### Nivel 4: Alertas Proactivas (Futuro)

**Implementación sugerida**:
- Script externo que llama `/health` cada 5-10 minutos
- Si `status !== "healthy"`, enviar alerta (email, Slack, etc.)
- Si `sync.status === "overdue"`, alerta crítica
- Si `sync.errors_count > threshold`, alerta

**Herramientas sugeridas**:
- Cron job simple con `curl` + script de shell
- Servicios de monitoreo: UptimeRobot, Pingdom (gratuitos para empezar)
- Integración con Slack/Email para alertas

---

### 🎯 Recomendación Final: Robustez Operativa

**Implementación priorizada**:

1. **Corto plazo (Crítico)**:
   - ✅ Health check endpoint mejorado con validación de última sync
   - ✅ Persistir métricas en tabla `sync_logs` al finalizar cada sync
   - ✅ Logs estructurados con contexto suficiente (ya cubierto)

2. **Medio plazo (Importante)**:
   - ✅ Validación de syncs completas (comparar con histórico)
   - ✅ Alertas básicas (script externo que verifica `/health`)
   - ✅ Métricas de errores repetidos (contador en memoria o BD)

3. **Largo plazo (Deseable)**:
   - ✅ Dashboard de métricas (usando datos de `sync_logs`)
   - ✅ Circuit breaker para API externa
   - ✅ Monitoreo avanzado (Prometheus, Grafana, etc.)

---

## 📋 PRIORIZACIÓN DE MEJORAS

### Fase 1: Crítico (Implementar Primero)

1. **Filtrado de Dakota usando `location_name`** (Opción C - Híbrido)
   - Impacto: Regla de negocio crítica
   - Esfuerzo: Medio (2-3 horas)
   - Riesgo: Bajo (cambio localizado)

2. **Logs visibles en `pm2 logs`** (Transport de consola)
   - Impacto: Debugging inmediato en producción
   - Esfuerzo: Bajo (1 hora)
   - Riesgo: Muy bajo

3. **Health check con validación de syncs**
   - Impacto: Detectar problemas proactivamente
   - Esfuerzo: Medio (2-3 horas)
   - Riesgo: Bajo

---

### Fase 2: Importante (Siguiente Sprint)

4. **Logs estructurados con niveles apropiados**
   - Impacto: Mejor observabilidad
   - Esfuerzo: Medio (3-4 horas)
   - Riesgo: Bajo

5. **Morgan para logs HTTP**
   - Impacto: Debugging de requests
   - Esfuerzo: Bajo (1-2 horas)
   - Riesgo: Muy bajo

6. **Persistir métricas en `sync_logs`**
   - Impacto: Análisis histórico
   - Esfuerzo: Medio (2-3 horas)
   - Riesgo: Bajo

---

### Fase 3: Deseable (Backlog)

7. **Validación de syncs completas (comparación histórica)**
8. **Alertas automatizadas (script externo)**
9. **Métricas de errores repetidos (circuit breaker)**
10. **Dashboard de métricas**

---

## ✅ CONCLUSIÓN

Esta auditoría identifica mejoras críticas en tres áreas:

1. **Filtrado**: Estrategia híbrida (sync-time + query-time) para máxima performance y flexibilidad
2. **Observabilidad**: Stack completo de logging estructurado con múltiples transports
3. **Robustez**: Health checks, validaciones y métricas para detectar problemas proactivamente

**Próximos pasos**: Implementar Fase 1 (crítico) antes de continuar con mejoras adicionales.

---

**Documento generado**: 2025-01-XX  
**Autor**: Auditoría Técnica  
**Versión**: 1.0

