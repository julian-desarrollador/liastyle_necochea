#!/usr/bin/env python3
"""Flyers de lanzamiento Lia Style Necochea (historias, WhatsApp y QR)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import qrcode
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
OUT = Path(__file__).resolve().parent / "flyers"
FONTS = Path("/tmp/ls-fonts")

FONT_FILES = {
    "PlayfairDisplay-Regular.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@5.2.6/latin-400-normal.ttf",
    "PlayfairDisplay-SemiBold.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@5.2.6/latin-600-normal.ttf",
    "PlayfairDisplay-Bold.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@5.2.6/latin-700-normal.ttf",
    "Montserrat-Regular.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.6/latin-400-normal.ttf",
    "Montserrat-Medium.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.6/latin-500-normal.ttf",
    "Montserrat-SemiBold.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.6/latin-600-normal.ttf",
    "Montserrat-Bold.ttf": "https://cdn.jsdelivr.net/fontsource/fonts/montserrat@5.2.6/latin-700-normal.ttf",
}

URL = "liastylenecochea.com"
QR_URL = "https://liastylenecochea.com/?utm_source=salon&utm_medium=qr&utm_campaign=lanzamiento"

# Marca
CREAM = (246, 241, 232, 255)
INK = (55, 51, 42, 255)
TAUPE = (123, 120, 102, 255)
TAUPE_SOFT = (123, 120, 102, 210)
CREAM_TEXT = (245, 239, 228, 255)
DARK = (20, 19, 19, 255)
GOLD = (155, 183, 212, 255)
ON_GOLD = (31, 24, 20, 255)
WHITE = (255, 255, 255, 255)

STORY = (1080, 1920)
SQUARE = (1080, 1080)
PRINT = (1080, 1350)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def ensure_fonts() -> None:
    import urllib.request

    FONTS.mkdir(parents=True, exist_ok=True)
    for name, url in FONT_FILES.items():
        dest = FONTS / name
        if dest.exists() and dest.stat().st_size > 1000:
            continue
        urllib.request.urlretrieve(url, dest)


def load_logo() -> Image.Image:
    im = Image.open(PUBLIC / "logo lia style.PNG").convert("RGBA")
    arr = np.array(im).astype(np.float32)
    lum = arr[:, :, :3].mean(axis=2)
    alpha = arr[:, :, 3].copy()
    alpha[lum < 16] = 0
    band = (lum >= 16) & (lum < 38)
    alpha[band] = (lum[band] - 16) / 22.0 * alpha[band]
    arr[:, :, 3] = alpha
    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def paste_cx(base: Image.Image, layer: Image.Image, cy: int, width: int | None = None) -> None:
    w = width or layer.size[0]
    x = (base.size[0] - w) // 2
    y = int(cy - layer.size[1] / 2)
    if layer.size[0] != w:
        layer = layer.resize((w, int(layer.size[1] * w / layer.size[0])), Image.Resampling.LANCZOS)
        x = (base.size[0] - w) // 2
        y = int(cy - layer.size[1] / 2)
    base.alpha_composite(layer, (x, y))


def cover(img: Image.Image, size: tuple[int, int], focus=(0.5, 0.35)) -> Image.Image:
    tw, th = size
    img = img.convert("RGB")
    w, h = img.size
    scale = max(tw / w, th / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    cx, cy = focus
    left = int(round(cx * nw - tw / 2))
    top = int(round(cy * nh - th / 2))
    left = max(0, min(left, nw - tw))
    top = max(0, min(top, nh - th))
    return img.crop((left, top, left + tw, top + th))


def gradient(size: tuple[int, int], stops: list[tuple[float, int]], color=(20, 19, 19)) -> Image.Image:
    """stops: list of (y_ratio 0-1, alpha 0-255)."""
    w, h = size
    ys = np.linspace(0, 1, h)
    xp = [s[0] for s in stops]
    fp = [s[1] for s in stops]
    a = np.interp(ys, xp, fp).astype(np.uint8)
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[:, :, 0] = color[0]
    arr[:, :, 1] = color[1]
    arr[:, :, 2] = color[2]
    arr[:, :, 3] = a[:, None]
    return Image.fromarray(arr, "RGBA")


def draw_center(draw: ImageDraw.ImageDraw, text: str, y: int, font_obj, fill, canvas_w: int) -> None:
    draw.text((canvas_w / 2, y), text, font=font_obj, fill=fill, anchor="ma")


def draw_tracked(draw: ImageDraw.ImageDraw, text: str, y: int, font_obj, fill, canvas_w: int, tracking: float) -> None:
    widths = []
    for ch in text:
        widths.append(draw.textlength(ch, font=font_obj))
    total = sum(widths) + tracking * (len(text) - 1)
    x = (canvas_w - total) / 2
    for ch, cw in zip(text, widths):
        draw.text((x, y), ch, font=font_obj, fill=fill, anchor="la")
        x += cw + tracking


def pill(base: Image.Image, text: str, cy: int, font_obj, bg, fg, pad_x=54, pad_y=26) -> None:
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    tw = d.textlength(text, font=font_obj)
    bbox = d.textbbox((0, 0), "Áy", font=font_obj)
    th = bbox[3] - bbox[1]
    pw, ph = int(tw + pad_x * 2), int(th + pad_y * 2)
    x0 = (base.size[0] - pw) // 2
    y0 = int(cy - ph / 2)
    d.rounded_rectangle([x0, y0, x0 + pw, y0 + ph], radius=ph // 2, fill=bg)
    d.text((base.size[0] / 2, cy + 1), text, font=font_obj, fill=fg, anchor="mm")
    base.alpha_composite(overlay)


def divider(draw: ImageDraw.ImageDraw, y: int, canvas_w: int, color, width=280) -> None:
    x0 = (canvas_w - width) // 2
    draw.line([(x0, y), (x0 + width // 2 - 16, y)], fill=color, width=2)
    draw.line([(x0 + width // 2 + 16, y), (x0 + width, y)], fill=color, width=2)
    draw.regular_polygon((canvas_w / 2, y, 7), n_sides=4, rotation=45, fill=color)


def save(img: Image.Image, name: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    rgb = img.convert("RGB")
    rgb.save(path, "JPEG", quality=93, optimize=True, subsampling=0)
    print("wrote", path, rgb.size)
    return path


def story_marca(logo: Image.Image) -> Image.Image:
    w, h = STORY
    im = Image.new("RGBA", STORY, CREAM)
    d = ImageDraw.Draw(im)
    mark = logo.copy()
    mark.thumbnail((430, 430), Image.Resampling.LANCZOS)
    paste_cx(im, mark, 430, mark.size[0])

    f_title = font("PlayfairDisplay-SemiBold.ttf", 64)
    draw_center(d, "¡Ya podés reservar", 700, f_title, INK, w)
    draw_center(d, "tu turno online!", 778, f_title, INK, w)

    f_body = font("Montserrat-Medium.ttf", 32)
    items = [
        "Elegí el día y horario que te queda",
        "Reservá online, las 24 hs",
        "Sin llamadas ni esperas",
    ]
    y = 940
    for line in items:
        d.ellipse([92, y + 10, 108, y + 26], fill=TAUPE)
        d.text((132, y), line, font=f_body, fill=INK, anchor="la")
        y += 78

    divider(d, 1228, w, TAUPE, 320)
    pill(im, URL, 1360, font("Montserrat-SemiBold.ttf", 34), TAUPE, WHITE)
    f_hint = font("Montserrat-Regular.ttf", 26)
    draw_center(d, "Elegí tu día y horario en un minuto", 1478, f_hint, TAUPE, w)
    f_foot = font("Montserrat-Medium.ttf", 22)
    draw_tracked(d, "COLOR  ·  CORTE  ·  PEINADO", 1688, f_foot, TAUPE, w, 2)
    return im


def story_instagram(logo: Image.Image) -> Image.Image:
    im = story_marca(logo)
    d = ImageDraw.Draw(im)
    # reemplazar hint por instrucción de sticker
    d.rectangle([80, 1448, 1000, 1520], fill=CREAM)
    f_hint = font("Montserrat-SemiBold.ttf", 26)
    draw_center(d, "Tocá el link de esta historia", 1478, f_hint, TAUPE, im.size[0])
    return im


def story_app(logo: Image.Image) -> Image.Image:
    photo = cover(Image.open(PUBLIC / "fondo_inicio5.jpeg"), STORY, focus=(0.68, 0.32))
    photo = photo.filter(ImageFilter.GaussianBlur(12))
    photo = ImageEnhance.Brightness(photo).enhance(0.72)
    im = photo.convert("RGBA")
    im.alpha_composite(
        gradient(
            STORY,
            [(0.0, 90), (0.28, 70), (0.48, 185), (0.66, 235), (1.0, 255)],
            color=(18, 17, 16),
        )
    )
    d = ImageDraw.Draw(im)
    mark = logo.copy()
    mark.thumbnail((340, 340), Image.Resampling.LANCZOS)
    paste_cx(im, mark, 560, mark.size[0])
    f_title = font("PlayfairDisplay-SemiBold.ttf", 58)
    draw_center(d, "Reservá tu turno online", 820, f_title, CREAM_TEXT, STORY[0])
    f_sub = font("Montserrat-Medium.ttf", 30)
    draw_center(d, "Elegí día y horario, las 24 hs", 910, f_sub, CREAM_TEXT, STORY[0])
    pill(im, URL, 1070, font("Montserrat-SemiBold.ttf", 34), GOLD, ON_GOLD)
    f_mini = font("Montserrat-Regular.ttf", 24)
    draw_center(d, "Sin llamadas  ·  Sin esperas  ·  24 hs", 1190, f_mini, (200, 198, 190, 255), STORY[0])
    f_foot = font("Montserrat-Medium.ttf", 20)
    draw_tracked(d, "COLOR  ·  CORTE  ·  PEINADO", 1688, f_foot, GOLD, STORY[0], 3)
    return im


def _split_story(photo: Image.Image, logo: Image.Image, title_lines: list[str], subtitle: str) -> Image.Image:
    w, h = STORY
    photo_h = 980
    im = Image.new("RGBA", STORY, CREAM)
    im.paste(photo.convert("RGB"), (0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, photo_h, w, photo_h + 5], fill=TAUPE)
    mark = logo.copy()
    mark.thumbnail((188, 188), Image.Resampling.LANCZOS)
    paste_cx(im, mark, 1110, mark.size[0])
    f_title = font("PlayfairDisplay-SemiBold.ttf", 50)
    y = 1248
    for line in title_lines:
        draw_center(d, line, y, f_title, INK, w)
        y += 60
    f_sub = font("Montserrat-Medium.ttf", 26)
    draw_center(d, subtitle, y + 12, f_sub, TAUPE, w)
    pill(im, URL, 1488, font("Montserrat-SemiBold.ttf", 32), TAUPE, WHITE, pad_x=46, pad_y=22)
    return im


def story_salon(logo: Image.Image) -> Image.Image:
    photo = cover(Image.open(PUBLIC / "fondo_inicio5.jpeg"), (STORY[0], 980), focus=(0.72, 0.42))
    return _split_story(
        photo,
        logo,
        ["Ya podés reservar", "tu turno online"],
        "Cuando quieras, desde el celular",
    )


def story_analia(logo: Image.Image) -> Image.Image:
    photo = cover(Image.open(PUBLIC / "fondo_inicio4.jpeg"), (STORY[0], 980), focus=(0.55, 0.22))
    warm = Image.new("RGB", photo.size, (246, 232, 210))
    photo = Image.blend(photo, warm, 0.10)
    photo = ImageEnhance.Color(photo).enhance(0.88)
    return _split_story(
        photo,
        logo,
        ["Reservá tu turno", "conmigo, online"],
        "Elegí horario · Confirmá en un minuto",
    )


def story_recordatorio(logo: Image.Image) -> Image.Image:
    del logo  # el espejo del local ya lleva la marca
    photo = cover(Image.open(PUBLIC / "fondo_inicio6.jpeg"), STORY, focus=(0.50, 0.22))
    im = photo.convert("RGBA")
    im.alpha_composite(
        gradient(
            STORY,
            [(0.0, 8), (0.42, 8), (0.58, 120), (0.74, 210), (1.0, 236)],
            color=(22, 20, 18),
        )
    )
    d = ImageDraw.Draw(im)
    f_title = font("PlayfairDisplay-SemiBold.ttf", 56)
    draw_center(d, "¿Todavía no sacaste", 1188, f_title, CREAM_TEXT, STORY[0])
    draw_center(d, "tu turno?", 1264, f_title, CREAM_TEXT, STORY[0])
    f_sub = font("Montserrat-Medium.ttf", 26)
    draw_center(d, "Ahora lo reservás vos, sin esperar respuesta", 1356, f_sub, CREAM_TEXT, STORY[0])
    pill(im, URL, 1488, font("Montserrat-SemiBold.ttf", 34), GOLD, ON_GOLD)
    return im


def whatsapp_square(logo: Image.Image) -> Image.Image:
    w, h = SQUARE
    im = Image.new("RGBA", SQUARE, CREAM)
    d = ImageDraw.Draw(im)
    mark = logo.copy()
    mark.thumbnail((380, 380), Image.Resampling.LANCZOS)
    paste_cx(im, mark, 300, mark.size[0])
    f_title = font("PlayfairDisplay-SemiBold.ttf", 48)
    draw_center(d, "Reservá tu turno online", 560, f_title, INK, w)
    f_sub = font("Montserrat-Medium.ttf", 28)
    draw_center(d, "las 24 hs, sin llamar", 630, f_sub, TAUPE, w)
    pill(im, URL, 760, font("Montserrat-SemiBold.ttf", 32), TAUPE, WHITE, pad_x=48, pad_y=24)
    f_foot = font("Montserrat-Medium.ttf", 20)
    draw_tracked(d, "COLOR  ·  CORTE  ·  PEINADO", 960, f_foot, TAUPE, w, 2)
    return im


def qr_mostrador(logo: Image.Image) -> Image.Image:
    im = Image.new("RGBA", PRINT, CREAM)
    d = ImageDraw.Draw(im)
    w, h = PRINT
    mark = logo.copy()
    mark.thumbnail((240, 240), Image.Resampling.LANCZOS)
    paste_cx(im, mark, 200, mark.size[0])
    f_title = font("PlayfairDisplay-SemiBold.ttf", 46)
    draw_center(d, "Escaneá y reservá", 380, f_title, INK, w)
    f_sub = font("Montserrat-Medium.ttf", 24)
    draw_center(d, "tu turno online, ahora mismo", 440, f_sub, TAUPE, w)

    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=2)
    qr.add_data(QR_URL)
    qr.make(fit=True)
    qr_im = qr.make_image(fill_color=(123, 120, 102), back_color=(246, 241, 232)).convert("RGBA")
    qr_im = qr_im.resize((560, 560), Image.Resampling.NEAREST)
    paste_cx(im, qr_im, 820, 560)

    pill(im, URL, 1180, font("Montserrat-SemiBold.ttf", 28), TAUPE, WHITE, pad_x=40, pad_y=20)
    return im


def main() -> None:
    ensure_fonts()
    logo = load_logo()
    save(story_marca(logo), "02-story-marca.jpg")
    save(story_instagram(logo), "02b-story-instagram-link.jpg")
    save(story_app(logo), "03-story-app.jpg")
    save(story_salon(logo), "04-story-salon.jpg")
    save(story_analia(logo), "05-story-analia.jpg")
    save(story_recordatorio(logo), "06-story-recordatorio.jpg")
    save(whatsapp_square(logo), "01-whatsapp-cuadrado.jpg")
    save(qr_mostrador(logo), "07-qr-mostrador.jpg")


if __name__ == "__main__":
    main()
