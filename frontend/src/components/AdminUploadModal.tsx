import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Layers,
  Sparkles,
  Eye,
  Send,
  Save,
  FolderDown,
} from 'lucide-react';
import { api } from '../services/api';
import { DeliverableType, PresentationStatus } from '../types';

interface AdminUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialTarget?: 'presentation' | 'resource';
}

export const AdminUploadModal: React.FC<AdminUploadModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialTarget = 'presentation',
}) => {
  const [uploadTarget, setUploadTarget] = useState<'presentation' | 'resource'>(initialTarget);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('');
  const [deliverableType, setDeliverableType] = useState<DeliverableType>('planning');
  const [resourceCategory, setResourceCategory] = useState<string>('Planning');
  const [versionTag, setVersionTag] = useState<string>('v2');
  const [presentationDate, setPresentationDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [authors, setAuthors] = useState<string>(
    'Yuvika Nagpal, Kumkum Gupta, Aaneya Sabharwal'
  );
  const [description, setDescription] = useState<string>('');
  const [changeSummary, setChangeSummary] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      setFile(droppedFile);
      if (!title) {
        setTitle(droppedFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!title) {
        setTitle(selectedFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
      }
    }
  };

  const executeUpload = async (status: PresentationStatus) => {
    if (!file) {
      setError('Please select or drop a file to upload.');
      return;
    }
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (uploadTarget === 'resource') {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', title.trim());
        formData.append('category', resourceCategory);
        formData.append('description', description);
        formData.append('isPublished', 'true');
        formData.append('authors', authors);
        formData.append('version', versionTag || 'v1.0');
        formData.append('date', presentationDate || new Date().toISOString().split('T')[0]);

        const res = await api.uploadResource(formData);
        if (res.success) {
          onSuccess();
          onClose();
        } else {
          setError(res.message || 'Failed to upload resource deliverable.');
        }
      } else {
        if (!versionTag || !presentationDate) {
          setError('Version and Presentation Date are required for presentations.');
          setLoading(false);
          return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', title);
        formData.append('deliverableType', deliverableType);
        formData.append('versionTag', versionTag.toLowerCase().trim());
        formData.append('presentationDate', presentationDate);
        formData.append('authors', authors);
        formData.append('description', description);
        formData.append('changeSummary', changeSummary);
        formData.append('status', status);

        const res = await api.uploadPresentationVersion(formData);
        if (res.success) {
          onSuccess();
          onClose();
        } else {
          setError(res.message || 'Failed to upload presentation.');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Network error occurred during upload.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
        <div className="glass-card rounded-2xl border border-slate-700 w-full max-w-2xl overflow-hidden shadow-2xl my-8">
          {/* Modal Header */}
          <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
            <div>
              <h3 className="text-lg font-bold text-white font-mono flex items-center space-x-2">
                <UploadCloud className="w-5 h-5 text-emerald-400" />
                <span>Upload Deliverable to Repository</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                Centralized file storage with immediate availability in Resources and Presentations.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-5 text-xs font-mono">
            {error && (
              <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-300 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Target Selector */}
            <div className="space-y-1.5">
              <label className="block text-slate-300 font-semibold font-mono">
                Upload Target Repository
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setUploadTarget('resource')}
                  className={`p-3 rounded-xl border text-left flex items-center space-x-2.5 transition-all ${
                    uploadTarget === 'resource'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <FolderDown className="w-4 h-4 text-emerald-400" />
                  <div>
                    <div className="text-xs">Project Deliverables (Resources)</div>
                    <div className="text-[10px] text-slate-500 font-normal">Reports, specs, data, testing, etc.</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setUploadTarget('presentation')}
                  className={`p-3 rounded-xl border text-left flex items-center space-x-2.5 transition-all ${
                    uploadTarget === 'presentation'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <FileText className="w-4 h-4 text-emerald-400" />
                  <div>
                    <div className="text-xs">Presentation Archive</div>
                    <div className="text-[10px] text-slate-500 font-normal">Planning, mid-sem, final decks</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Drag & Drop File Zone */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                dragActive
                  ? 'border-emerald-400 bg-emerald-950/30'
                  : file
                  ? 'border-emerald-500/60 bg-slate-900/80'
                  : 'border-slate-800 hover:border-slate-700 bg-slate-900/40'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                className="hidden"
                accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.zip,.json,.png,.jpg,.jpeg"
              />
              {file ? (
                <div className="space-y-1">
                  <FileText className="w-8 h-8 text-emerald-400 mx-auto" />
                  <div className="font-semibold text-white text-sm">{file.name}</div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    {Math.round(file.size / 1024)} KB &bull; Selected for upload
                  </div>
                  <span className="text-[10px] text-emerald-400 underline">Click to choose different file</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <UploadCloud className="w-8 h-8 text-slate-500 mx-auto" />
                  <div className="font-medium text-slate-200 font-mono">
                    Drag &amp; drop deliverable file or <span className="text-emerald-400 underline">browse</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    Supports PDF, PPT, PPTX, DOCX, XLSX, ZIP, JSON (Max 50MB)
                  </div>
                </div>
              )}
            </div>

            {/* Title Field */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1 font-mono">
                Deliverable Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={uploadTarget === 'resource' ? 'e.g. Test Plan & Evaluation Report' : 'e.g. Planning Presentation V2'}
                required
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            {/* Resource-Specific Fields */}
            {uploadTarget === 'resource' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1 font-mono">
                      Category *
                    </label>
                    <select
                      value={resourceCategory}
                      onChange={(e) => setResourceCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-emerald-500 font-mono"
                    >
                      <option value="Planning">Planning</option>
                      <option value="Research">Research</option>
                      <option value="Documentation">Documentation</option>
                      <option value="Presentations">Presentations</option>
                      <option value="Design">Design</option>
                      <option value="Development">Development</option>
                      <option value="Testing">Testing</option>
                      <option value="Dataset / ML">Dataset / ML</option>
                      <option value="Reports">Reports</option>
                      <option value="Prototype">Software release</option>
                      <option value="Final Deliverables">Final Deliverables</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1 font-mono">
                      Version (e.g. v1.0, Final)
                    </label>
                    <input
                      type="text"
                      value={versionTag}
                      onChange={(e) => setVersionTag(e.target.value)}
                      placeholder="v1.0"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1 font-mono">
                      Date
                    </label>
                    <input
                      type="date"
                      value={presentationDate}
                      onChange={(e) => setPresentationDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1 font-mono">
                      Authors / Contributors
                    </label>
                    <input
                      type="text"
                      value={authors}
                      onChange={(e) => setAuthors(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </>
            ) : (
              /* Presentation-Specific Fields */
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1 font-mono">
                      Deliverable Type *
                    </label>
                    <select
                      value={deliverableType}
                      onChange={(e) => setDeliverableType(e.target.value as DeliverableType)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-emerald-500 font-mono"
                    >
                      <option value="planning">Planning Presentation</option>
                      <option value="software_grid">Software Grid</option>
                      <option value="midterm">Mid-Sem Presentation</option>
                      <option value="final">Final Presentation</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1 font-mono">
                      Version * (e.g. v1, v2)
                    </label>
                    <input
                      type="text"
                      value={versionTag}
                      onChange={(e) => setVersionTag(e.target.value)}
                      placeholder="v2"
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1 font-mono">
                      Presentation Date *
                    </label>
                    <input
                      type="date"
                      value={presentationDate}
                      onChange={(e) => setPresentationDate(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1 font-mono">
                      Authors
                    </label>
                    <input
                      type="text"
                      value={authors}
                      onChange={(e) => setAuthors(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Description Field */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1 font-mono">
                Short Description / Abstract
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Brief summary of this deliverable for the library..."
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            {/* Actions Bar */}
            <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-900 text-slate-400 hover:text-white border border-slate-800 font-mono"
              >
                Cancel
              </button>

              <div className="flex items-center space-x-2">
                {uploadTarget === 'presentation' && (
                  <button
                    type="button"
                    onClick={() => setPreviewModalOpen(true)}
                    disabled={!title || !file}
                    className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 hover:text-white border border-slate-700 font-mono font-semibold flex items-center space-x-1.5 disabled:opacity-40"
                  >
                    <Eye className="w-3.5 h-3.5 text-teal-400" />
                    <span>Preview</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => executeUpload('published')}
                  disabled={loading || !file || !title}
                  className="px-5 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 transition-colors font-mono flex items-center space-x-1.5 disabled:opacity-40 shadow-sm"
                >
                  {loading ? (
                    <span>Uploading...</span>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Upload to Repository</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Presentation Preview Modal */}
      {previewModalOpen && uploadTarget === 'presentation' && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="glass-card rounded-2xl border border-slate-700 w-full max-w-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-base font-bold text-white font-mono flex items-center space-x-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                <span>Presentation Preview Verification</span>
              </h4>
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono text-slate-300">
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-1.5">
                <div><span className="text-slate-500">Title:</span> <strong className="text-white">{title}</strong></div>
                <div><span className="text-slate-500">Deliverable Type:</span> <span className="text-emerald-400 uppercase">{deliverableType}</span></div>
                <div><span className="text-slate-500">Version:</span> <span className="text-teal-300 uppercase">{versionTag}</span></div>
                <div><span className="text-slate-500">Date:</span> <span className="text-slate-300">{presentationDate}</span></div>
                <div><span className="text-slate-500">Authors:</span> <span className="text-slate-300">{authors}</span></div>
                <div><span className="text-slate-500">File:</span> <span className="text-slate-300">{file?.name} ({Math.round((file?.size || 0) / 1024)} KB)</span></div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-slate-400 border border-slate-800 font-mono text-xs"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreviewModalOpen(false);
                  executeUpload('published');
                }}
                className="px-5 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold font-mono text-xs hover:bg-emerald-400"
              >
                Confirm &amp; Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
export default AdminUploadModal;
