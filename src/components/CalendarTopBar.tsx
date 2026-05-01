import React from 'react'
import { format } from 'date-fns'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Info,
  ListTodo,
  Plus,
  Sun,
  Settings,
  Menu,
  Minimize2,
  Maximize2,
} from 'lucide-react'
import CalendarSettingsPanel from './CalendarSettingsPanel'
import { useModal } from '../contexts/useModal'

interface CalendarTopBarProps {
  settings: any
  plannedHours: number
  actualHours: number
  plannedHoursBreakdown: any[]
  actualHoursBreakdown: any[]
  showWorkHoursTooltip: boolean
  showActualHoursTooltip: boolean
  showPlannedHoursTooltip: boolean
  showTaskScheduleModal: boolean
  setShowWorkHoursTooltip: (show: boolean) => void
  setShowActualHoursTooltip: (show: boolean) => void
  setShowPlannedHoursTooltip: (show: boolean) => void
  setShowTaskScheduleModal: (show: boolean) => void
  navigateBackWeek: () => void
  navigateBackDay: () => void
  navigateToToday: () => void
  navigateForwardDay: () => void
  navigateForwardWeek: () => void
  showCalendarSettings: boolean
  setShowCalendarSettings: (show: boolean) => void
  onSyncGoogleCalendar: () => void
  onToggleMobileMenu?: () => void
  onAddMeeting?: () => void
  mobileDayLabel?: string
  mobileDayNotePreview?: string | null
  onOpenMobileDayNote?: () => void
  hourHeight?: number
  setHourHeight?: (height: number) => void
  dayColumnCount?: number
  setDayColumnCount?: (count: number) => void
  archivedHabits?: { id: string; name: string }[]
}

export default function CalendarTopBar({
  settings,
  plannedHours,
  actualHours,
  plannedHoursBreakdown,
  actualHoursBreakdown,
  showWorkHoursTooltip,
  showActualHoursTooltip,
  showPlannedHoursTooltip,
  showTaskScheduleModal,
  setShowWorkHoursTooltip,
  setShowActualHoursTooltip,
  setShowPlannedHoursTooltip,
  setShowTaskScheduleModal,
  navigateBackWeek,
  navigateBackDay,
  navigateToToday,
  navigateForwardDay,
  navigateForwardWeek,
  showCalendarSettings,
  setShowCalendarSettings,
  onSyncGoogleCalendar,
  onToggleMobileMenu,
  onAddMeeting,
  mobileDayLabel,
  mobileDayNotePreview,
  onOpenMobileDayNote,
  hourHeight = 64,
  setHourHeight,
  dayColumnCount = 7,
  setDayColumnCount,
  archivedHabits = [],
}: CalendarTopBarProps) {
  const { openNeedHelpModal } = useModal()
  const showBar = settings ? (settings.metadata?.showWorkHoursBar ?? true) : false

  return (
    // Top Bar with Navigation and Work Hours
    <div className="bg-neutral-100 border-b border-neutral-200 px-2 py-0.5 sm:px-0">
    {/* Navigation, Work Hours Label, and Planned/Actual all on one line */}
    <div className="flex items-center justify-between sm:px-2">
      {/* Left side: Navigation Controls */}
      <div className="flex items-center">
        {onAddMeeting && (
          <button
            onClick={onAddMeeting}
            className="md:hidden hover:bg-neutral-200 rounded transition-colors mr-1"
            title="Add meeting"
          >
            <Plus className="w-4 h-4 text-neutral-600" />
          </button>
        )}
        <button
          onClick={navigateBackWeek}
          className="hidden sm:block hover:bg-neutral-200 rounded transition-colors"
          title="Go back 5 days"
        >
          <ChevronsLeft className="w-3 h-3 text-neutral-600" />
        </button>
        <button
          onClick={navigateBackDay}
          className="hover:bg-neutral-200 rounded transition-colors"
          title="Go back 1 day"
        >
          <ChevronLeft className="w-4 h-4 sm:w-3 sm:h-3 text-neutral-600" />
        </button>
        {mobileDayLabel && (
          <button
            onClick={navigateToToday}
            className="md:hidden hover:bg-neutral-200 rounded transition-colors mx-1 text-sm font-medium text-neutral-700"
            title="Go to today"
          >
            {mobileDayLabel}
          </button>
        )}
        <button
          onClick={navigateToToday}
          className="hidden md:block hover:bg-neutral-200 rounded transition-colors mx-1"
          title="Go to today"
        >
          <Sun className="w-3 h-3 text-yellow-600" />
        </button>
        <button
          onClick={navigateForwardDay}
          className="hover:bg-neutral-200 rounded transition-colors"
          title="Go forward 1 day"
        >
          <ChevronRight className="w-4 h-4 sm:w-3 sm:h-3 text-neutral-600" />
        </button>
        <button
          onClick={navigateForwardWeek}
          className="hidden sm:block hover:bg-neutral-200 rounded transition-colors"
          title="Go forward 5 days"
        >
          <ChevronsRight className="w-3 h-3 text-neutral-600" />
        </button>

        {/* Mobile "add note" affordance — shown only when no day note exists.
            When a day note is present it renders as a full-width banner below
            the top bar (see Calendar.tsx). */}
        {onOpenMobileDayNote && !mobileDayNotePreview && (
          <button
            onClick={onOpenMobileDayNote}
            className="md:hidden ml-1 flex-1 min-w-0 text-left text-sm hover:bg-neutral-200 rounded px-1.5 py-0.5 transition-colors truncate"
            title="Add note for this day"
          >
            <span className="italic text-neutral-400">Add note</span>
          </button>
        )}

        {/* Work Hours Label - desktop only, togglable */}
        {showBar && <div className="hidden sm:block text-sm text-neutral-700 ml-2 work-hours-tooltip relative">
          {settings ? (
            <div className="flex items-center">
              <span>Work Hours</span>
              <button
                onClick={() => setShowWorkHoursTooltip(!showWorkHoursTooltip)}
                className="ml-0 hover:bg-neutral-200 rounded p-0.5 transition-colors"
                title="Work hours details"
              >
                <Info className="w-2 h-2 text-neutral-500" />
              </button>
              <button
                onClick={() => setShowTaskScheduleModal(!showTaskScheduleModal)}
                className="ml-0.5 hover:bg-neutral-200 rounded p-0.5 transition-colors"
                title="View upcoming tasks"
              >
                <ListTodo className="w-2 h-2 text-neutral-500" />
              </button>
              {showWorkHoursTooltip && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 text-xs whitespace-nowrap z-50">
                  <div className="font-medium mb-1">Work Schedule:</div>
                  <div>
                    Daily: {settings.work_hours_start} - {settings.work_hours_end}
                  </div>
                  <div>
                    Week ends:{' '}
                    {settings.week_ending_day?.charAt(0).toUpperCase() +
                      settings.week_ending_day?.slice(1)}{' '}
                    {new Date(
                      `1970-01-01T${settings.week_ending_time || '20:30'}`
                    ).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </div>
                  <div>
                    Timezone: {settings.week_ending_timezone?.split('/')[1]?.replace('_', ' ')}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-neutral-400">Loading work hours...</span>
          )}
        </div>}
      </div>

      {/* Right side: Planned and Actual hours */}
      {showBar && <div className="flex items-center gap-2">
        <div className="text-sm relative planned-hours-tooltip">
          <span className="text-neutral-600">Planned:</span>
          <span
            className="font-medium text-neutral-900 ml-1 cursor-pointer hover:underline"
            onClick={() => setShowPlannedHoursTooltip(!showPlannedHoursTooltip)}
          >
            {plannedHours.toFixed(1)}h ($
            {plannedHoursBreakdown
              .filter(item => item.hourlyRate && Number(item.hourlyRate) > 0)
              .reduce((sum, item) => sum + item.hours * Number(item.hourlyRate), 0)
              .toFixed(0)}
            )
          </span>
          {showPlannedHoursTooltip && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-neutral-200 shadow-lg rounded-md p-2 z-50">
              <div className="text-sm font-medium text-neutral-900">
                Planned Hours Breakdown
              </div>
              {plannedHoursBreakdown.filter(
                item => item.hourlyRate && Number(item.hourlyRate) > 0
              ).length > 0 ? (
                <div className="space-y-2">
                  {(() => {
                    // Group by project
                    const groupedByProject = plannedHoursBreakdown
                      .filter(item => item.hourlyRate && Number(item.hourlyRate) > 0)
                      .reduce((acc, item) => {
                        const existingProject = acc.find(
                          group => group.projectName === item.projectName
                        )
                        if (existingProject) {
                          existingProject.sessions.push(item)
                          existingProject.totalHours += item.hours
                          existingProject.totalValue += item.hours * Number(item.hourlyRate)
                        } else {
                          acc.push({
                            projectName: item.projectName,
                            hourlyRate: item.hourlyRate,
                            totalHours: item.hours,
                            totalValue: item.hours * Number(item.hourlyRate),
                            sessions: [item],
                          })
                        }
                        return acc
                      }, [])

                    return groupedByProject.map((project, projectIndex) => (
                      <div
                        key={projectIndex}
                        className="border-b border-neutral-100 last:border-b-0 pb-2 last:pb-0"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-neutral-900">
                              {project.projectName}
                            </div>
                            <div className="text-neutral-500 text-xs">
                              ${Number(project.hourlyRate)}/hr
                            </div>
                          </div>
                          <div className="text-neutral-900 font-medium">
                            {project.totalHours.toFixed(1)}h
                            <div className="text-blue-600 text-xs">
                              ${project.totalValue.toFixed(0)}
                            </div>
                          </div>
                        </div>
                        <div className="space-y-0.5 ml-2">
                          {project.sessions.map((session, sessionIndex) => (
                            <div
                              key={sessionIndex}
                              className="flex justify-between items-center text-xs"
                            >
                              <div className="flex-1">
                                <div className="text-neutral-600 truncate flex items-center">
                                  {session.sessionName}
                                  {session.isCompleted && (
                                    <span className="ml-2 text-green-600">✓</span>
                                  )}
                                </div>
                              </div>
                              <div className="text-neutral-600">
                                {session.hours.toFixed(1)}h
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  })()}
                  <div className="border-t border-neutral-200 pt-1 mt-2">
                    <div className="flex justify-between items-center text-sm font-medium">
                      <span>Total</span>
                      <span>
                        {plannedHoursBreakdown
                          .filter(item => item.hourlyRate && Number(item.hourlyRate) > 0)
                          .reduce((sum, item) => sum + item.hours, 0)
                          .toFixed(1)}
                        h
                      </span>
                    </div>
                    {plannedHoursBreakdown.some(
                      item => item.hourlyRate && Number(item.hourlyRate) > 0
                    ) && (
                      <div className="flex justify-between items-center text-sm text-blue-600">
                        <span>Est. Value</span>
                        <span>
                          $
                          {plannedHoursBreakdown
                            .reduce(
                              (sum, item) =>
                                sum +
                                item.hours *
                                  (Number(item.hourlyRate) > 0 ? Number(item.hourlyRate) : 0),
                              0
                            )
                            .toFixed(0)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-neutral-500">No planned work found</div>
              )}
            </div>
          )}
        </div>
        <div className="hidden sm:block text-sm relative actual-hours-tooltip">
          <span className="text-neutral-600">Actual:</span>
          <span
            className="font-medium text-neutral-900 ml-1 cursor-pointer hover:underline"
            onClick={() => setShowActualHoursTooltip(!showActualHoursTooltip)}
          >
            {actualHours.toFixed(1)}h
          </span>
          {showActualHoursTooltip && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-neutral-200 shadow-lg rounded-md p-3 z-50">
              <div className="text-sm font-medium text-neutral-900 mb-2">
                Actual Hours Breakdown
              </div>
              {actualHoursBreakdown.length > 0 ? (
                <div className="space-y-1">
                  {actualHoursBreakdown.map((item, index) => (
                    <div key={index} className="flex justify-between items-center text-xs">
                      <div className="flex-1">
                        <div className="font-medium text-neutral-900">{item.projectName}</div>
                        <div className="text-neutral-600">
                          {format(new Date(item.date), 'MMM d')}
                        </div>
                        {item.hourlyRate && Number(item.hourlyRate) > 0 && (
                          <div className="text-neutral-500">${Number(item.hourlyRate)}/hr</div>
                        )}
                      </div>
                      <div className="text-neutral-900 font-medium">
                        {item.hours.toFixed(1)}h
                        {item.hourlyRate && item.hourlyRate > 0 && (
                          <div className="text-green-600 text-xs">
                            ${(item.hours * item.hourlyRate).toFixed(0)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-neutral-200 pt-1 mt-2">
                    <div className="flex justify-between items-center text-sm font-medium">
                      <span>Total</span>
                      <span>{actualHours.toFixed(1)}h</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-neutral-500">No completed sessions yet</div>
              )}
            </div>
          )}
        </div>
      </div>}

      {/* Calendar Settings Gear + Mobile Hamburger */}
      <div className="relative ml-2 flex items-center gap-1">
        {setDayColumnCount && (
          <select
            value={dayColumnCount}
            onChange={e => setDayColumnCount(parseInt(e.target.value, 10))}
            className="hidden md:block bg-transparent text-xs text-neutral-600 hover:bg-neutral-200 rounded px-1 py-0.5 border-0 focus:outline-none focus:ring-1 focus:ring-neutral-300 cursor-pointer"
            title="Days visible"
            aria-label="Days visible"
          >
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
          </select>
        )}
        <select
          value=""
          onChange={() => {}}
          disabled={archivedHabits.length === 0}
          className="hidden md:block bg-transparent text-xs text-neutral-600 hover:bg-neutral-200 rounded px-1 py-0.5 border-0 focus:outline-none focus:ring-1 focus:ring-neutral-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed max-w-[140px]"
          title="Hidden habits"
          aria-label="Hidden habits"
        >
          <option value="">
            {archivedHabits.length === 0 ? 'No hidden' : `Hidden (${archivedHabits.length})`}
          </option>
          {archivedHabits.map(h => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        {setHourHeight && (
          <button
            onClick={() => setHourHeight(hourHeight >= 80 ? 64 : 80)}
            className="hidden md:block p-0.5 hover:bg-neutral-200 rounded transition-colors text-neutral-500"
            title={hourHeight >= 80 ? 'Compact rows' : 'Expand rows'}
            aria-label={hourHeight >= 80 ? 'Compact rows' : 'Expand rows'}
          >
            {hourHeight >= 80 ? (
              <Minimize2 className="w-2.5 h-2.5" />
            ) : (
              <Maximize2 className="w-2.5 h-2.5" />
            )}
          </button>
        )}
        <button
          onClick={() => setShowCalendarSettings(!showCalendarSettings)}
          className="hidden md:block p-0.5 hover:bg-neutral-200 rounded transition-colors"
          title="Calendar settings"
        >
          <Settings className="w-2.5 h-2.5 text-neutral-500" />
        </button>
        <button
          onClick={openNeedHelpModal}
          className="md:hidden p-0.5 rounded-full text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 transition-colors"
          title="Need help?"
          aria-label="Need help"
        >
          <AlertCircle className="w-2.5 h-2.5" />
        </button>
        {onToggleMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            className="md:hidden p-0.5 hover:bg-neutral-200 rounded transition-colors"
            title="Menu"
          >
            <Menu className="w-2.5 h-2.5 text-neutral-500" />
          </button>
        )}
        <CalendarSettingsPanel
          isOpen={showCalendarSettings}
          onClose={() => setShowCalendarSettings(false)}
          onSync={onSyncGoogleCalendar}
        />
      </div>
      </div>
    </div>
  )
}