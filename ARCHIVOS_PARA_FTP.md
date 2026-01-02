# 📦 Archivos para Subir por FTP

## ✅ Archivos y Carpetas a SUBIR

```
backend/
├── src/                          ✅ SUBIR TODO
│   ├── config/
│   │   ├── database.ts
│   │   └── filters.ts
│   ├── controllers/
│   │   ├── sync.controller.ts
│   │   └── vehicles.controller.ts
│   ├── jobs/
│   │   └── sync-cron.ts
│   ├── routes/
│   │   ├── sync.routes.ts
│   │   └── vehicles.routes.ts
│   ├── scripts/
│   │   └── sync-inicial.ts
│   ├── services/
│   │   ├── asofix-api.ts
│   │   ├── logger.ts
│   │   ├── sync-service.ts
│   │   └── vehicle-filters.ts
│   └── index.ts
├── database/                     ✅ SUBIR TODO
│   └── final_schema.sql
├── ecosystem.config.js           ✅ SUBIR
├── package.json                  ✅ SUBIR
├── tsconfig.json                 ✅ SUBIR
├── .gitignore                    ✅ SUBIR (opcional)
└── DEPLOYMENT.md                 ✅ SUBIR (guía de despliegue)
```

## ❌ Archivos y Carpetas a NO SUBIR

```
backend/
├── node_modules/                 ❌ NO SUBIR (instalar con npm install)
├── uploads/                      ❌ NO SUBIR (se creará en /opt/caradvice-media)
├── dist/                         ❌ NO SUBIR (se generará con npm run build)
├── logs/                         ❌ NO SUBIR (se creará automáticamente)
├── .env                          ❌ NO SUBIR (crear en el servidor)
├── .env.*                        ❌ NO SUBIR (archivos de entorno)
├── package-lock.json             ❌ NO SUBIR (se regenerará)
└── *.log                         ❌ NO SUBIR (archivos de log)
```

## 📝 Notas

1. **node_modules/**: Se instala en el servidor con `npm install --production`
2. **dist/**: Se genera en el servidor con `npm run build`
3. **.env**: Se crea manualmente en el servidor con las credenciales reales
4. **uploads/**: Los medios se almacenan en `/opt/caradvice-media` (no en el proyecto)

## 🚀 Proceso de Subida

1. Conectar por FTP al servidor
2. Navegar a `/opt/caradvice-api/backend/`
3. Subir solo los archivos marcados con ✅
4. En el servidor, ejecutar:
   ```bash
   cd /opt/caradvice-api/backend
   npm install --production
   npm run build
   ```

