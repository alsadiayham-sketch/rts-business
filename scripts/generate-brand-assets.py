from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "src" / "assets"
INSTALLER_ASSETS = ROOT / "installer-ui" / "renderer"

PURPLE = "#48115b"
LIGHT = "#faf6fb"
MARK_POINTS = [
    (1, 1), (95, 1), (95, 28), (57, 61), (97, 107), (67, 107),
    (35, 74), (1, 107), (1, 78), (67, 24), (24, 24), (24, 48), (1, 67),
]


def make_icon(size: int) -> Image.Image:
    scale = 4
    canvas_size = size * scale
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    radius = int(canvas_size * 0.22)
    draw.rounded_rectangle((0, 0, canvas_size - 1, canvas_size - 1), radius, fill=PURPLE)

    inset = int(canvas_size * 0.12)
    inner_radius = int(canvas_size * 0.15)
    draw.rounded_rectangle(
        (inset, inset, canvas_size - inset - 1, canvas_size - inset - 1),
        inner_radius,
        fill=LIGHT,
    )

    mark_width = canvas_size * 0.50
    mark_height = mark_width * 108 / 98
    left = (canvas_size - mark_width) / 2
    top = (canvas_size - mark_height) / 2
    points = [
        (left + x / 98 * mark_width, top + y / 108 * mark_height)
        for x, y in MARK_POINTS
    ]
    draw.polygon(points, fill=PURPLE)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    INSTALLER_ASSETS.mkdir(parents=True, exist_ok=True)

    icon_1024 = make_icon(1024)
    icon_1024.save(ASSETS / "icon.png")
    make_icon(256).save(ASSETS / "icon-256.png")
    make_icon(512).save(INSTALLER_ASSETS / "icon.png")

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = [make_icon(size) for size in ico_sizes]
    ico_images[-1].save(
        ASSETS / "icon.ico",
        format="ICO",
        append_images=ico_images[:-1],
        sizes=[(size, size) for size in ico_sizes],
    )


if __name__ == "__main__":
    main()
