from pathlib import Path
import runpy

runpy.run_path(
    str(Path(__file__).resolve().parents[2] / "packages" / "image-generation" / "src" / "analyze_palette.py"),
    run_name="__main__",
)
