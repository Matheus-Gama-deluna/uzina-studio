import {
  generateSkillsLockManifest,
  loadNativeSkills,
  readSkillsLockFile,
  resolveDefaultSkillsDir,
  verifySkillsLockManifest,
} from "@uzina/core";
import path from "node:path";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const skillsDir = resolveDefaultSkillsDir();
    const skills = loadNativeSkills({ skillsDir });
    const repoRoot = path.resolve(skillsDir, "..", "..");
    const diskLock = readSkillsLockFile(path.join(repoRoot, "skills-lock.json"));
    const lockManifest = diskLock ?? generateSkillsLockManifest({ skillsDir });
    const verification = verifySkillsLockManifest(lockManifest, {
      skillsDir,
      requireAllDiskSkillsLocked: true,
    });

    const entryByName = new Map(
      lockManifest.skills.map((entry) => [entry.name, entry])
    );

    return NextResponse.json(
      {
        skills: skills.map((skill) => {
          const entry = entryByName.get(skill.name);
          return {
            name: skill.name,
            description: skill.description,
            version: skill.version ?? null,
            license: skill.license ?? null,
            phase: skill.phase ?? null,
            roleCategory: skill.roleCategory,
            appliesToRoles: skill.appliesToRoles,
            resourcesCount:
              skill.references.length +
              skill.templates.length +
              skill.scripts.length,
            sha256: entry?.sha256 ?? "0".repeat(64),
            verified: entry?.verified ?? false,
            enabled: entry?.enabled ?? true,
          };
        }),
        lockManifest,
        lockValid: verification.valid,
        lockIssues: verification.issues.map((i) => i.detail),
      },
      { status: 200 }
    );
  } catch (err) {
    return jsonError(500, {
      error:
        err instanceof Error
          ? err.message
          : "Falha ao carregar catálogo de skills.",
      code: "SKILLS_CATALOG_ERROR",
    });
  }
}
