# Twilio WhatsApp — checklist de producción

Este flujo envía recordatorios por WhatsApp:
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

## 3. Cuándo se envía

`vercel.json` ejecuta `/api/cron/daily-reminders` todos los días a las `13:00 UTC`
(`10:00` de Argentina). El lote cubre turnos **de mañana** y **de hoy** que todavía
empiecen en más de 90 minutos, si:

- están confirmados;
- tienen pago aprobado o no requieren pago;
- aceptaron WhatsApp;
- no tienen un recordatorio previo.

Además, al **crear o confirmar** un turno de hoy/mañana (panel, app sin seña, o pago
aprobado) se intenta el envío en ese momento. Si Analia carga el turno después de las
10:00, no hay que esperar al cron del día siguiente.

En la agenda hay **Enviar recordatorio** para un turno suelto que siga en esa ventana
(útil para recuperar los que se cargaron tarde).

La marca `waReminder24hSentAt` se reclama antes del envío y se revierte si Twilio falla
con un 4xx definitivo.

Plantilla: no VIP o VIP según la ficha.

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

1. Crear un turno confirmado para **mañana** (o para hoy, a más de 90 min) con un teléfono
   de prueba no VIP y opt-in: el panel debe pasar a `Recordatorio 24h: Enviado` sin esperar
   al cron de las 10:00.
2. Crear un turno para dentro de varios días: no debe enviarse hasta el día anterior a las 10:00
   (o hasta pulsar **Enviar recordatorio** si ya está en la ventana).
3. Ejecutar el cron con `Authorization: Bearer CRON_SECRET` y revisar `candidates` / `sent`.
4. Tocar **Confirmar**: debe aparecer `Asistencia: Confirmó`.
5. Probar **Cancelar** con un turno a más de 24 h: debe cancelar el turno.
6. Probar **Cancelar** con menos de 24 h: debe conservarlo y responder con la política.
7. Reprogramar un turno hacia hoy/mañana: debe limpiar el recordatorio anterior y, si aplica,
   enviar uno nuevo.
8. Probar una clienta VIP (manual o ≥10 visitas): el JSON debe incluir `sentVip` ≥ 1
   y el mensaje debe ser la plantilla VIP.

Solo los quick replies con IDs exactos `confirmar` y `cancelar`, asociados al SID del
recordatorio vigente, pueden modificar un turno. Escribir esas palabras como texto libre
no confirma ni cancela.
