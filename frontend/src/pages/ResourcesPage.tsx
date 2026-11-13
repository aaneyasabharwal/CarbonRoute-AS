import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderDown,
  FileText,
  Download,
  Filter,
  Search,
  Calendar,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Eye,
  X,
  Layers,
  Cpu,
  Database,
  BookOpen,
  FileSpreadsheet,
  Code2,
  Tag,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, resolveFileUrl } from '../services/api';
import { Resource } from '../types';
import { RESOURCE_CATEGORIES } from '../data/resourcesData';

export const ResourcesPage: React.FC = () => {
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [previewResource, setPreviewResource] = useState<Resource | null>(null);

  const fetchResources = async (cat: string) => {
    setLoading(true);
    try {
      const res = await api.getResources(cat);
      if (res.success && res.data) {
        setResources(res.data);
      }
    } catch (err) {
      console.error('Failed to load resources:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResources(selectedCategory);
  }, [selectedCategory]);

  // Client-side search filtering
  const filteredResources = useMemo(() => {
    if (!searchQuery.trim()) return resources;
    const q = searchQuery.toLowerCase().trim();
    return resources.filter((r) => {
      const titleMatch = r.title.toLowerCase().includes(q);
      const descMatch = r.description.toLowerCase().includes(q);
      const catMatch = r.category.toLowerCase().includes(q);
      const typeMatch = r.type ? r.type.toLowerCase().includes(q) : false;
      const authorsMatch = r.authors ? r.authors.toLowerCase().includes(q) : false;
      return titleMatch || descMatch || catMatch || typeMatch || authorsMatch;
    });
  }, [resources, searchQuery]);

  const handleDownload = (res: Resource, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const fileUrl = resolveFileUrl(res.fileUrl, res.filePath, res.fileName);
    if (!fileUrl) return;
    const link = document.createElement('a');
    link.href = fileUrl.includes('?') ? `${fileUrl}&download=true` : `${fileUrl}?download=true`;
    link.setAttribute('download', res.fileName || `${res.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleView = (res: Resource) => {
    const fileUrl = resolveFileUrl(res.fileUrl, res.filePath, res.fileName);
    if (!fileUrl) return;

    if (res.isExternal || fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    if (fileUrl.endsWith('.pdf')) {
      setPreviewResource(res);
      return;
    }

    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  const getFormatIcon = (format?: string, type?: string) => {
    const fmt = (format || '').toLowerCase();
    const typ = (type || '').toLowerCase();

    if (fmt === 'pdf') return <FileText className="w-4 h-4 text-rose-400" />;
    if (fmt === 'ppt' || fmt === 'pptx') return <Layers className="w-4 h-4 text-amber-400" />;
    if (fmt === 'docx' || fmt === 'doc') return <BookOpen className="w-4 h-4 text-sky-400" />;
    if (fmt === 'xlsx' || fmt === 'xls') return <FileSpreadsheet className="w-4 h-4 text-emerald-400" />;
    if (fmt === 'json' || typ === 'dataset') return <Database className="w-4 h-4 text-teal-400" />;
    if (typ === 'prototype') return <Cpu className="w-4 h-4 text-emerald-400" />;
    if (fmt === 'link' || fmt === 'external') return <ExternalLink className="w-4 h-4 text-indigo-400" />;
    return <FileText className="w-4 h-4 text-slate-400" />;
  };

  const getFormatBadge = (format?: string, type?: string) => {
    const fmt = (format || type || 'DOC').toUpperCase();
    if (fmt.includes('PDF')) return 'bg-rose-500/10 text-rose-300 border-rose-500/30';
    if (fmt.includes('PPT')) return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
    if (fmt.includes('DOC')) return 'bg-sky-500/10 text-sky-300 border-sky-500/30';
    if (fmt.includes('XLS')) return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
    if (fmt.includes('JSON') || fmt.includes('DATA')) return 'bg-teal-500/10 text-teal-300 border-teal-500/30';
    if (fmt.includes('PROTO') || fmt.includes('LINK')) return 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30';
    return 'bg-slate-800 text-slate-300 border-slate-700';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Header Banner */}
      <div className="space-y-3 pb-6 border-b border-slate-800">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
          <FolderDown className="w-3.5 h-3.5" />
          <span>Project Deliverables &amp; Research Library</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
          Project Deliverables Repository
        </h1>
        <p className="text-sm sm:text-base text-slate-300 max-w-3xl leading-relaxed">
          Central repository for all CarbonRoute academic deliverables, project proposals, planning presentations, research formulations, system designs, dataset specifications, testing reports, and prototype releases.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-4">
        {/* Search Input */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-grow max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search deliverables by title, keyword, author..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="text-xs font-mono text-slate-400 self-end sm:self-auto flex items-center space-x-2">
            <span>Showing <strong className="text-white">{filteredResources.length}</strong> items</span>
            {selectedCategory !== 'all' && (
              <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-400 text-[11px]">
                {selectedCategory}
              </span>
            )}
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="glass-card rounded-2xl p-3 border border-slate-800/80 flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
          <div className="flex items-center space-x-1 pl-2 pr-3 text-slate-400 border-r border-slate-800 shrink-0 text-xs font-mono">
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Category:</span>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-xs">
            {RESOURCE_CATEGORIES.map((c) => {
              const active = selectedCategory.toLowerCase() === c.id.toLowerCase() ||
                (c.category && selectedCategory.toLowerCase() === c.category.toLowerCase());
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(c.category || c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap font-medium ${
                    active
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                      : 'bg-slate-900/80 text-slate-400 border border-slate-800 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Deliverables Grid */}
      {loading ? (
        <div className="p-16 text-center text-slate-400 font-mono text-xs flex flex-col items-center justify-center space-y-3 glass-card rounded-2xl border border-slate-800">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
          <span>Loading project deliverables library...</span>
        </div>
      ) : resources.length === 0 ? (
        <div className="p-16 text-center text-slate-400 font-mono glass-card rounded-2xl border border-slate-800 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
            <FolderDown className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white font-mono">No resources uploaded yet.</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Upload presentations, reports, and project documents from the Admin panel.
            </p>
          </div>
          <div className="pt-2">
            {/* Router link: a plain href="/admin" ignores the GitHub Pages base path (P7). */}
            <Link
              to="/admin"
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 text-xs font-mono transition-colors shadow-sm"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Go to Admin Panel &rarr;</span>
            </Link>
          </div>
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="p-16 text-center text-slate-400 font-mono text-xs glass-card rounded-2xl border border-slate-800 space-y-3">
          <Filter className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-white font-bold text-sm">No deliverables found</p>
          <p className="text-slate-400 text-xs max-w-sm mx-auto">
            {searchQuery
              ? `No resources match "${searchQuery}". Try clearing the search filter.`
              : `No resources registered under category "${selectedCategory}".`}
          </p>
          {(searchQuery || selectedCategory !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
              className="mt-2 px-3 py-1.5 rounded-lg bg-slate-800 text-emerald-400 hover:bg-slate-700 text-xs font-mono"
            >
              Reset All Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredResources.map((res) => {
            const isPdf = res.format === 'pdf' || res.fileName?.endsWith('.pdf') || res.fileUrl?.endsWith('.pdf');
            const isExternalLink = res.isExternal || res.actionType === 'external' || res.format === 'link';
            const fileUrl = resolveFileUrl(res.fileUrl, res.filePath, res.fileName);
            const hasFile = Boolean(fileUrl && fileUrl.trim().length > 0 && !fileUrl.endsWith('/undefined'));

            return (
              <div
                key={res.id}
                className="glass-card glass-card-hover rounded-2xl p-6 border border-slate-800/90 flex flex-col justify-between space-y-5 group hover:border-emerald-500/40 transition-all shadow-sm"
              >
                <div className="space-y-3.5">
                  {/* Top Badges & Type */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-1.5">
                      <span className="p-1 rounded-md bg-slate-900 border border-slate-800">
                        {getFormatIcon(res.format, res.type)}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${getFormatBadge(res.format, res.type)}`}>
                        {res.type || res.format || 'DOCUMENT'}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 text-[11px] font-mono">
                      {res.badge && (
                        <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 font-bold text-[10px]">
                          {res.badge}
                        </span>
                      )}
                      {res.version && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800 text-[10px]">
                          {res.version}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title */}
                  <h2 className="text-base font-bold text-white font-mono tracking-tight leading-snug group-hover:text-emerald-300 transition-colors">
                    {res.title}
                  </h2>

                  {/* Description */}
                  <p className="text-xs text-slate-300 leading-relaxed font-sans line-clamp-3">
                    {res.description}
                  </p>

                  {/* Metadata Row */}
                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                    <div className="flex items-center space-x-1 text-emerald-400/90">
                      <Tag className="w-3 h-3" />
                      <span>{res.category}</span>
                    </div>
                    {res.date && (
                      <div className="flex items-center space-x-1 text-slate-400">
                        <Calendar className="w-3 h-3" />
                        <span>{res.date}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <div className="text-[10px] font-mono text-slate-500">
                    {res.fileSize
                      ? typeof res.fileSize === 'number'
                        ? `${Math.round(res.fileSize / 1024)} KB`
                        : res.fileSize
                      : ''}
                  </div>

                  <div className="flex items-center space-x-2">
                    {hasFile ? (
                      <>
                        {/* View Button */}
                        <button
                          onClick={() => handleView(res)}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500/50 text-slate-200 hover:text-emerald-300 font-mono text-xs flex items-center space-x-1.5 transition-colors"
                          title={isExternalLink ? 'Open External Resource' : 'View Deliverable'}
                        >
                          {isExternalLink ? (
                            <>
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Open</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              <span>View</span>
                            </>
                          )}
                        </button>

                        {/* Download Button (for binary files) */}
                        {!isExternalLink && (
                          <button
                            onClick={(e) => handleDownload(res, e)}
                            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition-colors"
                            title="Download file"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 text-[11px] font-mono italic">
                        File unavailable
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Deliverables Library Footer / Instructions */}
      <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 text-xs font-mono text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-white font-bold">Project Deliverables Repository</div>
            <div className="text-slate-500 text-[11px]">
              Upload presentations, reports, and project documents through the Admin portal.
            </div>
          </div>
        </div>

        <Link
          to="/admin"
          className="px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-emerald-500/50 text-slate-300 hover:text-white text-xs font-mono flex items-center space-x-1.5 shrink-0 transition-colors"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Admin Portal &rarr;</span>
        </Link>
      </div>

      {/* PDF / Document In-Browser Preview Modal */}
      {previewResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="glass-card rounded-2xl border border-slate-700 w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 px-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
              <div className="flex items-center space-x-3 min-w-0">
                <FileText className="w-5 h-5 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white font-mono truncate">
                    {previewResource.title}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {previewResource.category} &bull; {previewResource.version || 'v1.0'}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleDownload(previewResource)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:text-white border border-slate-700 text-xs font-mono flex items-center space-x-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>

                <a
                  href={resolveFileUrl(previewResource.fileUrl, previewResource.filePath, previewResource.fileName)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white border border-slate-700"
                  title="Open in new tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>

                <button
                  onClick={() => setPreviewResource(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Iframe Body */}
            <div className="flex-grow bg-slate-950 relative">
              <iframe
                src={resolveFileUrl(previewResource.fileUrl, previewResource.filePath, previewResource.fileName)}
                className="w-full h-full border-0"
                title={previewResource.title}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ResourcesPage;
