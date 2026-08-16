from pathlib import Path
import runpy

runpy.run_path(
    str(Path(__file__).resolve().parents[2] / "packages" / "image-generation" / "src" / "generate_images.py"),
    run_name="__main__",
)
