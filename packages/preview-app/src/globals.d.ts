declare const lucide: {
  createIcons(): void;
};

declare const mermaid: {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};
