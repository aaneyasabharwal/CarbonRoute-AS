import React, { useState } from 'react';
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
  ArrowRight,
  Shield,
  Sparkles,
  User as UserIcon,
  LayoutDashboard,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Navbar: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();

  const navLinks = [
    { name: 'Home', path: '/', icon: Zap },
    { name: 'Project', path: '/project', icon: Compass },
    { name: 'How It Works', path: '/how-it-works', icon: Play },
    { name: 'Architecture', path: '/architecture', icon: Layers },
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Prototype', path: '/prototype', icon: Cpu, highlight: true },
    { name: 'My Jobs', path: '/jobs', icon: History },
    { name: 'Results', path: '/results', icon: BarChart3 },
    { name: 'Experiments', path: '/experiments', icon: FlaskConical },
    { name: 'System Design', path: '/system-design', icon: Network },
    { name: 'Roadmap', path: '/roadmap', icon: Milestone },
    { name: 'Team', path: '/team', icon: Users },
    { name: 'Resources', path: '/resources', icon: FolderDown },
    { name: 'Planning V1', path: '/presentations/planning/v1', icon: FileText },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <Link to="/" className="flex items-center space-x-3 shrink-0 group">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center group-hover:border-emerald-500/60 group-hover:bg-emerald-500/20 transition-all shadow-sm">
              <Zap className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight text-white font-mono">CARBONROUTE</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/60 uppercase">
                  Prototype
                </span>
              </div>
              <span className="text-[11px] text-emerald-400/90 font-mono tracking-wide font-medium">
                Team TriFlux &bull; UCS503
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden xl:flex items-center space-x-0.5">
            {navLinks.map((link) => {
              const active = isActive(link.path);
              const Icon = link.icon;
              return (
                <Link
                  key={link.name}
                  to={link.path}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1 font-mono ${
                    link.highlight
                      ? active
                        ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                        : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40 font-bold'
                      : active
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{link.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* Actions: Prototype CTA + Admin */}
          <div className="hidden sm:flex items-center space-x-2">
            <Link
              to="/prototype"
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400 transition-all font-mono shadow-sm group"
            >
              <Cpu className="w-3.5 h-3.5 mr-1" />
              <span>Launch Prototype</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
            </Link>

            {isAuthenticated ? (
              <div className="flex items-center space-x-1 pl-2 border-l border-slate-800 text-xs">
                {/* P8: authentication-aware navigation: Account for everyone signed in, Admin only for administrators. */}
                <Link
                  to="/account"
                  className="inline-flex items-center px-2 py-1.5 rounded-lg bg-slate-900 text-slate-200 border border-slate-800 hover:border-emerald-500/40 text-xs font-mono"
                  title={`Account (${user?.username ?? ''})`}
                >
                  <UserIcon className="w-3.5 h-3.5 mr-1" />
                  <span>{user?.username ?? 'Account'}</span>
                </Link>
                {isAdmin && (
                  <Link
                    to="/admin"
                    className="inline-flex items-center px-2 py-1.5 rounded-lg bg-slate-900 text-emerald-400 border border-slate-800 hover:border-emerald-500/40 text-xs font-mono"
                    title="Admin Dashboard"
                  >
                    <Shield className="w-3.5 h-3.5 mr-1" />
                    <span>Admin</span>
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-900"
                  title="Logout"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <Link
                to="/admin"
                className="px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 text-xs font-mono flex items-center space-x-1"
                title="Sign in"
              >
                <Lock className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Sign in</span>
              </Link>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <div className="flex xl:hidden items-center space-x-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg bg-slate-900 text-slate-300 hover:text-white border border-slate-800"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="xl:hidden border-b border-slate-800 bg-slate-950/98 px-4 pt-3 pb-5 space-y-2 font-mono text-xs">
          <div className="grid grid-cols-2 gap-1.5">
            {navLinks.map((link) => {
              const active = isActive(link.path);
              const Icon = link.icon;
              return (
                <Link
                  key={link.name}
                  to={link.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`px-3 py-2 rounded-lg transition-all flex items-center space-x-2 ${
                    active
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                      : 'text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{link.name}</span>
                </Link>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <Link
              to="/prototype"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full text-center py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold font-mono text-xs shadow-sm"
            >
              Launch Prototype &rarr;
            </Link>
          </div>
          {/* P8: the same authentication-aware links as the desktop bar (they were missing on mobile). */}
          <div className="pt-2 flex gap-2 text-xs font-mono">
            {isAuthenticated ? (
              <>
                <Link to="/account" onClick={() => setMobileMenuOpen(false)} className="flex-1 text-center py-2 rounded-lg border border-slate-700 text-slate-200">
                  Account ({user?.username})
                </Link>
                {isAdmin && (
                  <Link to="/admin" onClick={() => setMobileMenuOpen(false)} className="flex-1 text-center py-2 rounded-lg border border-slate-700 text-emerald-300">
                    Admin
                  </Link>
                )}
                <button type="button" onClick={() => { setMobileMenuOpen(false); handleLogout(); }} className="flex-1 py-2 rounded-lg border border-slate-700 text-rose-300">
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/admin" onClick={() => setMobileMenuOpen(false)} className="flex-1 text-center py-2 rounded-lg border border-slate-700 text-slate-200">
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
