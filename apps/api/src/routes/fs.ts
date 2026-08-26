import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  BrowseError,
  defaultBrowsePath,
  listDirectory,
  listRoots,
} from "../lib/browse.js";
import { CLAUDE_MD_FILENAME } from "../projects/scaffold.js";

const BrowseQuery = z.object({
  path: z.string().min(1).optional(),
  hidden: z.coerce.boolean().optional(),
});

const PathQuery = z.object({ path: z.string().min(1) });

/** Un CLAUDE.md más grande que esto no lo escribió una persona. */
const MAX_CLAUDE_MD_BYTES = 256 * 1024;

export async function fsRoutes(app: FastifyInstance) {
  app.get("/fs/roots", async () => listRoots());

  app.get("/fs/browse", async (req, reply) => {
    const query = BrowseQuery.parse(req.query);
    try {
      return await listDirectory(query.path ?? defaultBrowsePath(), {
        includeHidden: query.hidden,
      });
    } catch (err) {
      if (err instanceof BrowseError) return reply.badRequest(err.message);
      throw err;
    }
  });

  /**
   * CLAUDE.md que ya vive en una carpeta. El formulario de nuevo proyecto lo
   * precarga en el editor: sin esto, elegir una carpeta que ya tiene uno lo
   * sobrescribiría con lo que hubiera escrito el usuario.
   */
  app.get("/fs/claude-md", async (req, reply) => {
    const query = PathQuery.parse(req.query);
    if (!path.isAbsolute(query.path)) return reply.badRequest("La ruta debe ser absoluta");

    const filePath = path.join(path.resolve(query.path), CLAUDE_MD_FILENAME);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_CLAUDE_MD_BYTES) {
        return { exists: false, path: filePath, content: null };
      }
      return { exists: true, path: filePath, content: await fs.readFile(filePath, "utf8") };
    } catch {
      return { exists: false, path: filePath, content: null };
    }
  });
}
