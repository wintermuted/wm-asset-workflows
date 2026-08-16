import { mkdir, readFile, writeFile, access, rename } from "node:fs/promises";
import { join } from "node:path";
import { readManifest, writeManifest } from "./manifest.mjs";

export function slugifyProjectName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function projectReadme(name, slug) {
  return `# ${name}\n\n## Authoring\n\nUse the \`/create-svg-asset\` Copilot Chat prompt with:\n\n\`\`\`text\nProject: ${name}\nDirectory: assets/svg/${slug}/\n\`\`\`\n\nAdd reference images to \`assets/svg/${slug}/grounding/\`. Register finished SVGs in \`manifests/assets.json\`.\n\n## References\n\n- [Create SVG Asset prompt](../../../.github/prompts/create-svg-asset.prompt.md)\n- [Manifest specification](../../../.github/skills/wm-asset-manifest-spec/SKILL.md)\n- [Authoring workflow](../../../.github/skills/wm-asset-authoring-workflow/SKILL.md)\n`;
}

export function projectSamplePrompts(name, slug) {
  return [
    `/create-svg-asset\n\nProject: ${name}\nDirectory: assets/svg/${slug}/`,
    `/create-svg-asset\n\nCreate a minimal geometric mark using the uploaded steering source material.\nBase idea: combine a strong silhouette with one distinctive cutout or negative-space detail.\n\nProject: ${name}\nDirectory: assets/svg/${slug}/`,
    `/create-svg-asset\n\nCreate an expressive symbol using the uploaded steering source material.\nBase idea: translate the project's core purpose into a modular emblem that remains recognizable at favicon size.\n\nProject: ${name}\nDirectory: assets/svg/${slug}/`
  ];
}

export function normalizeProjectPrompt(prompt, projectName, projectSlug) {
  const fields = `Project: ${projectName}\nDirectory: assets/svg/${projectSlug}/`;
  const content = String(prompt).replace(/^Project:.*(?:\r?\n)?/gm, "").replace(/^Directory:.*(?:\r?\n)?/gm, "").trimEnd();
  return content ? `${content}\n\n${fields}` : fields;
}

export async function scaffoldProject(root, name, slug) {
  const svgDir = join(root, "assets", "svg", slug);
  await mkdir(join(svgDir, "grounding"), { recursive: true });
  await writeFile(join(svgDir, "README.md"), projectReadme(name, slug), { flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const manifest = await readManifest(root);
  let project = manifest.projects.find((item) => item.name === name || item.slug === slug);
  const alreadyExists = Boolean(project);
  if (!alreadyExists) {
    project = {
      name, slug, primaryAssetId: "", samplePrompts: projectSamplePrompts(name, slug),
      documentation: `assets/svg/${slug}/README.md`,
      iconSlots: {
        favicon: { title: "Favicon", assetId: "", note: "" },
        appIcon: { title: "Web App Icon", assetId: "", note: "" },
        logoMark: { title: "Logo Mark", assetId: "", note: "" },
        wordmark: { title: "Wordmark", assetId: "", note: "" },
        socialPreview: { title: "Social Preview", assetId: "", note: "" }
      },
      agentSteer: { notes: [], sources: [] }
    };
    manifest.projects.push(project);
  }
  project.slug ||= slug;
  project.documentation ||= `assets/svg/${slug}/README.md`;
  project.samplePrompts ||= projectSamplePrompts(name, slug);
  project.agentSteer ||= { notes: [], sources: [] };
  await writeManifest(root, manifest);
  return { name, slug, alreadyExists };
}

export async function renameProject(root, currentName, nextName) {
  const manifest = await readManifest(root);
  const project = manifest.projects.find((item) => item.name === currentName);
  if (!project) throw new Error(`Unknown project: ${currentName}`);
  if (manifest.projects.some((item) => item !== project && item.name.toLowerCase() === nextName.toLowerCase())) {
    throw new Error(`A project named ${nextName} already exists`);
  }
  const currentSlug = String(project.slug || slugifyProjectName(currentName));
  const nextSlug = slugifyProjectName(nextName);
  const currentPrefix = `assets/svg/${currentSlug}/`;
  const nextPrefix = `assets/svg/${nextSlug}/`;
  const rewrite = (value) => {
    const path = String(value || "");
    return path.startsWith(currentPrefix) ? `${nextPrefix}${path.slice(currentPrefix.length)}` : path;
  };
  if (currentSlug !== nextSlug) {
    try { await access(join(root, nextPrefix)); throw new Error(`Project directory already exists: ${nextPrefix}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await rename(join(root, currentPrefix), join(root, nextPrefix)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  project.name = nextName;
  project.slug = nextSlug;
  project.documentation = rewrite(project.documentation || `${currentPrefix}README.md`);
  project.samplePrompts = (project.samplePrompts || projectSamplePrompts(nextName, nextSlug))
    .map((prompt) => normalizeProjectPrompt(prompt, nextName, nextSlug));
  for (const source of project.agentSteer?.sources || []) {
    if (source.src) source.src = rewrite(source.src);
    if (source.path) source.path = rewrite(source.path);
    if (source.alt === `${currentName} grounding reference`) source.alt = `${nextName} grounding reference`;
  }
  for (const asset of manifest.assets || []) {
    if (asset.project === currentName || String(asset.source || "").startsWith(currentPrefix)) {
      asset.project = nextName;
      asset.source = rewrite(asset.source);
    }
  }
  try {
    const readmePath = join(root, project.documentation);
    const readme = await readFile(readmePath, "utf-8");
    await writeFile(readmePath, readme.replace(/^# .*$/m, `# ${nextName}`).replace(/^Project:.*$/gm, `Project: ${nextName}`).split(currentPrefix).join(nextPrefix), "utf-8");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await writeManifest(root, manifest);
  return { name: nextName };
}
