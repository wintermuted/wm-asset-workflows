# Brand System Diagram

This markdown spec demonstrates the markdown-driven lane for architecture and process diagrams.

```mermaid
flowchart LR
  A[Asset Request] --> B[SVG Source Authoring]
  B --> C[Preview in Browser]
  C --> D[PNG Generation]
  D --> E[Screenshot Capture]
  E --> F[Review + Iterate]
```
