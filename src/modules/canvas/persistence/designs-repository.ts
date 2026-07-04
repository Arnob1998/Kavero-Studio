import { api } from "@/modules/canvas/persistence/editor-api";
import type { Design, DesignWithPages, Page, Template } from "@/modules/canvas/types/editor-types";

const DESIGN_API_BASE = "/canvas/api/designs";

export interface CreateDesignInput {
  name: string;
  canvas_json: string;
  width?: number;
  height?: number;
}

export interface UpdateDesignInput {
  name?: string;
  canvas_json?: string;
  width?: number;
  height?: number;
}

export interface CreatePageInput {
  after_sort_order?: number;
}

export interface UpdatePageInput {
  canvas_json?: string;
  title?: string;
}

export function listDesigns() {
  return api<Design[]>("GET", DESIGN_API_BASE);
}

export function listTemplates() {
  return api<Template[]>("GET", "/api/templates");
}

export function createDesign(input: CreateDesignInput) {
  return api<Design>("POST", DESIGN_API_BASE, input);
}

export function getDesign(designId: string) {
  return api<DesignWithPages>("GET", `${DESIGN_API_BASE}/${designId}`);
}

export function updateDesign(designId: string, input: UpdateDesignInput) {
  return api<Design>("PUT", `${DESIGN_API_BASE}/${designId}`, input);
}

export function deleteDesign(designId: string) {
  return api<{ ok: boolean }>("DELETE", `${DESIGN_API_BASE}/${designId}`);
}

export function createPage(designId: string, input: CreatePageInput) {
  return api<Page>("POST", `${DESIGN_API_BASE}/${designId}/pages`, input);
}

export function updatePage(pageId: string, input: UpdatePageInput) {
  return api<Page>("PUT", `/api/pages/${pageId}`, input);
}

export function deletePage(pageId: string) {
  return api<{ ok: boolean }>("DELETE", `/api/pages/${pageId}`);
}

export function duplicatePage(pageId: string) {
  return api<Page>("POST", `/api/pages/${pageId}/duplicate`, {});
}
