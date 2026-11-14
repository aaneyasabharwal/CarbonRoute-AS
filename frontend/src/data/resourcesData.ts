/**
 * Central Resource & Deliverables Data Structure for CarbonRoute
 * 
 * To add a new deliverable to the Resources section:
 * Simply append a new item to the `DEFAULT_PROJECT_RESOURCES` array below.
 * The Resources UI will automatically generate the card, format badge, and action button.
 */

export type ResourceCategory =
  | 'Planning'
  | 'Research'
  | 'Documentation'
  | 'Presentations'
  | 'Design'
  | 'Development'
  | 'Testing'
  | 'Dataset / ML'
  | 'Reports'
  | 'Prototype'
  | 'Final Deliverables';

export type ResourceFormat =
  | 'pdf'
  | 'ppt'
  | 'docx'
  | 'xlsx'
  | 'zip'
  | 'image'
  | 'link'
  | 'json';

export interface ProjectDeliverable {
  id: string;
  title: string;
  description: string;
  category: ResourceCategory;
  type: string; // e.g., 'Document', 'Presentation', 'Report', 'Specification', 'Dataset', 'Prototype'
  format: ResourceFormat;
  url: string; // Relative URL (e.g. '/CarbonRoute_Planning_Presentation_V1.pdf') or full HTTP/HTTPS URL
  date: string; // e.g. 'August 2026', 'September 2026'
  version?: string; // e.g. 'v1.0', 'v2'
  fileSize?: string; // e.g. '28 KB', '571 KB'
  isExternal?: boolean; // Set true for external documentation/links
  actionType: 'view' | 'download' | 'external';
  badge?: string; // e.g., 'Verified', 'Submitted', 'Live'
  authors?: string;
}

export const RESOURCE_CATEGORIES: { id: string; name: string; category?: ResourceCategory }[] = [
  { id: 'all', name: 'All' },
  { id: 'planning', name: 'Planning', category: 'Planning' },
  { id: 'research', name: 'Research', category: 'Research' },
  { id: 'documentation', name: 'Documentation', category: 'Documentation' },
  { id: 'presentations', name: 'Presentations', category: 'Presentations' },
  { id: 'design', name: 'Design', category: 'Design' },
  { id: 'development', name: 'Development', category: 'Development' },
  { id: 'testing', name: 'Testing', category: 'Testing' },
  { id: 'dataset_ml', name: 'Dataset / ML', category: 'Dataset / ML' },
  { id: 'reports', name: 'Reports', category: 'Reports' },
  // P14: shown as "Software Releases"; the stored category value stays 'Prototype' for existing uploads.
  { id: 'prototype', name: 'Software Releases', category: 'Prototype' },
  { id: 'final', name: 'Final Deliverables', category: 'Final Deliverables' },
];

export const DEFAULT_PROJECT_RESOURCES: ProjectDeliverable[] = [];

