// Nos testes, faz `import x from "./arquivo.md"` funcionar como no Cloudflare.
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
  import { readFile } from "node:fs/promises";
  export async function load(url, context, next) {
    if (url.endsWith(".md")) {
      const texto = await readFile(new URL(url), "utf8");
      return { format: "module", source: "export default " + JSON.stringify(texto), shortCircuit: true };
    }
    return next(url, context);
  }
`));
