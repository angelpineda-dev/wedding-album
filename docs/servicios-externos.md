# Configuración de servicios externos

Qué falta configurar fuera del código para correr la API en local y en producción, y cómo probarla con la colección de Postman.

```
/Users/angel/Code/wedding-album/api/
├── .env                      ← tus valores (no se versiona)
├── .env.example              ← plantilla (copiar el bloque de la sección 1)
├── docker-compose.yml        ← Postgres + MinIO locales
├── docs/servicios-externos.md
└── postman/
    ├── collections/Wedding Album API/   ← colección v3 (YAML)
    └── environments/Local.environment.yaml
```

## 1. Variables de entorno

La API valida todo al arrancar (`src/config/env.ts`) y se detiene indicando qué falta. Este bloque sirve como `.env.example`, y como punto de partida de tu `.env` local:

```dotenv
# ── Servidor ────────────────────────────────────────────
NODE_ENV=development
PORT=3000
# Número de proxies delante de la API (0 en local; 1 detrás de un load balancer). Necesario para IPs reales en rate limit.
TRUST_PROXY=0

# ── Base de datos ───────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/wedding_album

# ── Auth ────────────────────────────────────────────────
# Mínimo 32 caracteres. Genera uno con: openssl rand -base64 48
JWT_ACCESS_SECRET=
JWT_ISSUER=wedding-album-api
JWT_AUDIENCE=wedding-album-app
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=7
# Por defecto true en producción. Ponlo en false solo si pruebas cookies sobre http.
# COOKIE_SECURE=
BCRYPT_COST=12
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
AUTH_RATE_LIMIT_WINDOW_MINUTES=15
AUTH_RATE_LIMIT_MAX=20

# ── Frontend ────────────────────────────────────────────
# Orígenes del navegador que pueden llamar a la API con cookies (separados por coma).
CORS_ORIGINS=http://localhost:5173
# Base del frontend: magic link → /auth/magic?token=…   QR → /e/<código>
APP_PUBLIC_URL=http://localhost:5173
MAGIC_LINK_TTL_MINUTES=15

# ── Primer superadmin (npm run seed:superadmin) ────────
SUPERADMIN_EMAIL=
SUPERADMIN_NAME=
SUPERADMIN_LAST_NAME=
SUPERADMIN_PASSWORD=

# ── Almacenamiento de fotos y videos (S3 compatible) ───
# Vacío = AWS S3. MinIO local: http://localhost:9000. R2: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=wedding-album-media
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
# true para MinIO y R2; false para AWS S3.
S3_FORCE_PATH_STYLE=true
UPLOAD_URL_TTL_SECONDS=600
DOWNLOAD_URL_TTL_SECONDS=3600
UPLOAD_RATE_LIMIT_WINDOW_MINUTES=10
UPLOAD_RATE_LIMIT_MAX=60

# ── Endpoints públicos (QR), por IP ─────────────────────
PUBLIC_RATE_LIMIT_WINDOW_MINUTES=1
PUBLIC_RATE_LIMIT_MAX=120

# ── Limpieza (subidas abandonadas, links y sesiones vencidas) ──
# 0 = desactivada (usa `npm run cleanup` desde un cron).
CLEANUP_INTERVAL_MINUTES=60
```

En el `.env.example` versionado deja vacíos `JWT_ACCESS_SECRET`, `SUPERADMIN_PASSWORD` y las claves `S3_*` de producción.

## 2. Arranque local

```bash
npm run db:up
```

```bash
npm run db:migrate
```

```bash
npm run storage:init
```

```bash
npm run seed:superadmin
```

```bash
npm run dev
```

Los magic links aparecen en la consola del servidor (`[mail] Magic link for …`) porque aún no hay proveedor de correo (sección 5).

## 3. PostgreSQL en producción

Cualquier Postgres administrado (Neon, Supabase, RDS, Cloud SQL, Railway…).

1. Crea la base de datos y un usuario solo para la API.
2. `DATABASE_URL=postgresql://usuario:contraseña@host:5432/wedding_album?sslmode=require`
3. En cada despliegue, antes de arrancar: `npm run db:migrate`.
4. Una sola vez: `npm run seed:superadmin` con `SUPERADMIN_*` definidos. Pasa la contraseña por variable de entorno, no con `--password`, que queda en el historial de la terminal.

## 4. Almacenamiento de fotos y videos

El navegador o la app suben el archivo **directo al bucket** con una URL prefirmada (`PUT`); la API nunca recibe el binario. El bucket es **privado**: las fotos se ven con URLs firmadas que caducan en 1 h.

### Opción recomendada: Cloudflare R2

No cobra transferencia de salida, lo que importa en una galería que se ve muchas veces.

1. Cloudflare → R2 → **Create bucket** (p. ej. `wedding-album-media`). Déjalo sin acceso público.
2. R2 → **Manage API tokens** → crear token con permiso **Object Read & Write** limitado a ese bucket. Copia el *Access Key ID* y el *Secret Access Key*: el secreto solo se muestra una vez.
3. Variables:
   ```dotenv
   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=wedding-album-media
   S3_ACCESS_KEY_ID=<access key id>
   S3_SECRET_ACCESS_KEY=<secret>
   S3_FORCE_PATH_STYLE=true
   ```
4. Bucket → Settings → **CORS policy** (sin esto el navegador bloquea el `PUT`):
   ```json
   [
     {
       "AllowedOrigins": ["https://tu-frontend.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Pon los mismos orígenes que en `CORS_ORIGINS`. Una app móvil nativa no necesita CORS; solo el navegador.

### Alternativa: AWS S3

1. Crea el bucket con **Block Public Access** activado.
2. Crea un usuario o rol IAM con esta política. `s3:ListBucket` es necesario: sin él S3 responde 403 en lugar de 404 al consultar un archivo que no existe, y "completar subida" fallaría con 500 en vez de 409.
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::wedding-album-media/events/*"
       },
       {
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::wedding-album-media"
       }
     ]
   }
   ```
3. Variables: `S3_ENDPOINT` vacío, `S3_REGION=<región del bucket>`, `S3_FORCE_PATH_STYLE=false` y las claves del usuario. Con un rol de la plataforma (ECS, Lambda) habría que cambiar el código para no exigir claves.
4. Bucket → Permissions → **CORS**: el mismo JSON que en R2.

### Límites que aplica la API

Fotos: jpeg, png, webp, heic/heif, hasta 25 MB. Videos: mp4, mov, webm, hasta 200 MB. Cambiarlos es editar `src/core/const/media.ts`.

## 5. Correo (magic links) — **pendiente de implementar**

Hoy `src/services/mailService.ts` solo escribe el enlace en la consola fuera de producción. En producción **no se envía nada**, así que los clientes no pueden entrar. Antes de salir a producción:

1. Elige un proveedor transaccional: Resend, Postmark o AWS SES. Cualquiera sirve para este volumen.
2. Verifica tu dominio de envío en el proveedor: añade los registros DNS que te indique (SPF, DKIM y, recomendado, DMARC). Sin esto los correos caen en spam.
3. Crea una API key con permiso solo de envío.
4. Añade al `.env` las variables del proveedor. Por ejemplo:
   ```dotenv
   MAIL_FROM="Álbum de bodas <no-reply@tu-dominio.com>"
   MAIL_API_KEY=
   ```
5. Implementa el envío en `mailService.sendMagicLink(to, url)`. Es la única función que hay que cambiar; añade las variables en `src/config/env.ts`. Los tests ya la sustituyen con un mock, así que no se ven afectados.

## 6. Frontend y dominio

- `APP_PUBLIC_URL` es la URL pública del frontend. Debe tener dos rutas:
  - `/auth/magic?token=…`: lee el `token` y llama a `POST /api/auth/magic-link/verify`.
  - `/e/<código>`: la galería del QR; llama a `GET /api/public/events/<código>/gallery`.
- `CORS_ORIGINS` debe incluir el dominio del frontend (con esquema, sin barra final).
- En producción sirve la API por **HTTPS**; la cookie del refresh token es `Secure`.
- Detrás de un proxy o load balancer pon `TRUST_PROXY=1` (o el número de saltos) para que el rate limit vea la IP real.

## 7. Tarea de limpieza

Con una sola instancia basta el valor por defecto (`CLEANUP_INTERVAL_MINUTES=60`). Con varias instancias o serverless, pon `CLEANUP_INTERVAL_MINUTES=0` y programa un cron cada hora que ejecute:

```bash
npm run cleanup
```

## 8. Probar con Postman

La colección está en `postman/collections/Wedding Album API/` (formato v3 de Postman, YAML por petición) con el entorno `postman/environments/Local.environment.yaml`. Las carpetas van en orden (00 → 08) y cada paso guarda en el entorno lo que usa el siguiente.

**Desde la terminal (Postman CLI):**

1. Arranca la API (sección 2) con el superadmin creado.
2. Primera ejecución, hasta registrar al cliente:
   ```bash
   postman collection run "postman/collections/Wedding Album API" -e postman/environments/Local.environment.yaml --env-var adminPassword=<tu contraseña> -i "00 Health" -i "01 Auth/Login superadmin" -i "01 Auth/Registrar cliente"
   ```
3. Copia el `token=` del magic link que imprimió el servidor y ejecuta todo:
   ```bash
   postman collection run "postman/collections/Wedding Album API" -e postman/environments/Local.environment.yaml --env-var adminPassword=<tu contraseña> --env-var magicToken=<token>
   ```

**Desde la app de Postman:** abre la carpeta del repo como workspace local (Git) o importa la colección, selecciona el entorno **Local**, rellena `adminPassword`, y ejecuta las peticiones en orden. Tras "Registrar cliente" pega el token del magic link en `magicToken`.

Notas:
- La carpeta **08 Cierre** suspende el evento y cierra las sesiones del cliente; va al final a propósito.
- **"2 - Subir archivo"** sube un texto de prueba. Para una foto real usa body *binary* y pon en "1 - Pedir URL de subida" el `sizeBytes` exacto del archivo: el tamaño va firmado y el bucket rechaza otro.
- **Re-ejecución:** "Registrar cliente" acepta 409 (ya existe). "Crear evento" falla con 409 cuando el cliente agota su cuota (2 eventos en la colección); para volver a empezar, resetea la base de datos o sube la cuota con "Actualizar cliente".
