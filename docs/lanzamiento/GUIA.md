# Lanzamiento de turnos online — Lia Style Necochea

Piezas listas en `docs/lanzamiento/flyers/`.
El enlace que se ve en las imágenes es **liastylenecochea.com**.
En mensajes, sticker de Instagram y QR usá el link con UTM (abajo) para saber de qué canal vienen las reservas.

## Qué usar (no hace falta publicar las 8)

| Canal | Archivo | Por qué |
| --- | --- | --- |
| Lista de difusión / chat de WhatsApp | `01-whatsapp-cuadrado.jpg` | Se ve completa sin abrir la imagen. El clic real lo da el **texto** con el link. |
| Historia de Instagram (día 1) | `04-story-salon.jpg` o `05-story-analia.jpg` | Foto del local o de Analia. Convierten más que un fondo blanco. |
| Historia de Instagram (si querés la versión más “marca”) | `02b-story-instagram-link.jpg` | Misma idea del Canva, más limpia, y pide tocar el link. |
| Estado de WhatsApp | `02-story-marca.jpg` o `05-story-analia.jpg` | 9:16. En el estado, **agregá también el link**. |
| Día 2 o 3 (recordatorio) | `06-story-recordatorio.jpg` | “¿Todavía no sacaste turno?”. No satures: una sola vez. |
| Mostrador / espejo / mesa | `07-qr-mostrador.jpg` | Imprimir 10×12 cm. Lo escanean mientras esperan. |

`03-story-app.jpg` es la versión oscura, parecida a la app. Opcional.

## Textos para copiar y pegar

### 1) Lista de difusión (lo que más reservas va a traer)

Hola! 💛

Ahora podés reservar tu turno online, las 24 hs, sin llamarme ni esperar a que te conteste.

Entrá, elegí el día y el horario que te quede, y listo:

https://liastylenecochea.com/?utm_source=whatsapp&utm_medium=difusion&utm_campaign=lanzamiento

Cualquier duda me escribís.

### 2) Versión corta (por si la lista no admite textos largos)

Ya podés reservar tu turno online, las 24 hs:

https://liastylenecochea.com/?utm_source=whatsapp&utm_medium=difusion&utm_campaign=lanzamiento

### 3) Estado de WhatsApp (texto que acompaña la imagen)

Reservá tu turno online, cuando quieras:
https://liastylenecochea.com/?utm_source=whatsapp&utm_medium=estado&utm_campaign=lanzamiento

### 4) Historia de Instagram (el texto de la historia casi no se lee: el clic es el sticker)

- Pegá el sticker de **link** sobre el botón `liastylenecochea.com`.
- Destino: `https://liastylenecochea.com/?utm_source=instagram&utm_medium=story&utm_campaign=lanzamiento`
- En la bio, el mismo sitio: `https://liastylenecochea.com/?utm_source=instagram&utm_medium=bio&utm_campaign=lanzamiento`

### 5) QR del salón (ya va en la imagen)

`https://liastylenecochea.com/?utm_source=salon&utm_medium=qr&utm_campaign=lanzamiento`

## Orden para conseguir más usuarias

1. **Primero WhatsApp a clientas actuales.** Ya la conocen. Ahí está el 70–80 % de las primeras reservas.
2. **El mismo día, historia de Instagram** + link en la bio.
3. **QR en el salón** desde el día 1. Cada clienta que está sentada es una reserva futura sin esfuerzo.
4. **A las 48 hs**, una sola historia/estado de recordatorio (`06`).
5. Cuando haya reservas reales: una historia tipo “ya se puede ver el horario y confirmar desde el celu”. Prueba social > flyer nuevo.

No hace falta un descuento de lanzamiento. El beneficio es no llamar y elegir horario.

## Antes de que Analia empiece a compartir

- [ ] El link de la bio de Instagram apunta a liastylenecochea.com
- [ ] En WhatsApp Business, campo Sitio web = liastylenecochea.com
- [ ] Probar el flujo entero en el celular: elegir servicio → día → horario → confirmar
- [ ] El QR de `07-qr-mostrador.jpg` abre la home (probarlo con el celu antes de imprimir)
- [ ] Tener a mano el texto de la lista de difusión (no improvisar el link)

## Cómo regenerar las imágenes

```bash
python3 docs/lanzamiento/generate_flyers.py
```
