import type { SectionType } from "./types.js";

const ALLOWED_CHILDREN: Partial<Record<SectionType, SectionType[]>> = {
  folder: ["folder", "file", "idea", "todo", "kanban", "drawing", "knowledge_graph"],
  file: ["section"],
  section: ["section"],
  idea: ["section"],
};

const ROOT_ALLOWED: SectionType[] = ["folder"];

export const CONTAINER_TYPES: SectionType[] = ["folder", "file"];

export function canBeRoot(type: SectionType): boolean {
  return ROOT_ALLOWED.includes(type);
}

export function canContainChild(parentType: SectionType, childType: SectionType): boolean {
  return ALLOWED_CHILDREN[parentType]?.includes(childType) ?? false;
}

export function validateHierarchy(
  childType: SectionType,
  parentType: SectionType | null,
): void {
  if (parentType === null) {
    if (!canBeRoot(childType)) {
      throw new Error(`Type "${childType}" cannot be at root level`);
    }
    return;
  }
  if (!canContainChild(parentType, childType)) {
    throw new Error(`Type "${parentType}" cannot contain child of type "${childType}"`);
  }
}
