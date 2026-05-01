import { Outlet, NavLink, Link } from 'react-router-dom'
import { useLocation } from 'react-router'
import { useEffect, useState } from 'react'
import {
  Layout,
  Home,
  Code,
  Briefcase,
  Users,
  Settings,
  Heart,
  Clock,
  Star,
  Calendar,
  FileText,
  Trophy,
  CheckSquare,
  FolderOpen,
  LogOut,
  Bot,
  Menu,
  X,
  Cat,
  Notebook,
  Sparkles,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,

  Tag,
  Target,
  DollarSign,
  Layers,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUserContext } from '../contexts/UserContext'
import { supabase } from '../lib/supabase'
import FeedbackButton from '../components/FeedbackButton'
import { ModalProvider } from '../contexts/ModalContext'
// import { useAutoReflection } from '../hooks/useAutoReflection'

const MainLayout = () => {
  const location = useLocation()
  const { user } = useUserContext()
  const signOut = () => supabase.auth.signOut()

  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('sidebarCollapsed') === 'true'
  })

  useEffect(() => {
    window.localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  const labelClass = sidebarCollapsed ? 'hidden' : 'hidden lg:block'
  const iconMarginClass = sidebarCollapsed ? 'mr-0' : 'mr-0 lg:mr-1.5'
  const justifyClass = sidebarCollapsed ? 'justify-center' : 'justify-center lg:justify-start'
  const paddingXClass = sidebarCollapsed ? 'px-1' : 'px-1 lg:px-2'

  // Auto-generate reflection when habits or tasks are completed
  // useAutoReflection() // Disabled to reduce API calls

  const navItems = [
    { path: '/calendar', label: 'Calendar', icon: Calendar },
    { path: '/projects', label: 'Projects', icon: FolderOpen },
    { path: '/habits', label: 'Habits', icon: Heart },
    { path: '/notes', label: 'Notes', icon: FileText },
    { path: '/issues', label: 'Issues', icon: Zap },
  ]

  const settingsItem = { path: '/settings', label: 'Settings', icon: Settings }

  const isCalendarPage = location.pathname === '/calendar'
  const isActive = (path: string) => location.pathname === path

  return (
    <ModalProvider>
    <div className="flex min-h-screen bg-neutral-50">
      {/* Desktop Sidebar */}
      <aside className={`hidden md:flex ${sidebarCollapsed ? 'md:w-14' : 'md:w-14 lg:w-56'} flex-col bg-white border-r border-neutral-200 fixed h-screen z-10`}>
        <Link to="/dashboard" className={`block py-1 ${sidebarCollapsed ? 'px-1' : 'px-1 lg:px-4'}`}>
          <h1 className={`text-lg text-primary-700 ${sidebarCollapsed ? 'text-center' : 'text-center lg:text-left'}`} style={{ fontFamily: "'DM Serif Display', serif" }}>
            <span className={labelClass}>Cassian</span>
          </h1>
        </Link>

        <nav className={`flex-1 pb-4 ${paddingXClass}`}>
          <ul className="space-y-0.5">
            {navItems.map(item => {
              const Icon = item.icon
              return (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center rounded-md py-1 text-[13px] font-medium transition-colors ${justifyClass} ${paddingXClass} ${
                        isActive
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                      }`
                    }
                    title={item.label}
                  >
                    <Icon className={`h-2.5 w-2.5 ${iconMarginClass}`} />
                    <span className={labelClass}>{item.label}</span>
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="mt-auto p-1 border-t border-neutral-200 space-y-1">
          <a
            href="https://ko-fi.com/andrewjcasal"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center rounded-md py-1 text-[13px] font-medium text-red-500 hover:bg-red-50 hover:text-red-600 ${justifyClass} ${paddingXClass}`}
            title="Support"
          >
            <Heart className={`h-2.5 w-2.5 ${iconMarginClass}`} />
            <span className={labelClass}>Support</span>
          </a>
          <NavLink
            to="/settings"
            className={`flex items-center rounded-md py-1 text-[13px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 ${justifyClass} ${paddingXClass}`}
            title="Settings"
          >
            <Settings className={`h-2.5 w-2.5 ${iconMarginClass}`} />
            <span className={labelClass}>Settings</span>
          </NavLink>
          <div className={`flex gap-1 ${sidebarCollapsed ? 'flex-col items-stretch' : 'flex-col items-stretch lg:flex-row lg:items-center'}`}>
            <button
              onClick={signOut}
              className={`flex items-center rounded-md py-1 text-[13px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 flex-1 ${justifyClass} ${paddingXClass}`}
              title="Log Out"
            >
              <LogOut className={`h-2.5 w-2.5 ${iconMarginClass}`} />
              <span className={labelClass}>Log Out</span>
            </button>
            <button
              onClick={() => setSidebarCollapsed(prev => !prev)}
              className={`flex items-center justify-center rounded-md py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 ${paddingXClass}`}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-2.5 w-2.5" /> : <PanelLeftClose className="h-2.5 w-2.5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header with Hamburger — hidden on calendar page (calendar has its own) */}
      {!isCalendarPage && (
        <header className="md:hidden fixed top-0 left-0 right-0 bg-white border-b border-neutral-200 px-1 py-1 z-30 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center pl-1">
            <h1 className="text-base text-primary-700" style={{ fontFamily: "'DM Serif Display', serif" }}>Cassian</h1>
          </Link>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1 rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
          >
            {mobileMenuOpen ? <X className="h-3 w-3" /> : <Menu className="h-3 w-3" />}
          </button>
        </header>
      )}

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={() => setMobileMenuOpen(false)}
            />

            {/* Menu Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.3 }}
              className="md:hidden fixed top-0 right-0 h-full w-64 bg-white border-l border-neutral-200 z-50 flex flex-col"
            >
              {/* Close button */}
              <div className="flex items-center justify-end p-1">
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 rounded text-neutral-500 hover:text-neutral-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Navigation */}
              <nav className="flex-1 px-0 py-0">
                <ul className="space-y-1">
                  {navItems.map(item => {
                    const Icon = item.icon
                    return (
                      <li key={item.path}>
                        <NavLink
                          to={item.path}
                          onClick={() => setMobileMenuOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center rounded-md px-1 py-1 text-sm font-medium transition-colors ${
                              isActive
                                ? 'bg-primary-50 text-primary-700'
                                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                            }`
                          }
                        >
                          <Icon className="mr-1 h-2 w-2" />
                          {item.label}
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              </nav>

              {/* Footer */}
              <div className="p-0 border-t border-neutral-200 space-y-1">
                <a
                  href="https://ko-fi.com/andrewjcasal"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center rounded-md px-2 py-1.5 text-sm font-medium text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Heart className="mr-1 h-2 w-2" />
                  Support
                </a>
                <NavLink
                  to="/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center rounded-md px-2 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                >
                  <Settings className="mr-1 h-2 w-2" />
                  Settings
                </NavLink>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false)
                    signOut()
                  }}
                  className="flex items-center w-full rounded-md px-2 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                >
                  <LogOut className="mr-1 h-2 w-2" />
                  Logout
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className={`flex-1 ${sidebarCollapsed ? 'md:ml-14' : 'md:ml-14 lg:ml-56'} md:pt-0 w-full md:w-auto ${isCalendarPage ? 'pt-0' : 'pt-16'}`}>
        <Outlet context={{ setMobileMenuOpen }} />
      </main>

      {/* Feedback Button */}
      <FeedbackButton />
    </div>
    </ModalProvider>
  )
}

export default MainLayout
