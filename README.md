# Agenda + Expediente + Receta + Login/Roles + Recordatorios — MVP (Módulos 1-5)

MVP funcional de cinco módulos de la radiografía del ECE:

- **Módulo 1 — Agenda**: gestión de pacientes, creación de citas y flujo de
  estatus en tiempo real (Programada → Confirmada → En sala de espera →
  En consulta → Finalizada, con salidas a Cancelada / No asistió).
- **Módulo 2 — Expediente Clínico**: al dar clic en "Iniciar consulta" se
  abre la ficha del paciente con su historial cronológico a la izquierda y
  una nota de evolución nueva (formato **SOAP**) a la derecha, con IMC
  calculado automáticamente y buscador de diagnóstico tipo CIE-11.
- **Módulo 3 — Receta Electrónica**: buscador de medicamentos (vademécum),
  dosis/frecuencia/duración, **PDF descargable con código QR** de
  validación, y endpoint público para verificar la autenticidad de una
  receta escaneando el QR.
- **Login y roles**: cuentas de **Médico** (acceso total) y **Secretaria**
  (solo agenda y contacto; el backend le oculta y bloquea con 403 todo lo
  clínico).
- **Módulo — Recordatorios automáticos (WhatsApp/SMS)**: desde "Recordatorios"
  en la barra lateral (solo médico) se configura la plantilla del mensaje y
  las horas de anticipación. El sistema revisa cada 15 minutos qué citas
  entran en la ventana y envía el recordatorio; si el paciente responde
  **1** su cita se confirma sola, si responde **2** se cancela sola —
  exactamente el flujo descrito en el documento original. También hay un
  botón "Enviar recordatorio" manual en cada cita, para probar sin esperar.

No incluye todavía: migración a PostgreSQL ni despliegue fuera de
Codespaces — son los siguientes pasos naturales sobre esta base.

## Estructura

```
ece-agenda/
  backend/    API REST (Node.js + Express + SQLite + JWT + pdfkit + qrcode + twilio)
  frontend/   Interfaz web (React + Vite)
```

## Cómo correrlo

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

**Primer uso**: pantalla de configuración para crear la cuenta de Médico,
luego (opcional) "Gestionar usuarios" para crear Secretarias, "Perfil del
médico" para los datos de la receta, y "Recordatorios" para activar los
avisos automáticos.

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
funcionen siempre). Para eso, despliega en **Render** (tiene plan
gratuito, y todo se hace desde el navegador, sin instalar nada en tu
laptop):

1. Ve a [render.com](https://render.com) y crea una cuenta (puedes
   entrar directo con tu cuenta de GitHub).
2. En el dashboard, clic en **"New +" → "Blueprint"**.
3. Conecta tu repositorio de GitHub (el mismo que usas en Codespaces,
   `ConsultorioMedico` o como lo hayas llamado).
4. Render va a detectar el archivo `render.yaml` de este proyecto y te va
   a mostrar el servicio `ece-agenda` listo para crear, con un disco
   persistente de 1 GB para la base de datos. Clic en **"Apply"**.
5. Espera unos minutos mientras Render instala y compila todo (lo
   verás en los logs, similar a lo que ves en la terminal de Codespaces).
6. Cuando termine, Render te da una URL pública fija, tipo
   `https://ece-agenda.onrender.com` — ábrela y verás la misma pantalla de
   "Configura la primera cuenta" que viste en Codespaces.

**Nota sobre el plan gratis de Render**: el servicio "se duerme" tras
~15 minutos sin uso y tarda unos segundos en despertar con la primera
visita — normal en el plan gratis, no es un error. Para un consultorio en
producción real conviene un plan de pago que no se duerma (así los
recordatorios de las 15 en 15 minutos y el webhook de Twilio funcionan
siempre).

Una vez desplegado ahí, esa es la URL que le das a Twilio como webhook
(`https://tu-app.onrender.com/api/reminders/webhook`) y la que queda
codificada en el QR de las recetas — a diferencia de Codespaces, no
cambia.

## Siguientes pasos sugeridos

1. Migrar de SQLite a PostgreSQL (Render también ofrece bases de datos
   Postgres gestionadas gratis, si prefieres no depender del disco).
2. Conectar el buscador de diagnóstico a la API oficial de la OMS (ICD-11)
   y el vademécum a un catálogo de medicamentos vigente.
3. Mover el envío de recordatorios a un worker/cron independiente del
   proceso web (para que no dependa de que el servicio esté "despierto").
4. Firma digital real del médico en la receta.




