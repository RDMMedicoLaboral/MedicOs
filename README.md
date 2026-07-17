# MedicOs — Plataforma multi-consultorio (SaaS) para varios médicos

MVP funcional de una plataforma que **varios médicos independientes,
que ni se conocen entre sí, pueden usar al mismo tiempo sin ver los datos
del otro**. Cada consultorio (clínica) tiene sus propios pacientes, citas,
expedientes, recetas, secretarias y configuración — completamente
aislados de los demás a nivel de base de datos, no solo de pantalla.

Módulos incluidos:

- **Agenda**: gestión de pacientes, creación de citas y flujo de estatus
  en tiempo real (Programada → Confirmada → En sala de espera → En
  consulta → Finalizada, con salidas a Cancelada / No asistió).
- **Expediente Clínico**: nota de evolución formato **SOAP**, IMC
  automático, buscador de diagnóstico tipo CIE-11.
- **Receta Electrónica**: buscador de medicamentos, **PDF con código QR**
  de validación.
- **Login y roles**: **Médico** (acceso total a su clínica) y
  **Secretaria** (solo agenda y contacto de su clínica; el backend le
  bloquea con 403 todo lo clínico).
- **Recordatorios automáticos** (WhatsApp/SMS vía Twilio, o modo
  simulado): confirma o cancela la cita sola cuando el paciente responde.
- **Multi-consultorio (multi-tenant)**: tú, como dueño de la plataforma,
  das de alta cada consultorio nuevo desde una página de administración
  (`/admin.html`) — no hay registro público. Cada médico solo ve lo suyo.


## Estructura

```
ece-agenda/
  backend/    API REST (Node.js + Express + SQLite + JWT + pdfkit + qrcode + twilio)
  frontend/   Interfaz web (React + Vite)
```

## Cómo correrlo

**0. Define tu clave de administrador** (una sola vez). En la terminal del
backend, antes de `npm run dev`, corre:
```bash
export ADMIN_SECRET="elige-una-clave-larga-y-dificil-de-adivinar"
```
(en Codespaces tienes que ponerlo en cada terminal nueva que abras del
backend, o agregarlo a un archivo `.env` — ver más abajo). Esta clave es
tuya, del dueño de la plataforma — no se la das a los médicos.

**1. Backend**
```bash
cd backend
npm install
npm run dev        # http://localhost:4000
```

**2. Frontend** (en otra terminal)
```bash
cd frontend
npm install
npm run dev         # http://localhost:5173
```

**3. Da de alta el primer consultorio.** Abre
`http://localhost:5173/admin.html` (nota: es `/admin.html`, no la app
normal). Ahí metes la `ADMIN_SECRET` que definiste en el paso 0, y llenas
el formulario: nombre del consultorio, nombre del médico, usuario y
contraseña. Esos son los datos que le compartes al médico para que entre
a `http://localhost:5173` (la app normal) con su usuario y contraseña.

Repite el paso 3 cada vez que quieras dar de alta a un médico nuevo —
cada uno queda completamente aislado de los demás.

**Dentro de la app normal**, cada médico puede entrar a "Gestionar
usuarios" para crear cuentas de Secretaria (solo para su propia clínica),
"Perfil del médico" para los datos de su receta, y "Recordatorios" para
activar los avisos automáticos — todo eso ya sin necesitar tu ayuda.

### Guardar la ADMIN_SECRET permanentemente en Codespaces (opcional)

Para no tener que escribir el `export` cada vez que abres una terminal
nueva, crea un archivo `backend/.env` con:
```
ADMIN_SECRET=elige-una-clave-larga-y-dificil-de-adivinar
```
y agrega `dotenv/config` al inicio de `backend/src/server.js`
(`import "dotenv/config";`) después de instalar `npm install dotenv` en
`backend/`. (No es obligatorio para el MVP — el `export` manual funciona
igual de bien mientras estés probando.)

## Cómo probar los recordatorios SIN contratar nada

Por defecto el proveedor es **"Simulado"**: no manda ningún WhatsApp/SMS
real, solo lo registra en la consola del backend (`[recordatorio SIMULADO
-> tel] mensaje`) y en el historial de la cita ("✓ Recordatorio enviado").
Sirve para probar todo el flujo de la interfaz. Para probar la respuesta
automática del paciente (1 = confirmar, 2 = cancelar) sin un teléfono
real, simula la llamada que haría el paciente con curl:

```bash
curl -X POST http://localhost:4000/api/reminders/webhook \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+521XXXXXXXXXX&Body=1"
```
(usa el mismo teléfono que le pusiste al paciente). Verás la cita cambiar
a "Confirmada" en la agenda.

## Cómo conectar WhatsApp/SMS de verdad (Twilio)

1. Crea una cuenta en [twilio.com](https://www.twilio.com) y activa el
   **WhatsApp Sandbox** (para pruebas) o un número real (para producción).
2. En "Recordatorios" en la app, cambia el proveedor a "WhatsApp vía
   Twilio" (o SMS) y pega tu Account SID, Auth Token y número de Twilio.
3. En la consola de Twilio, configura el webhook de mensajes entrantes
   apuntando a `https://<tu-dominio-publico>/api/reminders/webhook`.
   **Importante**: mientras trabajes en Codespaces, esa URL cambia cada
   vez que recreas el Codespace, así que para producción necesitas un
   dominio estable (ver sección de despliegue en los siguientes pasos).

## Decisiones técnicas del MVP

- **El "cron" de recordatorios vive dentro del proceso del backend**
  (`setInterval` cada 15 min). Limitación: solo funciona mientras el
  servidor esté corriendo. En producción conviene un worker/cron aparte
  (o un servicio como GitHub Actions / cron gestionado) para que corra
  aunque el servidor se reinicie.
- **JWT sin refresco**: el token dura 12 horas.
- **Contraseñas con bcrypt** (`bcryptjs`, sin dependencias nativas).
- **SQLite en vez de PostgreSQL**: mismo modelo relacional recomendado en
  el documento, sin necesitar un servidor de base de datos aparte para el
  MVP. El esquema evita funciones específicas de SQLite para que migrar a
  Postgres sea casi un copy-paste de los `CREATE TABLE`.
- **Buscador de diagnóstico (CIE-11)** y **vademécum de medicamentos**:
  catálogos LOCALES de ejemplo, no oficiales ni exhaustivos (documentado
  en el código y en la sección de siguientes pasos).
- **QR de validación de recetas**: apunta a `/api/verify/:token`, público,
  resuelve contra `localhost` — para producción necesita un dominio
  público estable.
- **Bitácora de auditoría** (`audit_log`): registra usuario real, acción,
  entidad y momento.
- **Sin cifrado en reposo todavía**: SQLite no cifra por defecto.

## Desplegar en internet (gratis, sin instalar nada)

Codespaces es genial para desarrollar, pero su URL cambia cada vez que
recreas el Codespace — no sirve para dejar la app corriendo de forma
permanente (ni para que el webhook de Twilio o el QR de las recetas
funcionen siempre). Para eso, despliega en **Render** (plan gratuito,
todo desde el navegador):

1. Ve a [render.com](https://render.com) y entra con tu cuenta de GitHub.
2. Clic en **"New +" → "Web Service"**.
3. Conecta tu repositorio de GitHub (el mismo de Codespaces).
4. En el formulario de configuración, llena:
   - **Build Command**: `cd frontend && npm install && npm run build && cd ../backend && npm install`
   - **Start Command**: `cd backend && npm start`
   - **Instance Type**: Free
5. Antes de crear, abre la sección **"Advanced"** y agrega estas variables
   de entorno:
   - `NODE_ENV` = `production`
   - `ADMIN_SECRET` = (una clave larga que tú inventes — la usarás en `/admin.html` para dar de alta consultorios)
   - (`JWT_SECRET` es opcional — si no la pones, el backend genera una
     sola vez y punto)
6. Clic en **"Create Web Service"**. Espera unos minutos mientras
   instala y compila (verás los logs en vivo, parecido a la terminal de
   Codespaces).
7. Cuando termine, Render te da una URL pública fija, tipo
   `https://ece-agenda.onrender.com`. Ve primero a
   `https://ece-agenda.onrender.com/admin.html` para dar de alta el primer
   consultorio (usando la `ADMIN_SECRET` que pusiste en el paso 5); con
   esas credenciales, el médico ya puede entrar a la URL normal.

**⚠️ Importante sobre el plan gratis — léelo antes de cargar pacientes
reales:** en el plan gratis, el archivo de la base de datos (SQLite) vive
en el disco del servicio, que Render **borra cada vez que hay un nuevo
despliegue** (o sea, cada vez que actualizas el código con un git push).
Sobrevive mientras no vuelvas a desplegar — incluyendo cuando el servicio
"se duerme" tras ~15 min sin uso y despierta solo con la siguiente
visita, eso sí es normal y no borra nada. Pero para tener una base de
datos que **nunca** se borre (necesario para usarlo con pacientes de
verdad), el siguiente paso es conectar una base de datos Postgres real
(Render también la ofrece gratis) — ver "Siguientes pasos" abajo.

Una vez desplegado ahí, esa es la URL que le das a Twilio como webhook
(`https://tu-app.onrender.com/api/reminders/webhook`) y la que queda
codificada en el QR de las recetas — a diferencia de Codespaces, no
cambia.

## Siguientes pasos sugeridos

1. **Migrar de SQLite a PostgreSQL** (Render ofrece una base Postgres
   gratis) — esto es lo que resuelve de raíz la limitación de
   persistencia del plan gratis descrita arriba.
2. Conectar el buscador de diagnóstico a la API oficial de la OMS (ICD-11)
   y el vademécum a un catálogo de medicamentos vigente.
3. Mover el envío de recordatorios a un worker/cron independiente del
   proceso web (para que no dependa de que el servicio esté "despierto").
4. Firma digital real del médico en la receta.




