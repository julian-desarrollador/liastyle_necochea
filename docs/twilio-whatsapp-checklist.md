# Twilio WhatsApp — checklist de producción

Este flujo envía recordatorios del día siguiente por WhatsApp:
`recordatorio_turno_lia_nuevas_clientas` a clientas no VIP y
`recordatorio_turno_vip_lia` a clientas VIP. Las respuestas `Confirmar` y
`Cancelar` llegan al webhook de Lia Style.

## 1. Variables en Vercel (Production)

Configurar estos valores en **Project Settings → Environment Variables → Production**:

- `TWILIO_ACCOUNT_SID`: Account SID Live (`AC...`).
- `TWILIO_AUTH_TOKEN`: Auth Token Live de la misma cuenta.
- `TWILIO_WHATSAPP_FROM`: sender aprobado, por ejemplo `whatsapp:+54...`.
- `TWILIO_REMINDER_NEW_CONTENT_SID`: Content SID (`HX...`) de
  `recordatorio_turno_lia_nuevas_clientas`.
- `TWILIO_REMINDER_VIP_CONTENT_SID`: Content SID (`HX...`) de
  `recordatorio_turno_vip_lia`.
- `TWILIO_WEBHOOK_PUBLIC_URL`: URL completa y exacta, por ejemplo
  `https://DOMINIO/api/webhooks/twilio/whatsapp`.
- `APP_BASE_URL`: dominio público sin barra final, por ejemplo `https://DOMINIO`.
- `CRON_SECRET`: secreto usado por Vercel para autorizar los cron.

El código también admite `TWILIO_MESSAGING_SERVICE_SID`, pero el despliegue normal usa
`TWILIO_WHATSAPP_FROM`.

No configurar `TWILIO_WEBHOOK_SKIP_VERIFY` en producción. Aunque tenga el valor `true`,
el código solo permite omitir la firma fuera de producción.

Después de cargar o cambiar variables, volver a desplegar Production.

## 2. Webhook inbound en Twilio

En la configuración del sender de WhatsApp:

1. Buscar el campo **When a message comes in**.
2. Elegir método **POST**.
3. Pegar exactamente la misma URL configurada en `TWILIO_WEBHOOK_PUBLIC_URL`.
4. Guardar.

Twilio firma cada request con `x-twilio-signature`. La URL debe coincidir exactamente
con la pública, incluyendo `https`, dominio y path.

## 3. Cron

`vercel.json` ejecuta `/api/cron/daily-reminders` todos los días a las `13:00 UTC`
(`10:00` de Argentina). Busca turnos del día siguiente que:

- estén confirmados;
- tengan pago aprobado o no requieran pago;
- hayan aceptado WhatsApp;
- no tengan un recordatorio previo;
- correspondan a una clienta no VIP (plantilla nuevas) o VIP (plantilla VIP).

La marca `waReminder24hSentAt` se reclama antes del envío y se revierte si Twilio falla.

## 4. Diagnóstico

Con el deploy terminado, consultar:

```text
GET https://DOMINIO/api/cron/twilio-health
Authorization: Bearer CRON_SECRET
```

Debe responder `ok: true` y:

- `hasAccountSid: true`
- `hasAuthToken: true`
- `hasFrom: true`
- `hasNewClientContentSid: true`
- `hasVipContentSid: true`
- `hasWebhookPublicUrl: true`
- `hasAppBaseUrl: true`
- al menos un sender visible y online

Los SID y números se muestran enmascarados.

## 5. Prueba real

1. Crear un turno confirmado para mañana con un teléfono de prueba no VIP y opt-in.
2. Ejecutar el cron una vez con `Authorization: Bearer CRON_SECRET`.
3. Verificar en el panel: `Recordatorio 24h: Enviado`.
4. Tocar **Confirmar**: debe aparecer `Asistencia: Confirmó`.
5. Probar **Cancelar** con un turno a más de 24 h: debe cancelar el turno.
6. Probar **Cancelar** con menos de 24 h: debe conservarlo y responder con la política.
7. Reprogramar un turno: debe limpiar recordatorio y asistencia para permitir un envío nuevo.
8. Probar una clienta VIP (manual o ≥10 visitas): el JSON del cron debe incluir `sentVip` ≥ 1
   y el mensaje debe ser la plantilla VIP.

Solo los quick replies con IDs exactos `confirmar` y `cancelar`, asociados al SID del
recordatorio vigente, pueden modificar un turno. Escribir esas palabras como texto libre
no confirma ni cancela.
