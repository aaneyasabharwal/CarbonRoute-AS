import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Zap,
  FileText,
  Users,
  Layers,
  Compass,
  Milestone,
  Cpu,
  Lock,
  Menu,
  X,
  LogOut,
  Play,
  FlaskConical,
  History,
  BarChart3,
  Network,
  FolderDown,
  Shield,
  User as UserIcon,
  LayoutDashboard,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * Navigation (P11 responsive rework). Before P11 all 14 links sat in one row from 1280 px: at
 * 1366-1440 px four labels wrapped onto two lines, five items (including Sign in) were beyond the
 * viewport and the page scrolled sideways (document ~1850 px wide).
 *  - >= 1024 px: the five application destinations, a "More" menu with the project pages, and the
 *    account actions; labels never wrap (icons only from 1280 px, the CTA only from 1536 px).
 *  - < 1024 px: a collapsible menu with every destination, closed on navigation and Escape.
 */
export const PRIMARY_LINKS = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Scheduler', path: '/scheduler', icon: Cpu, highlight: true },
  { name: 'My Jobs', path: '/jobs', icon: History },
  { name: 'Results', path: '/results', icon: BarChart3 },
  { name: 'Experiments', path: '/experiments', icon: FlaskConical },
];

export const PROJECT_LINKS = [
  { name: 'Home', path: '/', icon: Zap },
  { name: 'Project', path: '/project', icon: Compass },
  { name: 'How It Works', path: '/how-it-works', icon: Play },
  { name: 'Architecture', path: '/architecture', icon: Layers },
  { name: 'System Design', path: '/system-design', icon: Network },
  { name: 'Roadmap', path: '/roadmap', icon: Milestone },
  { name: 'Team', path: '/team', icon: Users },
  { name: 'Resources', path: '/resources', icon: FolderDown },
  { name: 'Planning V1', path: '/presentations/planning/v1', icon: FileText },
];

export const Navbar: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();

  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path));
  const moreActive = PROJECT_LINKS.some((l) => isActive(l.path));

  // Close menus on navigation, on Escape and (for "More") on a click outside it.
  useEffect(() => {
    setMobileMenuOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        setMobileMenuOpen(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const linkClass = (active: boolean, highlight?: boolean) =>
    `px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all inline-flex items-center gap-1 font-mono whitespace-nowrap ${
      highlight
        ? active
          ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
          : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 font-bold'
        : active
          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm'
          : 'text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent'
    }`;

  return (
    <header className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 h-16 min-w-0">
          {/* Logo & Brand */}
          <Link to="/" className="flex items-center gap-3 shrink-0 group min-w-0" aria-label="CarbonRoute home">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center group-hover:border-emerald-500/60 group-hover:bg-emerald-500/20 transition-all shadow-sm">
              <Zap className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-white font-mono">CARBONROUTE</span>
              </div>
              <span className="text-[11px] text-emerald-400/90 font-mono tracking-wide font-medium whitespace-nowrap">Team TriFlux &bull; UCS503</span>
            </div>
          </Link>

          {/* Desktop navigation (>= 1024 px) */}
          <nav aria-label="Main" className="hidden lg:flex items-center gap-0.5 min-w-0">
            {PRIMARY_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <Link key={link.path} to={link.path} className={linkClass(isActive(link.path), link.highlight)} aria-current={isActive(link.path) ? 'page' : undefined}>
                  <Icon className="w-3.5 h-3.5 hidden xl:inline" aria-hidden="true" />
                  <span>{link.name}</span>
                </Link>
              );
            })}
            <div className="relative" ref={moreRef}>
              <button
                type="button"
                className={linkClass(moreActive)}
                aria-haspopup="true"
                aria-expanded={moreOpen}
                aria-controls="nav-more-menu"
                onClick={() => setMoreOpen((o) => !o)}
              >
                <span>More</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {moreOpen && (
                <div
                  id="nav-more-menu"
                  className="absolute right-0 mt-2 w-56 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 shadow-xl p-1.5 font-mono text-xs"
                >
                  {PROJECT_LINKS.map((link) => {
                    const Icon = link.icon;
                    const active = isActive(link.path);
                    return (
                      <Link
                        key={link.path}
                        to={link.path}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg whitespace-nowrap ${active ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-slate-900 hover:text-white'}`}
                      >
                        <Icon className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                        <span>{link.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </nav>

          {/* Actions (>= 1024 px) */}
          {/* P13: a separate launch button (>= 1536 px) duplicated the highlighted Scheduler link and
              overlapped "More" when signed in with a long username; removed. */}
          <div className="hidden lg:flex items-center gap-2 shrink-0">
            {isAuthenticated ? (
              <div className="flex items-center gap-1 pl-2 border-l border-slate-800 text-xs">
                {/* P8: Account for everyone signed in, Admin only for administrators. */}
                <Link
                  to="/account"
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-slate-200 border border-slate-800 hover:border-emerald-500/40 text-xs font-mono max-w-[10rem]"
                  title={`Account (${user?.username ?? ''})`}
                >
                  <UserIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="hidden xl:inline truncate">{user?.username ?? 'Account'}</span>
                  <span className="xl:hidden sr-only">Account</span>
                </Link>
                {isAdmin && (
                  <Link
                    to="/admin"
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-emerald-400 border border-slate-800 hover:border-emerald-500/40 text-xs font-mono"
                    title="Admin Dashboard"
                  >
                    <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Admin</span>
                  </Link>
                )}
                <button onClick={handleLogout} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-900" title="Sign out" aria-label="Sign out">
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <Link
                to="/admin"
                className="px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-900 border border-slate-800 text-xs font-mono inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign in</span>
              </Link>
            )}
          </div>

          {/* Menu toggle (< 1024 px) */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((o) => !o)}
            className="lg:hidden p-2.5 rounded-lg bg-slate-900 text-slate-300 hover:text-white border border-slate-800 shrink-0"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Menu (< 1024 px): every destination, scrollable if the screen is short */}
      {mobileMenuOpen && (
        <nav
          id="mobile-menu"
          aria-label="Main"
          className="lg:hidden border-t border-slate-800 bg-slate-950 px-4 pt-3 pb-5 space-y-3 font-mono text-xs max-h-[calc(100vh-4rem)] overflow-y-auto"
        >
          {[
            { title: 'Application', links: PRIMARY_LINKS },
            { title: 'Project', links: PROJECT_LINKS },
          ].map((section) => (
            <div key={section.title}>
              <p className="px-1 pb-1.5 text-[10px] uppercase tracking-wider text-slate-500">{section.title}</p>
              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-1.5">
                {section.links.map((link) => {
                  const active = isActive(link.path);
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.path}
                      to={link.path}
                      aria-current={active ? 'page' : undefined}
                      className={`px-3 py-2.5 rounded-lg transition-all flex items-center gap-2 ${
                        active ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold' : 'text-slate-300 hover:bg-slate-900 border border-transparent'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                      <span>{link.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          {/* P8: the same authentication-aware links as the desktop bar. */}
          <div className="pt-3 border-t border-slate-800 flex flex-wrap gap-2">
            {isAuthenticated ? (
              <>
                <Link to="/account" className="flex-1 min-w-[8rem] text-center py-2.5 rounded-lg border border-slate-700 text-slate-200 truncate">
                  Account ({user?.username})
                </Link>
                {isAdmin && (
                  <Link to="/admin" className="flex-1 min-w-[6rem] text-center py-2.5 rounded-lg border border-slate-700 text-emerald-300">
                    Admin
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex-1 min-w-[6rem] py-2.5 rounded-lg border border-slate-700 text-rose-300"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/admin" className="flex-1 text-center py-2.5 rounded-lg border border-slate-700 text-slate-200">
                Sign in
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
};
