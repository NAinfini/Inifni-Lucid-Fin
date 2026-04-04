/**
 * Template System — save, load, and share scene orchestration templates.
 */

export interface SceneTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  /** Serialized scene orchestration data */
  data: Record<string, unknown>;
  tags: string[];
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export class TemplateManager {
  private templates: SceneTemplate[] = [];
  private idCounter = 0;

  /** Save current scene as a template */
  create(
    name: string,
    data: Record<string, unknown>,
    options?: { description?: string; category?: string; tags?: string[] },
  ): SceneTemplate {
    const tpl: SceneTemplate = {
      id: `tpl-${++this.idCounter}`,
      name,
      description: options?.description,
      category: options?.category ?? 'custom',
      data: structuredClone(data),
      tags: options?.tags ?? [],
      builtIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.templates.push(tpl);
    return tpl;
  }

  /** Get a template by ID */
  get(id: string): SceneTemplate | undefined {
    return this.templates.find((t) => t.id === id);
  }

  /** List all templates, optionally filtered */
  list(filter?: { category?: string; tag?: string; query?: string }): SceneTemplate[] {
    let items = [...this.templates];
    if (filter?.category) items = items.filter((t) => t.category === filter.category);
    if (filter?.tag) items = items.filter((t) => t.tags.includes(filter.tag!));
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      items = items.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          (t.description?.toLowerCase().includes(q) ?? false),
      );
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Get unique categories */
  getCategories(): string[] {
    return [...new Set(this.templates.map((t) => t.category))].sort();
  }

  /** Update a user template (not built-in) */
  update(
    id: string,
    data: Partial<Pick<SceneTemplate, 'name' | 'description' | 'category' | 'tags' | 'data'>>,
  ): boolean {
    const tpl = this.templates.find((t) => t.id === id);
    if (!tpl || tpl.builtIn) return false;
    if (data.name !== undefined) tpl.name = data.name;
    if (data.description !== undefined) tpl.description = data.description;
    if (data.category !== undefined) tpl.category = data.category;
    if (data.tags !== undefined) tpl.tags = data.tags;
    if (data.data !== undefined) tpl.data = structuredClone(data.data);
    tpl.updatedAt = Date.now();
    return true;
  }

  /** Delete a user template */
  remove(id: string): boolean {
    const idx = this.templates.findIndex((t) => t.id === id && !t.builtIn);
    if (idx < 0) return false;
    this.templates.splice(idx, 1);
    return true;
  }

  /** Get template data for applying to a new scene */
  getApplyData(id: string): Record<string, unknown> | null {
    const tpl = this.get(id);
    return tpl ? structuredClone(tpl.data) : null;
  }

  /** Load templates from persistence */
  loadTemplates(templates: SceneTemplate[]): void {
    this.templates = templates.map((t) => structuredClone(t));
    this.idCounter = templates.reduce((max, t) => {
      const match = t.id.match(/\d+$/);
      return match ? Math.max(max, parseInt(match[0], 10)) : max;
    }, 0);
  }

  /** Register built-in preset templates */
  registerPresets(
    presets: Array<Omit<SceneTemplate, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>>,
  ): void {
    for (const p of presets) {
      if (this.templates.some((t) => t.name === p.name && t.builtIn)) continue;
      this.templates.push({
        ...p,
        id: `tpl-preset-${++this.idCounter}`,
        builtIn: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  }

  /** Export for persistence */
  getTemplates(): SceneTemplate[] {
    return this.templates.map((t) => structuredClone(t));
  }
}
